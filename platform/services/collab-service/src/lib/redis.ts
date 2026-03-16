import Redis from 'ioredis';
import { config } from '../config.js';

// Main Redis client for Yjs persistence and pub/sub
export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    if (times > 3) {
      console.warn('[Redis] Connection retries exhausted');
      return null;
    }
    return Math.min(times * 100, 2000);
  },
});

// Subscriber client for pub/sub
export const createSubscriber = (): Redis => {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });
};

// Key patterns
export const RedisKeys = {
  yjsDoc: (fileId: string) => `yjs:doc:${fileId}`,
  fileUsers: (fileId: string) => `file:${fileId}:users`,
  collabBroadcast: (fileId: string) => `collab:broadcast:${fileId}`,
  awareness: (fileId: string) => `awareness:${fileId}`,
};

redis.on('connect', () => {
  console.log('[Redis] Connected');
});

redis.on('error', (err) => {
  console.error('[Redis] Error:', err.message);
});
