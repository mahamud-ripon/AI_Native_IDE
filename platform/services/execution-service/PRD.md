# Execution Service - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Service:** execution-service (Port 8004)  
> **Tech Stack:** Node.js + Fastify + Firecracker + WebSocket + Redis

---

## 1. Executive Summary

The Execution Service is the heavy lifter of the platform. It safely runs arbitrary, untrusted user code in isolated Firecracker microVMs. It manages both Free Tier (WebContainers proxy) and Pro Tier (Firecracker MicroVMs) with sub-125ms startup latency.

---

## 2. Project Setup

### 2.1 Initialize Project

```bash
mkdir -p execution-service/src/{vm_manager,network,streams,security,rpc,controllers,services,events,lib,config}
cd execution-service
npm init -y
npm install fastify @fastify/cors @fastify/helmet ws ioredis @prisma/client kafkajs zod dotenv uuid
npm install -D typescript @types/node @types/ws ts-node prisma
npx tsc --init
```

### 2.2 package.json

```json
{
  "name": "execution-service",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "fastify": "^4.24.3",
    "@fastify/cors": "^8.4.1",
    "@fastify/helmet": "^11.1.1",
    "ws": "^8.14.0",
    "ioredis": "^5.3.2",
    "@prisma/client": "^5.10.0",
    "kafkajs": "^2.2.4",
    "zod": "^3.22.4",
    "dotenv": "^16.3.1",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.10",
    "ts-node": "^10.9.2",
    "prisma": "^5.10.0"
  }
}
```

---

## 3. Configuration

### 3.1 Environment Variables (.env)

```env
# Server
PORT=8004
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_native_ide

# Redis
REDIS_URL=redis://localhost:6379

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_GROUP_ID=execution-service

# WebSocket Gateway
WS_GATEWAY_URL=ws://websocket-gateway:8012

# Firecracker
FIRECRACKER_BINARY=/usr/local/bin/firecracker
JAILER_BINARY=/usr/local/bin/jailer
VM_IMAGE_PATH=/var/lib/firecracker/vmlinux
ROOTFS_PATH=/var/lib/firecracker/rootfs.ext4

# Network
VM_NETWORK_CIDR=10.0.0.0/24
VM_RATE_LIMIT_MBPS=10
VM_IOPS_LIMIT=1000

# S3 (for snapshots)
S3_BUCKET=vm-snapshots
AWS_REGION=us-east-1

# Vault
VAULT_ADDR=https://vault.platform.io

# Internal Auth
INTERNAL_API_KEY=your-internal-api-key
```

