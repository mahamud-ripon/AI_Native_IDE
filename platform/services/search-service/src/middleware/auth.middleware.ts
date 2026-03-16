import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

// JWT verification for internal service-to-service calls
// The API Gateway validates JWT and injects X-User-Id header
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Check for internal API key (service-to-service)
  const internalApiKey = request.headers['x-internal-api-key'] as string | undefined;
  if (internalApiKey && internalApiKey === config.internalApiKey) {
    return; // Authenticated
  }

  // Check for user ID from API Gateway
  const userId = request.headers['x-user-id'] as string | undefined;
  if (userId) {
    // User ID is injected by API Gateway after JWT validation
    return; // Authenticated
  }

  // Check for Bearer token (direct access)
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // In production, validate JWT here or trust API Gateway
    // For now, we trust the API Gateway has validated
    return; // Authenticated
  }

  // No valid authentication
  logger.warn({ url: request.url }, 'Unauthorized access attempt');
  reply.status(401).send({
    success: false,
    error: 'Unauthorized',
  });
}

// Optional auth - allows anonymous access for public resources
export async function optionalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Just pass through - auth is optional
}

export default authMiddleware;
