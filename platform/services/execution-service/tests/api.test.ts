import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

// Mock dependencies before importing app
vi.mock('../src/lib/redis.js', () => ({
  redis: {
    connect: vi.fn(),
    quit: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    sadd: vi.fn(),
    spop: vi.fn(),
    keys: vi.fn(),
    ttl: vi.fn(),
    lpush: vi.fn(),
    publish: vi.fn(),
    duplicate: vi.fn().mockReturnValue({
      subscribe: vi.fn(),
      on: vi.fn()
    })
  },
  RedisKeys: {
    vmPool: 'vm:pool:ready',
    vmState: (vmId: string) => `vm:${vmId}:state`,
    vmProject: (projectId: string) => `vm:project:${projectId}:active`,
    session: (sessionId: string) => `session:${sessionId}`,
    terminal: (sessionId: string) => `terminal:${sessionId}`
  }
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    codeExecution: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn()
    },
    projectCollaborator: {
      findFirst: vi.fn()
    },
    projectSecret: {
      findMany: vi.fn()
    },
    $disconnect: vi.fn()
  },
  disconnectPrisma: vi.fn()
}));

vi.mock('../src/vm_manager/prewarmer.js', () => ({
  Prewarmer: {
    start: vi.fn(),
    acquireVM: vi.fn().mockResolvedValue('vm-test-123'),
    releaseVM: vi.fn(),
    getPoolStatus: vi.fn().mockReturnValue({ ready: 10, running: 5, total: 15 })
  }
}));

vi.mock('../src/streams/terminal_pty.js', () => ({
  TerminalPTY: {
    createSession: vi.fn().mockResolvedValue('session-123'),
    handleInput: vi.fn(),
    closeSession: vi.fn(),
    getActiveSessions: vi.fn().mockReturnValue(3)
  }
}));

vi.mock('../src/streams/fs_sync.js', () => ({
  FileSync: {
    start: vi.fn()
  }
}));

vi.mock('../src/events/kafka_publisher.js', () => ({
  KafkaPublisher: {
    connect: vi.fn(),
    publish: vi.fn()
  }
}));

vi.mock('../src/vm_manager/snapshot_manager.js', () => ({
  SnapshotManager: {
    hibernateVM: vi.fn(),
    restoreVM: vi.fn(),
    cleanupStaleSnapshots: vi.fn()
  }
}));

vi.mock('../src/security/vault_agent.js', () => ({
  VaultAgent: {
    getSecret: vi.fn(),
    injectSecretsAsEnvFile: vi.fn().mockResolvedValue('KEY=value\n')
  }
}));

import { app } from '../src/app.js';

describe('Execution Service API', () => {
  describe('Health Endpoints', () => {
    it('GET /api/v1/health should return healthy', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('execution-service');
    });

    it('GET /api/v1/health/circuit-breaker should return status', async () => {
      const response = await request(app)
        .get('/api/v1/health/circuit-breaker')
        .expect(200);

      expect(response.body.status).toBe('closed');
    });

    it('GET /api/v1/health/vm-pool should return pool status', async () => {
      const response = await request(app)
        .get('/api/v1/health/vm-pool')
        .expect(200);

      expect(response.body).toHaveProperty('ready');
      expect(response.body).toHaveProperty('running');
      expect(response.body).toHaveProperty('total');
    });
  });

  describe('Protected Endpoints', () => {
    it('POST /api/v1/exec/run should return 401 without auth', async () => {
      await request(app)
        .post('/api/v1/exec/run')
        .send({ projectId: 'test-id', command: 'echo hello' })
        .expect(401);
    });

    it('POST /api/v1/exec/install should return 401 without auth', async () => {
      await request(app)
        .post('/api/v1/exec/install')
        .send({ projectId: 'test-id', packageManager: 'npm', packages: ['lodash'] })
        .expect(401);
    });

    it('GET /api/v1/exec/history/:project_id should return 401 without auth', async () => {
      await request(app)
        .get('/api/v1/exec/history/test-id')
        .expect(401);
    });
  });
});
