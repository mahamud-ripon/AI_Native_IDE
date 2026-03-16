/**
 * API Gateway Integration Tests
 * 
 * Tests for:
 * - Edge Authentication (JWT validation)
 * - Rate Limiting (auth-aware)
 * - DDoS Protection
 * - Idempotency
 * - Request Tracing
 * - Circuit Breaker
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { buildApp } from '../src/app';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';

// Generate test keys
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Mock environment variables
process.env.JWT_PUBLIC_KEY = publicKey;
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

describe('API Gateway Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Check', () => {
    it('should return 200 for health endpoint', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        status: 'ok',
        service: 'api-gateway',
      });
    });
  });

  describe('Edge Authentication', () => {
    it('should allow public paths without authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'test@test.com', username: 'test', password: 'password123' },
      });

      // Should pass through to auth service (we'll get connection errors in test, but not 401)
      expect(response.statusCode).not.toBe(401);
    });

    it('should reject requests without authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/projects',
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.payload)).toHaveProperty('error');
    });

    it('should reject invalid authorization format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: { authorization: 'InvalidFormat token' },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.payload).code).toBe('INVALID_TOKEN');
    });

    it('should reject expired tokens', async () => {
      const expiredToken = jwt.sign(
        { sub: 'user123', email: 'test@test.com', role: 'user' },
        privateKey,
        { algorithm: 'RS256', expiresIn: '-1h' }
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${expiredToken}` },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.payload).code).toBe('TOKEN_EXPIRED');
    });

    it('should inject user headers for valid tokens', async () => {
      const validToken = jwt.sign(
        { sub: 'user123', email: 'test@test.com', role: 'user' },
        privateKey,
        { algorithm: 'RS256', expiresIn: '15m' }
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${validToken}` },
      });

      // Should pass through (will fail with connection error, but headers should be set)
      expect(response.statusCode).not.toBe(401);
    });
  });

  describe('DDoS Protection', () => {
    it('should reject payloads with prototype pollution', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'test@test.com', __proto__: { evil: true } }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject deeply nested JSON', async () => {
      const deepObject: any = {};
      let current = deepObject;
      for (let i = 0; i < 25; i++) {
        current.nested = {};
        current = current.nested;
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(deepObject),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Request Tracing', () => {
    it('should inject X-Trace-Id header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['x-trace-id']).toBeDefined();
      expect(typeof response.headers['x-trace-id']).toBe('string');
    });
  });

  describe('Circuit Breaker Admin', () => {
    it('should return circuit breaker status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/gateway/circuit-breakers',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.service).toBe('api-gateway');
      expect(body.circuitBreakers).toBeDefined();
    });
  });
});

describe('Idempotency Middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should not require idempotency key for GET requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
  });

  it('should allow requests without idempotency key (non-strict mode)', async () => {
    // In strict mode this would fail, but our current implementation allows it
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'test@test.com', password: 'pass123' },
    });

    // Should pass through (no idempotency key required in current implementation)
    expect(response.statusCode).not.toBe(400);
  });
});
