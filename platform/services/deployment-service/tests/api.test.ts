import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('Deployment Service API', () => {
  describe('Health Endpoints', () => {
    it('GET /api/v1/health should return healthy', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('deployment-service');
    });

    it('GET /api/v1/health/circuit-breaker should return status', async () => {
      const response = await request(app)
        .get('/api/v1/health/circuit-breaker')
        .expect(200);

      expect(response.body.status).toBe('closed');
    });
  });

  describe('Protected Endpoints', () => {
    it('POST /api/v1/deploy/preview should return 401 without auth', async () => {
      await request(app)
        .post('/api/v1/deploy/preview')
        .send({ projectId: 'test-id', branch: 'main' })
        .expect(401);
    });

    it('POST /api/v1/deploy/production should return 401 without auth', async () => {
      await request(app)
        .post('/api/v1/deploy/production')
        .send({ projectId: 'test-id', branch: 'main' })
        .expect(401);
    });

    it('GET /api/v1/deploy/history/:project_id should return 401 without auth', async () => {
      await request(app)
        .get('/api/v1/deploy/history/test-id')
        .expect(401);
    });
  });
});
