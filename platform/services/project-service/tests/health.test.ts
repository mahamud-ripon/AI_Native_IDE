import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import buildApp from '../src/app';

describe('Health Endpoints', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET = 'test-secret';
    process.env.KAFKA_ENABLED = 'false';
    process.env.VAULT_ENABLED = 'false';
    app = await buildApp();
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
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('project-service');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('version');
  });

  it('should return detailed health on /health/detailed', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/detailed',
    });

    // May return 503 if services are not available, which is expected in test env
    expect([200, 503]).toContain(response.statusCode);
    const body = response.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('checks');
    expect(body.checks).toHaveProperty('database');
    expect(body.checks).toHaveProperty('kafka');
    expect(body.checks).toHaveProperty('vault');
  });
});
