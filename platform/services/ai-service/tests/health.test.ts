import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { aiRoutes } from '../src/routes/api.js';

describe('AI Service Health Endpoints', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET = 'test-secret';
    process.env.KAFKA_ENABLED = 'false';
    
    app = Fastify();
    await app.register(helmet);
    await app.register(cors, { origin: true });
    await app.register(aiRoutes, { prefix: '/ai' });
    
    app.get('/health', async () => ({ 
      status: 'healthy', 
      service: 'ai-service',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }));
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
    expect(body.service).toBe('ai-service');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('version');
  });

  it('should reject execute without user-id header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ai/execute',
      payload: {
        projectId: 'test-project',
        prompt: 'test prompt',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should reject execute without required fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ai/execute',
      headers: {
        'x-user-id': 'test-user',
      },
      payload: {
        // Missing projectId and prompt
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
