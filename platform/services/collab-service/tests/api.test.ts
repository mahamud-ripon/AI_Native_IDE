import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fastify, registerPlugins } from '../src/app.js';

describe('Collab Service API', () => {
  beforeAll(async () => {
    await registerPlugins();
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  describe('Health Endpoints', () => {
    it('GET /health should return ok', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', service: 'collab-service' });
    });

    it('GET /health/circuit-breaker should return status', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/health/circuit-breaker'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('status', 'closed');
    });
  });

  describe('Protected Endpoints', () => {
    it('GET /api/v1/collab/documents should return 401 without auth', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/collab/documents'
      });

      expect(response.statusCode).toBe(401);
    });

    it('GET /api/v1/collab/files/:file_id should return 401 without auth', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/collab/files/test-file-id'
      });

      expect(response.statusCode).toBe(401);
    });

    it('POST /api/v1/collab/join should return 401 without auth', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/v1/collab/join',
        payload: {
          projectId: 'test-project',
          fileId: 'test-file'
        }
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Internal Endpoints', () => {
    it('GET /api/v1/collab/stats should return 401 without api key', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/collab/stats'
      });

      expect(response.statusCode).toBe(401);
    });

    it('GET /api/v1/collab/stats should work with valid api key', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/collab/stats',
        headers: {
          'x-api-key': 'dev-internal-key'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('success', true);
      expect(response.json().data).toHaveProperty('activeDocs');
    });
  });
});
