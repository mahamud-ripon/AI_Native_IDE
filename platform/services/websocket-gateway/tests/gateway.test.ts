import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/redis.js', () => ({
  getRedis: vi.fn(() => null),
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn(),
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 100, resetAt: Date.now() + 3600000 })),
}));

vi.mock('../src/config/index.js', () => ({
  config: {
    port: 8012,
    nodeEnv: 'test',
    jwt: { secret: 'test-secret' },
    redis: { url: 'redis://localhost:6379' },
    services: { collab: 'localhost:8005', execution: 'localhost:8004', ai: 'localhost:8003' },
    rateLimit: { perSecond: 500 },
    heartbeat: { pingInterval: 30000, pingTimeout: 90000 },
    internalApiKey: 'test-api-key',
  },
}));

import { ConnectionManager } from '../src/connection/manager';
import { HeartbeatManager } from '../src/connection/heartbeat';
import { buildApp } from '../src/app';
import type { FastifyInstance } from 'fastify';

describe('WebSocket Gateway', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Endpoints', () => {
    it('GET /health should return healthy status', async () => {
      app = await buildApp();
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('status', 'ok');
      expect(response.json()).toHaveProperty('service', 'websocket-gateway');
    });

    it('GET /health/circuit-breaker should return circuit breaker status', async () => {
      app = await buildApp();
      const response = await app.inject({ method: 'GET', url: '/health/circuit-breaker' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('status', 'closed');
    });
  });

  describe('Stats Endpoints', () => {
    it('GET /api/v1/ws/stats should return connection stats', async () => {
      app = await buildApp();
      const response = await app.inject({ method: 'GET', url: '/api/v1/ws/stats' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('active_connections');
      expect(response.json()).toHaveProperty('active_users');
    });

    it('GET /api/v1/ws/user/:userId should return user connections', async () => {
      app = await buildApp();
      const response = await app.inject({ method: 'GET', url: '/api/v1/ws/user/user-123' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('userId', 'user-123');
      expect(response.json()).toHaveProperty('connectionCount');
    });
  });

  describe('Connection Manager', () => {
    it('should track active connections', () => {
      const count = ConnectionManager.getActiveConnectionCount();
      expect(count).toBe(0);
    });

    it('should track active users', () => {
      const count = ConnectionManager.getActiveUserCount();
      expect(count).toBe(0);
    });

    it('should return undefined for non-existent connection', () => {
      const conn = ConnectionManager.getConnection('non-existent');
      expect(conn).toBeUndefined();
    });

    it('should return empty array for non-existent user connections', () => {
      const conns = ConnectionManager.getUserConnections('non-existent-user');
      expect(conns).toEqual([]);
    });
  });

  describe('Heartbeat Manager', () => {
    it('should start and stop without errors', () => {
      HeartbeatManager.start();
      expect(() => HeartbeatManager.stop()).not.toThrow();
    });

    it('should update ping for existing connection', () => {
      HeartbeatManager.start();
      // Connection doesn't exist, should handle gracefully
      HeartbeatManager.updatePing('non-existent-conn');
      HeartbeatManager.stop();
    });
  });

  describe('Message Routing', () => {
    it('should send to connection returns false for non-existent', () => {
      const result = ConnectionManager.sendToConnection('non-existent', { type: 'test' });
      expect(result).toBe(false);
    });

    it('should broadcast to channel returns 0 for no connections', () => {
      const count = ConnectionManager.broadcastToChannel('test:channel', { type: 'test' });
      expect(count).toBe(0);
    });
  });
});
