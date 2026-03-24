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
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });

    await redis.ping();
    logger.info('Redis connected successfully');

    // Create separate subscriber connection
    subscriber = redis.duplicate();

    subscriber.on('error', (err) => {
      logger.error({ err }, 'Redis subscriber error');
    });

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
    try {
      await Promise.race([
        redis.quit(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis quit timeout')), 5000)),
      ]);
    } catch {
      redis.disconnect();
    }
    redis = null;
  }
  if (subscriber) {
    try {
      await Promise.race([
        subscriber.quit(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Subscriber quit timeout')), 5000)),
      ]);
    } catch {
      subscriber.disconnect();
    }
    subscriber = null;
  }
  logger.info('Redis disconnected');
}

export function getSubscriber(): Redis | null {
  return subscriber;
}

// Rate limiting helper with atomic Lua script
const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (!redis) {
    return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }

  const result = (await redis.eval(RATE_LIMIT_SCRIPT, 1, key, String(windowSeconds))) as [number, number];
  const current = result[0];
  const ttl = result[1];
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

// Track active listeners to prevent duplicate listener leak
const activeCallbacks = new Map<string, (ch: string, message: string) => void>();

export async function subscribe(
  channel: string,
  callback: (message: unknown) => void
): Promise<Redis | null> {
  if (!subscriber) {
    logger.warn('Redis subscriber not connected, cannot subscribe');
    return null;
  }

  // Remove existing listener for this channel to prevent duplicates
  const existing = activeCallbacks.get(channel);
  if (existing) {
    subscriber.removeListener('message', existing);
  }

  await subscriber.subscribe(channel);

  const handler = (ch: string, message: string) => {
    if (ch === channel) {
      try {
        callback(JSON.parse(message));
      } catch {
        callback(message);
      }
    }
  };

  activeCallbacks.set(channel, handler);
  subscriber.on('message', handler);

  return subscriber;
}

export async function unsubscribe(channel: string): Promise<void> {
  if (!subscriber) return;

  const existing = activeCallbacks.get(channel);
  if (existing) {
    subscriber.removeListener('message', existing);
    activeCallbacks.delete(channel);
  }

  await subscriber.unsubscribe(channel);
}

export default redis;
