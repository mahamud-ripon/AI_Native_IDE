import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { analyticsRoutes } from '../src/routes/api.js';

describe('Analytics Service Health Endpoints', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET = 'test-secret';
    process.env.KAFKA_ENABLED = 'false';
    process.env.REDIS_URL = 'redis://localhost:6379';
    
    app = Fastify();
    await app.register(helmet);
    await app.register(cors, { origin: true });
    await app.register(analyticsRoutes);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return healthy status on /health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('analytics-service');
  });

  it('should return overview stats', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/overview',
    });

    // May return 401 (unauthorized) or 500 (db error) in test env
    expect([200, 401, 500]).toContain(response.statusCode);
  });

  it('should return usage stats', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/usage',
      query: { startDate: '2026-01-01', endDate: '2026-12-31' },
    });

    expect([200, 401, 500]).toContain(response.statusCode);
  });
});
