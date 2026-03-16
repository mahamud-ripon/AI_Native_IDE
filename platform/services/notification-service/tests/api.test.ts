import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

// Mock dependencies
vi.mock('../src/lib/redis.js', () => ({
  redis: {
    connect: vi.fn(),
    quit: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
    lrange: vi.fn().mockResolvedValue([]),
    publish: vi.fn()
  },
  RedisKeys: {
    inbox: (userId: string) => `inbox:${userId}`,
    notificationChannel: (userId: string) => `notifications:${userId}`
  }
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0)
    },
    $disconnect: vi.fn()
  },
  disconnectPrisma: vi.fn()
}));

vi.mock('../src/services/push_service.js', () => ({
  PushService: {
    push: vi.fn(),
    pushBatched: vi.fn(),
    getInbox: vi.fn().mockResolvedValue([]),
    clearInbox: vi.fn()
  }
}));

vi.mock('../src/services/email_service.js', () => ({
  EmailService: {
    send: vi.fn().mockResolvedValue(true),
    sendVerifyEmail: vi.fn().mockResolvedValue(true),
    sendPasswordReset: vi.fn().mockResolvedValue(true),
    sendProjectInvite: vi.fn().mockResolvedValue(true),
    sendPaymentFailed: vi.fn().mockResolvedValue(true)
  }
}));

vi.mock('../src/services/notification_batcher.js', () => ({
  NotificationBatcher: {
    queue: vi.fn(),
    flush: vi.fn(),
    flushAll: vi.fn()
  }
}));

vi.mock('../src/events/kafka_consumer.js', () => ({
  KafkaConsumer: {
    start: vi.fn(),
    disconnect: vi.fn()
  }
}));

vi.mock('../src/workers/email_worker.js', () => ({
  EmailWorker: {
    addJob: vi.fn(),
    start: vi.fn()
  }
}));

import { app } from '../src/app.js';

describe('Notification Service API', () => {
  describe('Health Endpoints', () => {
    it('GET /api/v1/health should return healthy', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('notification-service');
    });

    it('GET /api/v1/health/circuit-breaker should return status', async () => {
      const response = await request(app)
        .get('/api/v1/health/circuit-breaker')
        .expect(200);

      expect(response.body.status).toBe('closed');
    });
  });

  describe('Protected Endpoints', () => {
    it('GET /api/v1/notifications should return 401 without auth', async () => {
      await request(app)
        .get('/api/v1/notifications')
        .expect(401);
    });

    it('PUT /api/v1/notifications/:id/read should return 401 without auth', async () => {
      await request(app)
        .put('/api/v1/notifications/test-id/read')
        .expect(401);
    });

    it('PUT /api/v1/notifications/read-all should return 401 without auth', async () => {
      await request(app)
        .put('/api/v1/notifications/read-all')
        .expect(401);
    });

    it('DELETE /api/v1/notifications/:id should return 401 without auth', async () => {
      await request(app)
        .delete('/api/v1/notifications/test-id')
        .expect(401);
    });

    it('GET /api/v1/notifications/unread-count should return 401 without auth', async () => {
      await request(app)
        .get('/api/v1/notifications/unread-count')
        .expect(401);
    });
  });
});
