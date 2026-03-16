import Redis from 'ioredis';
import { config } from '../config/index';
import { logger } from '../lib/logger';

let redis: Redis | null = null;
let subscriber: Redis | null = null;

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

    // Create separate subscriber connection
    subscriber = redis.duplicate();
    await subscriber.ping();
    logger.info('Redis subscriber connected');
  } catch (error) {
    logger.warn({ error }, 'Redis connection failed, continuing without cache');
    redis = null;
    subscriber = null;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
  logger.info('Redis disconnected');
}

export function getSubscriber(): Redis | null {
  return subscriber;
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

// Pub/Sub helpers
export async function publish(channel: string, message: unknown): Promise<void> {
  if (!redis) {
    logger.warn({ channel }, 'Redis not connected, cannot publish');
    return;
  }
  await redis.publish(channel, JSON.stringify(message));
}

export async function subscribe(
  channel: string,
  callback: (message: unknown) => void
): Promise<Redis | null> {
  if (!subscriber) {
    logger.warn('Redis subscriber not connected, cannot subscribe');
    return null;
  }

  await subscriber.subscribe(channel);

  subscriber.on('message', (ch, message) => {
    if (ch === channel) {
      try {
        callback(JSON.parse(message));
      } catch {
        callback(message);
      }
    }
  });

  return subscriber;
}

export default redis;
