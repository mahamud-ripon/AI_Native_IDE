import { spawn, ChildProcess } from 'child_process';
import { redis, RedisKeys } from '../lib/redis.js';
import { config } from '../config/index.js';

interface VMPool {
  vmId: string;
  process: ChildProcess | null;
  status: 'booting' | 'ready' | 'running' | 'hibernated';
  createdAt: number;
  pid?: number;
}

const POOL_SIZE = 20;
const vmPool: Map<string, VMPool> = new Map();

// Redis key for persistent VM tracking
const VM_TRACKING_KEY = 'vm:tracking';
const VM_HEARTBEAT_TTL = 60; // seconds

export const Prewarmer = {
  async start(): Promise<void> {
    console.log('[Prewarmer] Starting VM prewarmer...');

    // Reconcile with Redis on startup - recover orphaned VMs
    await this.reconcilePool();

    // Initial pool population
    for (let i = 0; i < POOL_SIZE; i++) {
      await this.spawnVM(`pool-${i}`);
    }

    // Replenish loop
    setInterval(async () => {
      const readyCount = Array.from(vmPool.values()).filter(v => v.status === 'ready').length;

      if (readyCount < POOL_SIZE / 2) {
        const vmId = `pool-${Date.now()}`;
        await this.spawnVM(vmId);
      }
    }, 30000);

    // Heartbeat loop - keep VM tracking alive in Redis
    setInterval(async () => {
      for (const [vmId, vm] of vmPool.entries()) {
        if (vm.status === 'ready' || vm.status === 'running') {
          await redis.hset(VM_TRACKING_KEY, vmId, JSON.stringify({
            status: vm.status,
            pid: vm.pid,
            createdAt: vm.createdAt,
            lastHeartbeat: Date.now()
          }));
          await redis.expire(VM_TRACKING_KEY, VM_HEARTBEAT_TTL * 2);
        }
      }
    }, VM_HEARTBEAT_TTL * 1000 / 2);
  },

  async reconcilePool(): Promise<void> {
    console.log('[Prewarmer] Reconciling VM pool with Redis...');

    // Get all tracked VMs from Redis
    const trackedVMs = await redis.hgetall(VM_TRACKING_KEY);

    if (trackedVMs) {
      for (const [vmId, vmData] of Object.entries(trackedVMs)) {
        try {
          const data = JSON.parse(vmData as string);
          
          // Check if VM process is still alive (via PID check)
          if (data.pid) {
            try {
              // Send signal 0 to check if process exists
              process.kill(data.pid, 0);
              
              // Process exists - re-add to in-memory pool
              console.log(`[Prewarmer] Recovering VM ${vmId} (PID ${data.pid})`);
              vmPool.set(vmId, {
                vmId,
                process: null, // We don't have the process handle anymore
                status: data.status,
                createdAt: data.createdAt,
                pid: data.pid
              });
              
              // Re-add to ready pool if applicable
              if (data.status === 'ready') {
                await redis.sadd(RedisKeys.vmPool, vmId);
              }
            } catch {
              // Process is dead - clean up from Redis
              console.log(`[Prewarmer] VM ${vmId} (PID ${data.pid}) is dead, cleaning up`);
              await redis.hdel(VM_TRACKING_KEY, vmId);
              await redis.srem(RedisKeys.vmPool, vmId);
            }
          }
        } catch (parseError) {
          console.error(`[Prewarmer] Failed to parse VM data for ${vmId}`);
          await redis.hdel(VM_TRACKING_KEY, vmId);
        }
      }
    }

    console.log(`[Prewarmer] Reconciliation complete. Recovered ${vmPool.size} VMs`);
  },

  async spawnVM(vmId: string): Promise<void> {
    console.log(`[Prewarmer] Spawning VM ${vmId}`);

    const vm: VMPool = {
      vmId,
      process: null,
      status: 'booting',
      createdAt: Date.now()
    };

    vmPool.set(vmId, vm);

    // In dev mode or non-Linux: skip actual firecracker spawning
    const isDevMode = process.env.NODE_ENV !== 'production' || process.platform !== 'linux';
    if (isDevMode) {
      vm.status = 'ready';
      vm.pid = process.pid; // use current process PID as placeholder
      console.log(`[Prewarmer] DEV MODE - VM ${vmId} simulated as ready (no firecracker)`);
      try {
        await redis.sadd(RedisKeys.vmPool, vmId);
      } catch { /* Redis not available */ }
      return;
    }

    try {
      // In production Linux, launch Firecracker with jailer
      const proc = spawn(config.firecracker.binary, [
        '--config-file', `/tmp/${vmId}.json`
      ], {
        stdio: 'ignore',
        detached: true
      });

      vm.process = proc;
      vm.pid = proc.pid;

      // Handle spawn errors (binary not found, etc.)
      proc.on('error', async (err) => {
        console.error(`[Prewarmer] VM ${vmId} spawn error:`, err.message);
        vmPool.delete(vmId);
        try {
          await redis.hdel(VM_TRACKING_KEY, vmId);
          await redis.srem(RedisKeys.vmPool, vmId);
        } catch { /* ignore */ }
      });

      // Persist VM tracking to Redis
      try {
        await redis.hset(VM_TRACKING_KEY, vmId, JSON.stringify({
          status: 'booting',
          pid: vm.pid,
          createdAt: vm.createdAt,
          lastHeartbeat: Date.now()
        }));
      } catch { /* Redis not available */ }

      proc.on('exit', (code) => {
        console.log(`[Prewarmer] VM ${vmId} exited with code ${code}`);
        vmPool.delete(vmId);
        redis.hdel(VM_TRACKING_KEY, vmId).catch(() => {});
        redis.srem(RedisKeys.vmPool, vmId).catch(() => {});
      });

      // Simulate boot time
      await new Promise(resolve => setTimeout(resolve, 2000));

      vm.status = 'ready';
      console.log(`[Prewarmer] VM ${vmId} ready`);

      // Add to Redis pool
      await redis.sadd(RedisKeys.vmPool, vmId);

      // Update tracking with ready status
      await redis.hset(VM_TRACKING_KEY, vmId, JSON.stringify({
        status: 'ready',
        pid: vm.pid,
        createdAt: vm.createdAt,
        lastHeartbeat: Date.now()
      }));

    } catch (error) {
      console.error(`[Prewarmer] Failed to spawn VM ${vmId}:`, error);
      vmPool.delete(vmId);
      try { await redis.hdel(VM_TRACKING_KEY, vmId); } catch { /* ignore */ }
    }
  },

  async acquireVM(): Promise<string | null> {
    // Try to get a ready VM from Redis
    const vmId = await redis.spop(RedisKeys.vmPool);

    if (!vmId) {
      // No ready VMs, spawn a new one
      const newVmId = `on-demand-${Date.now()}`;
      await this.spawnVM(newVmId);
      return newVmId;
    }

    const vm = vmPool.get(vmId);
    if (vm) {
      vm.status = 'running';
      // Update Redis tracking
      await redis.hset(VM_TRACKING_KEY, vmId, JSON.stringify({
        status: 'running',
        pid: vm.pid,
        createdAt: vm.createdAt,
        lastHeartbeat: Date.now()
      }));
    }

    return vmId;
  },

  async releaseVM(vmId: string): Promise<void> {
    const vm = vmPool.get(vmId);
    if (!vm) return;

    // Check if it's a pool VM or on-demand
    if (vmId.startsWith('pool-')) {
      vm.status = 'ready';
      await redis.sadd(RedisKeys.vmPool, vmId);
      await redis.hset(VM_TRACKING_KEY, vmId, JSON.stringify({
        status: 'ready',
        pid: vm.pid,
        createdAt: vm.createdAt,
        lastHeartbeat: Date.now()
      }));
    } else {
      // Destroy on-demand VMs
      await this.destroyVM(vmId);
    }
  },

  async destroyVM(vmId: string): Promise<void> {
    const vm = vmPool.get(vmId);
    if (vm?.process) {
      vm.process.kill();
    }
    vmPool.delete(vmId);
    
    // Clean up Redis
    await redis.hdel(VM_TRACKING_KEY, vmId);
    await redis.srem(RedisKeys.vmPool, vmId);
    
    console.log(`[Prewarmer] Destroyed VM ${vmId}`);
  },

  getPoolStatus(): { ready: number; running: number; total: number } {
    let ready = 0, running = 0;
    vmPool.forEach(vm => {
      if (vm.status === 'ready') ready++;
      if (vm.status === 'running') running++;
    });
    return { ready, running, total: vmPool.size };
  }
};