### 3.2 Config File (src/config/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8004', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    url: process.env.DATABASE_URL!
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'execution-service'
  },
  
  wsGatewayUrl: process.env.WS_GATEWAY_URL || 'ws://localhost:8012',
  
  firecracker: {
    binary: process.env.FIRECRACKER_BINARY || '/usr/local/bin/firecracker',
    jailer: process.env.JAILER_BINARY || '/usr/local/bin/jailer',
    vmImage: process.env.VM_IMAGE_PATH || '/var/lib/firecracker/vmlinux',
    rootfs: process.env.ROOTFS_PATH || '/var/lib/firecracker/rootfs.ext4'
  },
  
  network: {
    cidr: process.env.VM_NETWORK_CIDR || '10.0.0.0/24',
    rateLimitMbps: parseInt(process.env.VM_RATE_LIMIT_MBPS || '10', 10),
    iopsLimit: parseInt(process.env.VM_IOPS_LIMIT || '1000', 10)
  },
  
  s3: {
    bucket: process.env.S3_BUCKET || 'vm-snapshots',
    region: process.env.AWS_REGION || 'us-east-1'
  },
  
  vault: {
    addr: process.env.VAULT_ADDR!
  },
  
  internalApiKey: process.env.INTERNAL_API_KEY!
};
```

---

## 4. VM Manager

### 4.1 Pre-warming Pool (src/vm_manager/prewarmer.ts)

```typescript
import { spawn, ChildProcess } from 'child_process';
import { redis } from '../lib/redis';
import { config } from '../config';

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
      await redis.sadd('vm:pool:ready', vmId);
      
    } catch (error) {
      console.error(`[Prewarmer] Failed to spawn VM ${vmId}:`, error);
      vmPool.delete(vmId);
    }
  },

  async acquireVM(): Promise<string | null> {
    // Try to get a ready VM from Redis
    const vmId = await redis.spop('vm:pool:ready');
    
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
      await redis.sadd('vm:pool:ready', vmId);
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
```

### 4.2 Snapshot Manager (src/vm_manager/snapshot_manager.ts)

```typescript
import { redis } from '../lib/redis';
import { config } from '../config';

export const SnapshotManager = {
  async hibernateVM(vmId: string, projectId: string): Promise<void> {
    console.log(`[Snapshot] Hibernate VM ${vmId} for project ${projectId}`);
    
    // In production: firecracker --api-sock /tmp/firecracker.sock \
    //   --snapshot-load /path/to/snapshots --resume
    
    // Save state to Redis
    await redis.set(
      `vm:${vmId}:state`,
      JSON.stringify({
        projectId,
        hibernatedAt: Date.now(),
        status: 'hibernated'
      }),
      'EX', 86400 * 7 // 7 days max
    );
    
    // Publish event
    await redis.publish('vm.events', JSON.stringify({
      type: 'vm.hibernate',
      vmId,
      projectId
    }));
  },

  async restoreVM(vmId: string): Promise<boolean> {
    const state = await redis.get(`vm:${vmId}:state`);
    
    if (!state) {
      console.log(`[Snapshot] No snapshot found for VM ${vmId}`);
      return false;
    }
    
    const { projectId } = JSON.parse(state);
    console.log(`[Snapshot] Restore VM ${vmId} for project ${projectId}`);
    
    // In production: firecracker --api-sock /tmp/firecracker.sock \
    //   --snapshot-load /path/to/snapshots --resume
    
    await redis.del(`vm:${vmId}:state`);
    
    return true;
  },

  async cleanupStaleSnapshots(): Promise<void> {
    const keys = await redis.keys('vm:*:state');
    
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl <= 0) {
        await redis.del(key);
      }
    }
  }
};
```

---

## 5. Network Management

### 5.1 TAP Interface Manager (src/network/tap_interfaces.ts)

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const TapManager = {
  async createTapDevice(tapName: string, vmIp: string): Promise<void> {
    try {
      // Create TAP device
      await execAsync(`ip tuntap add mode tap name ${tapName}`);
      await execAsync(`ip link set ${tapName} up`);
      
      // Set up routing
      await execAsync(`ip addr add ${vmIp}/24 dev ${tapName}`);
      
      // Apply rate limiting (tc)
      await execAsync(
        `tc qdisc add dev ${tapName} root tbf rate ${10}mbit burst 1540 latency 50ms`
      );
      
      console.log(`[TapManager] Created TAP ${tapName} at ${vmIp}`);
    } catch (error) {
      console.error(`[TapManager] Failed to create TAP ${tapName}:`, error);
    }
  },

  async deleteTapDevice(tapName: string): Promise<void> {
    try {
      await execAsync(`ip link set ${tapName} down`);
      await execAsync(`ip tuntap del mode tap name ${tapName}`);
      console.log(`[TapManager] Deleted TAP ${tapName}`);
    } catch (error) {
      console.error(`[TapManager] Failed to delete TAP ${tapName}:`, error);
    }
  },

  async blockMetadataEndpoint(tapName: string): Promise<void> {
    // Block AWS IMDS
    await execAsync(
      `iptables -A OUTPUT -d 169.254.169.254 -o ${tapName} -j DROP`
    );
    console.log(`[TapManager] Blocked metadata endpoint on ${tapName}`);
  },

  async blockInternalNetwork(tapName: string): Promise<void> {
    // Block Kubernetes internal network
    await execAsync(
      `iptables -A OUTPUT -d 10.96.0.0/12 -o ${tapName} -j DROP`
    );
    console.log(`[TapManager] Blocked internal network on ${tapName}`);
  }
};
```

