import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Auth Service Health Endpoints', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.KAFKA_ENABLED = 'false';
    process.env.REDIS_URL = 'redis://localhost:6379';
    
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
    expect(body.status).toBe('ok');
    expect(body.service).toBe('auth-service');
  });

  it('should reject registration with invalid data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        // Missing required fields
        email: 'invalid-email',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should reject login with missing fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        // Missing password
        email: 'test@test.com',
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
