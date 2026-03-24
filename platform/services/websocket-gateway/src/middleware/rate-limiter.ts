import { FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { checkRateLimit, getRedis } from '../lib/redis';
import { logger } from '../lib/logger';

const RATE_LIMIT = {
  limit: 500,
  windowSeconds: 1,
};

/**
 * WebSocket rate limiter middleware.
 * Returns boolean indicating if connection is allowed.
 * Caller must close socket if false is returned.
 */
export async function wsRateLimiterMiddleware(
  request: FastifyRequest,
  socket: WebSocket
): Promise<boolean> {
  const redis = getRedis();

  if (!redis) {
    return true; // Allow if Redis unavailable
  }

  const ip = request.ip || 'unknown';
  const key = `rate-limit:ws:${ip}`;

  try {
    const result = await checkRateLimit(key, RATE_LIMIT.limit, RATE_LIMIT.windowSeconds);

    if (!result.allowed) {
      logger.warn({ ip, limit: RATE_LIMIT.limit }, 'WebSocket rate limit exceeded');
      return false; // Caller will close the socket
    }

    return true;
  } catch (error) {
    logger.error({ error }, 'Rate limiter error');
    return true; // Allow on error (fail open for availability)
  }
}

export default wsRateLimiterMiddleware;