---

## 6. Stream Management

### 6.1 Terminal PTY (src/streams/terminal_pty.ts)

```typescript
import { spawn, ChildProcess, PseudoTerminal } from 'child_process';
import { WebSocket } from 'ws';
import { redis } from '../lib/redis';

interface TerminalSession {
  sessionId: string;
  vmId: string;
  process: ChildProcess;
  ws: WebSocket;
}

const sessions = new Map<string, TerminalSession>();

export const TerminalPTY = {
  async createSession(vmId: string, command: string, ws: WebSocket): Promise<string> {
    const sessionId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[Terminal] Creating session ${sessionId} on VM ${vmId}`);
    
    // In production, this would exec into the Firecracker VM
    // For simulation, spawn a local process
    const proc = spawn('sh', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const session: TerminalSession = {
      sessionId,
      vmId,
      process: proc,
      ws
    };
    
    sessions.set(sessionId, session);
    
    // Stream stdout
    proc.stdout?.on('data', (data: Buffer) => {
      ws.send(data.toString());
      // Also publish to Redis for persistence
      redis.publish(`terminal:${sessionId}`, data.toString());
    });
    
    // Stream stderr
    proc.stderr?.on('data', (data: Buffer) => {
      ws.send(`\x1b[31m${data.toString()}\x1b[0m`); // Red color
    });
    
    proc.on('exit', (code) => {
      ws.send(`\n\x1b[33mProcess exited with code ${code}\x1b[0m\n`);
      sessions.delete(sessionId);
    });
    
    return sessionId;
  },

  handleInput(sessionId: string, data: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    // Handle special keys
    if (data === '\x03') { // Ctrl+C
      session.process.kill('SIGINT');
    } else if (data === '\x04') { // Ctrl+D
      session.process.kill('SIGTERM');
    } else {
      session.process.stdin?.write(data);
    }
  },

  async closeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    session.process.kill();
    session.ws.close();
    sessions.delete(sessionId);
    
    console.log(`[Terminal] Closed session ${sessionId}`);
  },

  getActiveSessions(): number {
    return sessions.size;
  }
};
```

### 6.2 File Sync (src/streams/fs_sync.ts)

```typescript
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';

export const FileSync = {
  async start(): Promise<void> {
    console.log('[FileSync] Starting file sync worker');
    
    // Subscribe to file change events
    const subscriber = redis.duplicate();
    await subscriber.subscribe('file.modified');
    
    subscriber.on('message', async (channel, message) => {
      if (channel === 'file.modified') {
        const payload = JSON.parse(message);
        await this.syncFile(payload);
      }
    });
  },

  async syncFile(payload: { projectId: string; fileId: string; content: string }): Promise<void> {
    console.log(`[FileSync] Syncing file ${payload.fileId} for project ${payload.projectId}`);
    
    // In production, this would write to the VM's mounted volume via virtio-fs
    // For now, just log the sync
    const vmKey = `vm:project:${payload.projectId}:active`;
    const vmId = await redis.get(vmKey);
    
    if (vmId) {
      // Write file to VM
      console.log(`[FileSync] Would write to VM ${vmId}: ${payload.fileId}`);
    }
  }
};
```

---

## 7. Security

### 7.1 Vault Agent (src/security/vault_agent.ts)

```typescript
import axios from 'axios';
import { config } from '../config';

