import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fastify, registerPlugins } from '../src/app.js';

describe('Billing Service API', () => {
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
      expect(response.json()).toEqual({ status: 'ok', service: 'billing-service' });
    });

    it('GET /health/circuit-breaker should return circuit breaker status', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/health/circuit-breaker'
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('status');
      expect(['closed', 'open', 'half-open']).toContain(body.status);
    });
  });

  describe('Plans Endpoint', () => {
    it('GET /api/v1/billing/plans should return all plans', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/billing/plans'
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('plans');
      expect(body.plans).toHaveLength(4);
      expect(body.plans[0]).toHaveProperty('id', 'FREE');
      expect(body.plans[1]).toHaveProperty('id', 'PRO');
    });
  });

  describe('Protected Endpoints', () => {
    it('GET /api/v1/billing/subscription should return 401 without auth', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/billing/subscription'
      });

      expect(response.statusCode).toBe(401);
    });

    it('GET /api/v1/billing/usage/current should return 401 without auth', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/billing/usage/current'
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Internal Endpoints', () => {
    it('POST /api/v1/billing/meter should return 401 without api key', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/v1/billing/meter',
        payload: {
          user_id: '00000000-0000-0000-0000-000000000001',
          type: 'ai_tokens',
          amount: 100
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('POST /api/v1/billing/meter should work with valid api key', async () => {
      const originalKey = process.env.INTERNAL_API_KEY;
      process.env.INTERNAL_API_KEY = 'test-api-key';

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/v1/billing/meter',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          user_id: '00000000-0000-0000-0000-000000000001',
          type: 'ai_tokens',
          amount: 100
        }
      });

      // With DB/Redis connected, should succeed
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('success', true);

      process.env.INTERNAL_API_KEY = originalKey;
    });
  });
});
