import { spawn, ChildProcess } from 'child_process';
import { redis, RedisKeys } from '../lib/redis.js';
import { config } from '../config/index.js';

interface VMPool {
  vmId: string;
  process: ChildProcess | null;
  status: 'booting' | 'ready' | 'running' | 'hibernated';
  createdAt: number;
}

const POOL_SIZE = 20;
const vmPool: Map<string, VMPool> = new Map();

export const Prewarmer = {
  async start(): Promise<void> {
    console.log('[Prewarmer] Starting VM prewarmer...');

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

    try {
      // In production, this would launch Firecracker with jailer
      // For now, simulate the process
      const proc = spawn(config.firecracker.binary, [
        '--config-file', `/tmp/${vmId}.json`
      ], {
        stdio: 'ignore'
      });

      vm.process = proc;

      proc.on('exit', (code) => {
        console.log(`[Prewarmer] VM ${vmId} exited with code ${code}`);
        vmPool.delete(vmId);
      });

      // Simulate boot time
      await new Promise(resolve => setTimeout(resolve, 2000));

      vm.status = 'ready';
      console.log(`[Prewarmer] VM ${vmId} ready`);

      // Add to Redis pool
      await redis.sadd(RedisKeys.vmPool, vmId);

    } catch (error) {
      console.error(`[Prewarmer] Failed to spawn VM ${vmId}:`, error);
      vmPool.delete(vmId);
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
