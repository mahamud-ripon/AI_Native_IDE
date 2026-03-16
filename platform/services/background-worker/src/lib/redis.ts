import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Redis client for BullMQ queues and general caching
export const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Redis client for distributed locking (Redlock)
export const redlockClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisClient.on('error', (err) => {
  console.error('Redis Connection Error:', err);
});

redisClient.on('connect', () => {
  console.log('✅ Connected to Redis');
});

// Distributed lock implementation
export async function acquireLock(lockKey: string, ttlSeconds: number = 60): Promise<boolean> {
  const result = await redlockClient.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

export async function releaseLock(lockKey: string): Promise<void> {
  await redlockClient.del(lockKey);
}