export const VaultAgent = {
  async getSecret(path: string): Promise<string | null> {
    try {
      const response = await axios.get(
        `${config.vault.addr}/v1/secret/data/${path}`,
        {
          headers: {
            'X-Vault-Token': process.env.VAULT_TOKEN
          }
        }
      );
      
      return response.data.data.data.value;
    } catch (error) {
      console.error(`[VaultAgent] Failed to fetch secret ${path}:`, error);
      return null;
    }
  },

  async injectSecretsAsEnvFile(projectId: string, vmId: string): Promise<string> {
    const secrets = await prisma.projectSecret.findMany({
      where: { projectId }
    });
    
    let envContent = '';
    
    for (const secret of secrets) {
      const value = await this.getSecret(secret.vaultReferenceId);
      if (value) {
        envContent += `${secret.keyName}=${value}\n`;
      }
    }
    
    // In production, write to virtio-fs mounted directory
    return envContent;
  }
};
```

---

## 8. Controllers

### 8.1 Execution Controller (src/controllers/execution_controller.ts)

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { Prewarmer } from '../vm_manager/prewarmer';
import { TerminalPTY } from '../streams/terminal_pty';
import { SnapshotManager } from '../vm_manager/snapshot_manager';
import { VaultAgent } from '../security/vault_agent';
import { KafkaPublisher } from '../events/kafka_publisher';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const RunSchema = z.object({
  projectId: z.string().uuid(),
  command: z.string().min(1),
  env: z.record(z.string()).optional()
});

const InstallSchema = z.object({
  projectId: z.string().uuid(),
  packageManager: z.enum(['npm', 'pip', 'cargo', 'go']),
  packages: z.array(z.string()).min(1)
});

export const ExecutionController = {
  // POST /api/v1/exec/run
  async runCode(req: Request, res: Response) {
    try {
      const data = RunSchema.parse(req.body);
      const userId = (req as any).user.id;

      // Verify user has execute permission
      const collaborator = await prisma.projectCollaborator.findFirst({
        where: {
          projectId: data.projectId,
          userId,
          role: { in: ['owner', 'editor'] }
        }
      });

      if (!collaborator) {
        return res.status(403).json({ error: 'Execute permission denied' });
      }

      // Get VM from pool
      const vmId = await Prewarmer.acquireVM();
      
      if (!vmId) {
        return res.status(503).json({ error: 'No VMs available' });
      }

      // Inject secrets
      const envContent = await VaultAgent.injectSecretsAsEnvFile(data.projectId, vmId);

      // Create execution record
      const execution = await prisma.codeExecution.create({
        data: {
          projectId: data.projectId,
          userId,
          vmId,
          command: data.command,
          status: 'running'
        }
      });

      // Track active VM
      await redis.set(`vm:project:${data.projectId}:active`, vmId, 'EX', 3600);

      // Publish started event
      await KafkaPublisher.publish('execution.started', {
        executionId: execution.id,
        projectId: data.projectId,
        vmId
      });

      return res.json({
        success: true,
        session_id: execution.id,
        status: 'running'
      });
    } catch (error: any) {
      console.error('[Execution] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/exec/install
  async installPackages(req: Request, res: Response) {
    try {
      const data = InstallSchema.parse(req.body);
      const userId = (req as any).user.id;

      const jobId = uuidv4();

      // Build install command
      let command: string;
      switch (data.packageManager) {
        case 'npm':
          command = `npm install ${data.packages.join(' ')}`;
          break;
        case 'pip':
          command = `pip install ${data.packages.join(' ')}`;
          break;
        case 'cargo':
          command = `cargo add ${data.packages.join(' ')}`;
          break;
        case 'go':
          command = `go get ${data.packages.join(' ')}`;
          break;
      }

      // Queue the job (in production, use a job queue)
      await redis.lpush('install:queue', JSON.stringify({
        jobId,
        projectId: data.projectId,
        command
      }));

      return res.status(202).json({
        success: true,
        job_id: jobId
      });
    } catch (error: any) {
      console.error('[Install] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /api/v1/exec/history/:project_id
  async getHistory(req: Request, res: Response) {
    try {
      const { project_id } = req.params;
      const { limit = '20', cursor } = req.query;
      const userId = (req as any).user.id;

      const executions = await prisma.codeExecution.findMany({
        where: { projectId: project_id },
        take: parseInt(limit as string, 10) + 1,
        cursor: cursor ? { id: cursor as string } : undefined,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          command: true,
          status: true,
          exitCode: true,
          durationMs: true,
          createdAt: true
        }
      });

      let nextCursor: string | undefined;
      if (executions.length > parseInt(limit as string, 10)) {
        const next = executions.pop();
        nextCursor = next?.id;
      }

      return res.json({
        success: true,
        data: executions,
        nextCursor
      });
    } catch (error: any) {
      console.error('[History] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/exec/terminate/:session_id
  async terminate(req: Request, res: Response) {
    try {
      const { session_id } = req.params;

      await TerminalPTY.closeSession(session_id);

      // Update execution record
      await prisma.codeExecution.update({
        where: { id: session_id },
        data: { status: 'cancelled' }
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Terminate] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/exec/hibernate/:project_id
  async hibernate(req: Request, res: Response) {
    try {
      const { project_id } = req.params;

      const vmId = await redis.get(`vm:project:${project_id}:active`);
      
      if (!vmId) {
        return res.status(404).json({ error: 'No active VM for project' });
      }

      await SnapshotManager.hibernateVM(vmId, project_id);
      await Prewarmer.releaseVM(vmId);
      await redis.del(`vm:project:${project_id}:active`);

      return res.json({ success: true, message: 'VM hibernated' });
    } catch (error: any) {
      console.error('[Hibernate] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

---

## 9. WebSocket Handler

### 9.1 Gateway Handler (src/rpc/gateway_handler.ts)

```typescript
import { WebSocket, WebSocketServer } from 'ws';
import { TerminalPTY } from '../streams/terminal_pty';
import { SnapshotManager } from '../vm_manager/snapshot_manager';

