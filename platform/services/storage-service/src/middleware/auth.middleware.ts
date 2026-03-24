import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
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
 * 3. Bearer token (direct JWT verification)
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Check for internal API key (service-to-service)
  const internalApiKey = request.headers['x-internal-api-key'] as string | undefined;
  if (internalApiKey && internalApiKey === config.internalApiKey) {
    request.user = { id: 'internal', role: 'service' };
    return;
  }

  // Check for user ID from API Gateway (already validated JWT)
  const userId = request.headers['x-user-id'] as string | undefined;
  if (userId) {
    request.user = { id: userId };
    return;
  }

  // Check for Bearer token (direct JWT verification)
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
      const tokenUserId = decoded.sub;
      
      if (!tokenUserId) {
        throw new Error('Token missing subject claim');
      }

      request.user = {
        id: tokenUserId,
        email: decoded.email as string | undefined,
        role: decoded.role as string | undefined,
      };
      return;
    } catch (error) {
      logger.warn({ error, url: request.url }, 'JWT verification failed');
      reply.status(401).send({
        success: false,
        error: 'Invalid or expired token',
      });
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
    return;
  }

  // Try Bearer token
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
      const tokenUserId = decoded.sub;
      if (tokenUserId) {
        request.user = {
          id: tokenUserId,
          email: decoded.email as string | undefined,
          role: decoded.role as string | undefined,
        };
      }
    } catch {
      // Silently ignore - optional auth
    }
  }
}

/**
 * Admin auth middleware - requires internal API key or admin JWT role
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

  // Admin role must come from verified JWT, not client-supplied header
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
      
      if (decoded.role === 'admin' || decoded.role === 'service') {
        request.user = {
          id: decoded.sub || 'admin',
          email: decoded.email as string | undefined,
          role: decoded.role,
        };
        return;
      }
    } catch {
      // Token invalid - fall through to forbidden
    }
  }

  logger.warn({ url: request.url }, 'Admin access denied');
  reply.status(403).send({
    success: false,
    error: 'Forbidden: Admin access required',
  });
}

export default authMiddleware;
