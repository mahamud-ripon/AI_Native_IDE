/**
 * Unit Tests for Edge Authentication Middleware
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { edgeAuthMiddleware, isPublicPath, getRequestUser } from '../../src/middleware/edge_auth';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Generate test keys
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('Edge Authentication Middleware', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(() => {
    app = Fastify();
    process.env.JWT_PUBLIC_KEY = publicKey;
    
    // Add a protected route
    app.get('/protected', async (request: FastifyRequest, reply: FastifyReply) => {
      await edgeAuthMiddleware(request, reply);
      const user = getRequestUser(request);
      return { user };
    });

    // Add a public route
    app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
      await edgeAuthMiddleware(request, reply);
      return { status: 'ok' };
    });
  });

  describe('Public Path Detection', () => {
    it('should identify auth paths as public', () => {
      expect(isPublicPath('/api/v1/auth/login')).toBe(true);
      expect(isPublicPath('/api/v1/auth/register')).toBe(true);
      expect(isPublicPath('/api/v1/auth/refresh')).toBe(true);
      expect(isPublicPath('/api/v1/auth/forgot-password')).toBe(true);
      expect(isPublicPath('/api/v1/auth/oauth/github')).toBe(true);
    });

    it('should identify health as public', () => {
      expect(isPublicPath('/health')).toBe(true);
    });

    it('should identify project paths as protected', () => {
      expect(isPublicPath('/api/v1/projects')).toBe(false);
      expect(isPublicPath('/api/v1/projects/123')).toBe(false);
    });
  });

  describe('JWT Validation', () => {
    it('should reject requests without authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('Missing Authorization');
    });

    it('should reject malformed authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('Invalid Authorization format');
    });

    it('should reject invalid token format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: 'Bearer invalid.token.here' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should accept valid RS256 tokens', async () => {
      const token = jwt.sign(
        { 
          sub: 'user-123', 
          email: 'test@example.com', 
          role: 'user',
          iss: 'ai-native-ide.auth'
        },
        privateKey,
        { algorithm: 'RS256', expiresIn: '15m' }
      );

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${token}` },
      });

      // Route handler will run after middleware
      expect(response.statusCode).not.toBe(401);
    });

    it('should inject X-User-Id header', async () => {
      const token = jwt.sign(
        { 
          sub: 'user-456', 
          email: 'inject@test.com', 
          role: 'admin',
          iss: 'ai-native-ide.auth'
        },
        privateKey,
        { algorithm: 'RS256', expiresIn: '15m' }
      );

      // Create a test route that checks headers
      app.get('/check-headers', async (request: FastifyRequest, reply: FastifyReply) => {
        await edgeAuthMiddleware(request, reply);
        if (reply.sent) return;
        
        return {
          userId: request.headers['x-user-id'],
          userRole: request.headers['x-user-role'],
          userEmail: request.headers['x-user-email'],
        };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/check-headers',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.userId).toBe('user-456');
      expect(body.userRole).toBe('admin');
      expect(body.userEmail).toBe('inject@test.com');
    });

    it('should strip spoofed headers', async () => {
      const token = jwt.sign(
        { 
          sub: 'real-user', 
          email: 'real@test.com', 
          role: 'user',
          iss: 'ai-native-ide.auth'
        },
        privateKey,
        { algorithm: 'RS256', expiresIn: '15m' }
      );

      app.get('/check-spoof', async (request: FastifyRequest, reply: FastifyReply) => {
        // Pre-set spoofed headers (simulating malicious client)
        request.headers['x-user-id'] = 'spoofed-user';
        request.headers['x-user-role'] = 'admin';
        
        await edgeAuthMiddleware(request, reply);
        if (reply.sent) return;
        
        return {
          userId: request.headers['x-user-id'],
        };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/check-spoof',
        headers: { 
          authorization: `Bearer ${token}`,
          'x-user-id': 'spoofed-user',
          'x-user-role': 'admin'
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      // Should use the real user ID from JWT, not the spoofed one
      expect(body.userId).toBe('real-user');
    });
  });

  describe('Token Expiration', () => {
    it('should reject expired tokens', async () => {
      const expiredToken = jwt.sign(
        { 
          sub: 'user-789', 
          email: 'expired@test.com', 
          role: 'user',
          iss: 'ai-native-ide.auth'
        },
        privateKey,
        { algorithm: 'RS256', expiresIn: '-1h' } // Already expired
      );

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${expiredToken}` },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('Invalid Claims', () => {
    it('should reject tokens without sub claim', async () => {
      const badToken = jwt.sign(
        { 
          email: 'bad@test.com',
          role: 'user',
          iss: 'ai-native-ide.auth'
          // missing 'sub'
        },
        privateKey,
        { algorithm: 'RS256', expiresIn: '15m' }
      );

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${badToken}` },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.payload).error).toContain('Invalid token claims');
    });

    it('should reject tokens without email claim', async () => {
      const badToken = jwt.sign(
        { 
          sub: 'user-123',
          role: 'user',
          iss: 'ai-native-ide.auth'
          // missing 'email'
        },
        privateKey,
        { algorithm: 'RS256', expiresIn: '15m' }
      );

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${badToken}` },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.payload).error).toContain('Invalid token claims');
    });
  });
});
