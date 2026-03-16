import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index';
import { logger } from '../lib/logger';

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Authentication middleware
 * 
 * Supports multiple auth methods:
 * 1. Internal API key (service-to-service)
 * 2. X-User-Id header (from API Gateway after JWT validation)
 * 3. Bearer token (direct JWT)
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Check for internal API key (service-to-service)
  const internalApiKey = request.headers['x-internal-api-key'] as string | undefined;
  if (internalApiKey && internalApiKey === config.internalApiKey) {
    // Internal service call - full access
    request.user = { id: 'internal', role: 'service' };
    return;
  }

  // Check for user ID from API Gateway (already validated JWT)
  const userId = request.headers['x-user-id'] as string | undefined;
  if (userId) {
    request.user = { id: userId };
    return;
  }

  // Check for Bearer token (direct access)
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // In production, validate JWT here
    // For now, trust the API Gateway has validated
    const token = authHeader.substring(7);
    
    // Simple token validation (in production, use proper JWT verification)
    if (token && token.length > 10) {
      // Extract user ID from token or use a default
      request.user = { id: 'token-user' };
      return;
    }
  }

  // No valid authentication
  logger.warn({ url: request.url }, 'Unauthorized access attempt');
  reply.status(401).send({
    success: false,
    error: 'Unauthorized',
  });
}

/**
 * Optional auth middleware - allows anonymous access
 */
export async function optionalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Try to authenticate but don't reject if no auth
  const userId = request.headers['x-user-id'] as string | undefined;
  if (userId) {
    request.user = { id: userId };
  }
}

/**
 * Admin auth middleware - requires internal API key or admin role
 */
export async function adminAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const internalApiKey = request.headers['x-internal-api-key'] as string | undefined;
  
  if (internalApiKey && internalApiKey === config.internalApiKey) {
    request.user = { id: 'internal', role: 'service' };
    return;
  }

  // Check for admin role
  const userRole = request.headers['x-user-role'] as string | undefined;
  if (userRole === 'admin') {
    const userId = request.headers['x-user-id'] as string | undefined;
    request.user = { id: userId || 'admin', role: 'admin' };
    return;
  }

  logger.warn({ url: request.url }, 'Admin access denied');
  reply.status(403).send({
    success: false,
    error: 'Forbidden: Admin access required',
  });
}

export default authMiddleware;
