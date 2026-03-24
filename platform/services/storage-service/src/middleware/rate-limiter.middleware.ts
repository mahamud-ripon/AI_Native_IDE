import { FastifyRequest, FastifyReply } from 'fastify';
import { checkRateLimit, getRedis } from '../lib/redis';
import { logger } from '../lib/logger';

// Rate limit configurations
const RATE_LIMITS = {
  upload: { limit: 100, windowSeconds: 3600 }, // 100 uploads per hour
  download: { limit: 1000, windowSeconds: 3600 }, // 1000 downloads per hour
  default: { limit: 500, windowSeconds: 3600 }, // 500 requests per hour
};

export interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

/**
 * Rate limiter middleware factory
 */
export function rateLimiterMiddleware(type: keyof typeof RATE_LIMITS = 'default') {
  const config = RATE_LIMITS[type];

  return async function (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const redis = getRedis();

    // If Redis is not available, skip rate limiting
    if (!redis) {
      return;
    }

    // Get user identifier
    const userId = request.user?.id || request.ip;
    const key = `rate-limit:${type}:${userId}`;

    try {
      const result = await checkRateLimit(key, config.limit, config.windowSeconds);

      // Set rate limit headers
      reply.header('X-RateLimit-Limit', config.limit);
      reply.header('X-RateLimit-Remaining', result.remaining);
      reply.header('X-RateLimit-Reset', result.resetAt);

      if (!result.allowed) {
        logger.warn({ userId, type, limit: config.limit }, 'Rate limit exceeded');
        
        reply.status(429).send({
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        });
        return;
      }
    } catch (error) {
      logger.error({ error }, 'Rate limiter error');
      // On error, allow the request through
    }
  };
}

/**
 * Upload rate limiter
 */
export const uploadRateLimiter = rateLimiterMiddleware('upload');

/**
 * Download rate limiter
 */
export const downloadRateLimiter = rateLimiterMiddleware('download');

/**
 * Default rate limiter
 */
export const defaultRateLimiter = rateLimiterMiddleware('default');

export default rateLimiterMiddleware;
