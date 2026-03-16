import Redis from 'ioredis';
import { config } from '../config/index.js';

export const redis = new Redis(config.redis.url, {
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err));

export const RedisKeys = {
  inbox: (userId: string) => `inbox:${userId}`,
  notificationChannel: (userId: string) => `notifications:${userId}`
};
