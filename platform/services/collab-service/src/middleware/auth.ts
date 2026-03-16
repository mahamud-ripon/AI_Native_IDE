import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import crypto from 'crypto';

// Extend FastifyRequest to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      name?: string;
      avatar?: string;
    };
  }
}

interface JwtPayload {
  sub: string;
  email: string;
  name?: string;
  avatar?: string;
  iat?: number;
  exp?: number;
}

/**
 * Verify JWT token using native crypto (no jsonwebtoken dependency)
 */
function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    
    // Verify signature
    const signature = base64UrlDecode(signatureB64);
    const data = `${headerB64}.${payloadB64}`;
    
    const expectedSignature = crypto
      .createHmac('sha256', config.jwtSecret)
      .update(data)
      .digest();
    
    if (!signature.equals(expectedSignature)) {
      return null;
    }

    // Decode payload
    const payloadJson = base64UrlDecode(payloadB64).toString('utf8');
    const payload = JSON.parse(payloadJson) as JwtPayload;
    
    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return null;
    }
    
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Decode base64url to buffer
 */
function base64UrlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

/**
 * Authentication middleware
 * Requires valid JWT token in Authorization header
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header' });
    return;
  }
  
  const token = authHeader.substring(7);
  const payload = verifyJwt(token);
  
  if (!payload) {
    reply.code(401).send({ error: 'Invalid or expired token' });
    return;
  }
  
  request.user = {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    avatar: payload.avatar
  };
}

/**
 * Optional authentication middleware
 * Attempts to verify token but doesn't fail if missing
 */
export async function optionalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return; // No token, continue without user
  }
  
  const token = authHeader.substring(7);
  const payload = verifyJwt(token);
  
  if (payload) {
    request.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      avatar: payload.avatar
    };
  }
}

/**
 * Internal API key middleware
 * For service-to-service communication
 */
export async function internalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined;
  
  if (!apiKey || apiKey !== config.internalApiKey) {
    reply.code(401).send({ error: 'Invalid or missing API key' });
    return;
  }
}
