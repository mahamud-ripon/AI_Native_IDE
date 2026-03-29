import Redis from 'ioredis';
import { config } from '../config/index.js';

export const redis = new Redis(config.redis.url, {
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err));

export const RedisKeys = {
  vmPool: 'vm:pool:ready',
  vmState: (vmId: string) => `vm:${vmId}:state`,
  vmProject: (projectId: string) => `vm:project:${projectId}:active`,
  session: (sessionId: string) => `session:${sessionId}`,
  terminal: (sessionId: string) => `terminal:${sessionId}`
};
