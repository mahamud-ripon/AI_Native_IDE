import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Search Service Health Endpoints', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.KAFKA_ENABLED = 'false';
    // Support both API Key and Username/Password for tests
    process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';
    process.env.ELASTICSEARCH_API_KEY = 'test-api-key';
    // Alternatively, you can use:
    // process.env.ELASTICSEARCH_USERNAME = 'elastic';
    // process.env.ELASTICSEARCH_PASSWORD = 'password';

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
    expect(body.service).toBe('search-service');
  });

  it('should return circuit breaker status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/circuit-breaker',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('closed');
    expect(body.failures).toBe(0);
  });

  it('should reject code search without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/code',
      query: { q: 'test', projectId: 'test-id' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should reject file search without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/files',
      query: { q: 'test', projectId: 'test-id' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should allow public project discovery without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/projects',
      query: { q: 'test' },
    });

    // May return 500 if ES not available, but should not return 401
    expect(response.statusCode).not.toBe(401);
  });
});
