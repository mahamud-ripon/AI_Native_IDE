import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';
import { createLogger } from '../lib/logger';
import { JwtVerifier } from '../lib/jwt';

const logger = createLogger('auth-middleware');

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  iat?: number;
  exp?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

/**
 * JWT Authentication middleware
 * Validates JWT token from Authorization header
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  logger.info('Auth middleware called', {
    path: request.url,
    method: request.method,
    hasAuthHeader: !!request.headers.authorization,
    authHeaderPrefix: request.headers.authorization?.substring(0, 20),
  });

  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or invalid Authorization header', {
      path: request.url,
      method: request.method,
    });
    reply.code(401).send({
      success: false,
      error: 'Unauthorized: Missing or invalid Authorization header',
      traceId: request.id,
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = JwtVerifier.verifyAccessToken(token);

    if (!payload || !payload.sub) {
      throw new Error('Invalid token payload');
    }

    // Check token expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new Error('Token expired');
    }

    request.user = payload as JwtPayload;
    logger.debug('User authenticated', { userId: payload.sub, path: request.url });
  } catch (error) {
    logger.warn('JWT validation failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: request.url,
    });
    reply.code(401).send({
      success: false,
      error: 'Unauthorized: Invalid or expired token',
      traceId: request.id,
    });
    return;
  }
}

/**
 * Optional auth middleware - doesn't fail if no token
 */
export async function optionalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const payload = decodeJwtToken(token);
      if (payload && payload.sub) {
        request.user = payload;
      }
    } catch {
      // Ignore errors for optional auth
    }
  }
}

/**
 * Internal API key middleware for service-to-service calls
 */
export async function internalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-internal-api-key'];

  if (!apiKey || apiKey !== config.internalApiKey) {
    logger.warn('Invalid internal API key', { path: request.url });
    reply.code(401).send({
      success: false,
      error: 'Unauthorized: Invalid internal API key',
      traceId: request.id,
    });
    return;
  }

  // Set user from x-user-id header for internal service calls
  const userId = request.headers['x-user-id'] as string;
  if (userId) {
    (request as any).user = { sub: userId, role: 'system' };
  }
}

/**
 * Decode JWT token (simplified - in production use proper verification)
 */
function decodeJwtToken(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Mixed API key / JWT authentication middleware
 */
export async function mixedAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.headers['x-internal-api-key']) {
    return internalAuthMiddleware(request, reply);
  }
  return authMiddleware(request, reply);
}

/**
 * Require user role check decorator
 */
export function requireRole(role: 'viewer' | 'editor' | 'owner') {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.code(401).send({
        success: false,
        error: 'Unauthorized',
        traceId: request.id,
      });
      return;
    }

    // Role checking is done in controllers with permissionService
    // This is just a placeholder for additional role checks
  };
}