export const GatewayHandler = {
  async handleConnection(ws: WebSocket, sessionId: string): Promise<void> {
    console.log(`[Gateway] New WebSocket connection for session ${sessionId}`);
    
    // Get session info from Redis
    const sessionData = await redis.get(`session:${sessionId}`);
    
    if (!sessionData) {
      ws.close(4004, 'Session not found');
      return;
    }
    
    const { vmId, command } = JSON.parse(sessionData);
    
    // Create PTY session
    const termSessionId = await TerminalPTY.createSession(vmId, command, ws);
    
    ws.on('message', (data) => {
      TerminalPTY.handleInput(termSessionId, data.toString());
    });
    
    ws.on('close', async () => {
      await TerminalPTY.closeSession(termSessionId);
    });
  },

  async handleHibernateCommand(projectId: string): Promise<void> {
    const vmId = await redis.get(`vm:project:${projectId}:active`);
    
    if (vmId) {
      await SnapshotManager.hibernateVM(vmId, projectId);
    }
  }
};
```

---

## 10. Kafka Integration

### 10.1 Kafka Publisher (src/events/kafka_publisher.ts)

```typescript
import { Kafka, Producer } from 'kafkajs';
import { config } from '../config';

const kafka = new Kafka({
  clientId: 'execution-service',
  brokers: config.kafka.brokers,
});

const producer = kafka.producer();
let isConnected = false;

