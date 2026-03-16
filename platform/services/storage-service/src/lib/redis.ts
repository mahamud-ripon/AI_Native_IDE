import Redis from 'ioredis';
import { config } from '../config/index';
import { logger } from '../lib/logger';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  return redis;
}

export async function connectRedis(): Promise<void> {
  if (!config.redis.url) {
    logger.warn('Redis URL not configured, running without cache');
    return;
  }

  try {
    redis = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: () => 100,
      lazyConnect: true,
    });

    await redis.ping();
    logger.info('Redis connected successfully');
  } catch (error) {
    logger.warn({ error }, 'Redis connection failed, continuing without cache');
    redis = null;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis disconnected');
  }
}

// Rate limiting helper
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (!redis) {
    return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }

  const current = await redis.incr(key);
  
  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }

  const ttl = await redis.ttl(key);
  const remaining = Math.max(0, limit - current);
  const resetAt = Date.now() + ttl * 1000;

  return {
    allowed: current <= limit,
    remaining,
    resetAt,
  };
}

export default redis;
