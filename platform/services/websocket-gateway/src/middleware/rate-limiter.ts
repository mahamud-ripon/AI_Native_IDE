import { FastifyRequest, FastifyReply } from 'fastify';
import { checkRateLimit, getRedis } from '../lib/redis';
import { logger } from '../lib/logger';

const RATE_LIMIT = {
  limit: 500,
  windowSeconds: 1,
};

export async function wsRateLimiterMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const redis = getRedis();

  if (!redis) {
    return;
  }

  const ip = request.ip || 'unknown';
  const key = `rate-limit:ws:${ip}`;

  try {
    const result = await checkRateLimit(key, RATE_LIMIT.limit, RATE_LIMIT.windowSeconds);

    reply.header('X-RateLimit-Limit', RATE_LIMIT.limit);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', result.resetAt);

    if (!result.allowed) {
      logger.warn({ ip, limit: RATE_LIMIT.limit }, 'WebSocket rate limit exceeded');
      reply.status(429).send({
        success: false,
        error: 'Too Many Requests',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }
  } catch (error) {
    logger.error({ error }, 'Rate limiter error');
  }
}

export default wsRateLimiterMiddleware;