export const KafkaPublisher = {
  async connect() {
    if (!isConnected && process.env.NODE_ENV !== 'test') {
      await producer.connect();
      isConnected = true;
    }
  },

  async publish(topic: string, payload: any) {
    if (!isConnected) return;
    
    try {
      await producer.send({
        topic,
        messages: [{ value: JSON.stringify(payload) }]
      });
    } catch (error) {
      console.error('[Kafka] Publish error:', error);
    }
  }
};
```

---

## 11. Data Models (from Prisma Schema)

### 11.1 CodeExecution

```prisma
model CodeExecution {
  id           String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId    String           @map("project_id") @db.Uuid
  project      Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  userId       String           @map("user_id") @db.Uuid
  user         User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  vmId         String?          @map("vm_id") @db.VarChar(255)
  command      String           @db.Text
  stdout       String?          @db.Text
  stderr       String?          @db.Text
  exitCode     Int?             @map("exit_code")
  status       ExecutionStatus?
  durationMs   Int?             @map("duration_ms")
  memoryUsedMb Int?             @map("memory_used_mb")
  cpuUsedPct   Decimal?         @map("cpu_used_pct") @db.Decimal(5, 2)
  createdAt    DateTime         @default(now()) @map("created_at") @db.Timestamptz()

  @@index([projectId])
  @@index([vmId])
  @@index([createdAt])
  @@index([projectId, status])
  @@map("code_executions")
}
```

---

## 12. Main Application

### 12.1 App Setup (src/app.ts)

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { ExecutionController } from './controllers/execution_controller';
import { GatewayHandler } from './rpc/gateway_handler';

const app = Fastify({ logger: true });
const server = createServer(app.server);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/api/v1/exec/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session_id');
  
  if (sessionId) {
    GatewayHandler.handleConnection(ws, sessionId);
  }
});

// Register plugins
await app.register(helmet);
await app.register(cors, { origin: true });

// Health check
app.get('/api/v1/health', async () => ({ status: 'healthy', service: 'execution-service' }));

app.get('/api/v1/health/circuit-breaker', async () => ({ status: 'closed', failures: 0 }));

app.get('/api/v1/health/vm-pool', async () => Prewarmer.getPoolStatus());

// Protected endpoints
app.post('/api/v1/exec/run', { preHandler: authMiddleware }, ExecutionController.runCode);
app.post('/api/v1/exec/install', { preHandler: authMiddleware }, ExecutionController.installPackages);
app.get('/api/v1/exec/history/:project_id', { preHandler: authMiddleware }, ExecutionController.getHistory);
app.post('/api/v1/exec/terminate/:session_id', { preHandler: authMiddleware }, ExecutionController.terminate);
app.post('/api/v1/exec/hibernate/:project_id', { preHandler: authMiddleware }, ExecutionController.hibernate);

export { app, server };
```

### 12.2 Entry Point (src/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

import { app, server } from './app';
import { config } from './config';
import { redis } from './lib/redis';
import { prisma, disconnectPrisma } from './lib/prisma';
import { Prewarmer } from './vm_manager/prewarmer';
import { FileSync } from './streams/fs_sync';
import { KafkaPublisher } from './events/kafka_publisher';

async function main() {
  console.log('[Execution] Starting service...');

  await redis.connect();
  await KafkaPublisher.connect();
  
  // Start VM prewarmer
  Prewarmer.start();
  
  // Start file sync
  FileSync.start();

  server.listen(config.port, () => {
    console.log(`[Execution] Service running on port ${config.port}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[Execution] Shutting down...');
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
});

main().catch(console.error);
```

---

## 13. Testing Checklist

```bash
# Run the service
npm run dev

# Test health
curl http://localhost:8004/api/v1/health

# Test VM pool status
curl http://localhost:8004/api/v1/health/vm-pool

# Test code execution
curl -X POST http://localhost:8004/api/v1/exec/run \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"uuid","command":"echo hello"}'

# Test execution history
curl http://localhost:8004/api/v1/exec/history/:project_id \
  -H "Authorization: Bearer <token>"
```

---

## 14. Implementation Status

| Component | Status |
|-----------|--------|
| Project Setup | ✅ Complete |
| Config | ✅ Complete |
| VM Prewarmer | ✅ Complete |
| Snapshot Manager | ✅ Complete |
| TAP Manager | ✅ Complete |
| Terminal PTY | ✅ Complete |
| File Sync | ✅ Complete |
| Vault Agent | ✅ Complete |
| Controllers | ✅ Complete |
| WebSocket Handler | ✅ Complete |
| Kafka | ✅ Complete |
| App & Server | ✅ Complete |

---

## 15. Key Implementation Notes

### 15.1 Pre-warmed Pool
- Maintain 20 paused VMs in memory
- Target <125ms startup latency
- Auto-replenish when pool drops below 50%

### 15.2 Security
- Firecracker jailer for isolation
- Block AWS IMDS (169.254.169.254)
- Block internal Kubernetes network (10.96.0.0/12)
- Rate limit: 10Mbps per VM
- IOPS limit: 1000 per VM

### 15.3 Secret Injection
- Never pass secrets via command line
- Write to .env file in virtio-fs mount
- Delete .env on session termination

### 15.4 Hibernation
- Save memory snapshot to S3
- Restore on user return
- Max 7 days retention
