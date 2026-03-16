import Redis from 'ioredis';
import { config } from '../config.js';

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
  lazyConnect: true,
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err));

export { redis };

// Lua script for atomic check-and-decrement (prevents TOCTOU race condition)
export const METERING_LUA_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])

local current = tonumber(redis.call('GET', key) or '0')
local remaining = limit - current

if remaining >= amount then
  redis.call('INCRBY', key, amount)
  return remaining - amount
else
  return -1
end
`;

// Register the script once
let meteringSha: string | null = null;

export async function registerMeteringScript(): Promise<void> {
  const result = await redis.script('LOAD', METERING_LUA_SCRIPT);
  meteringSha = typeof result === 'string' ? result : null;
  console.log('[Redis] Metering script registered:', meteringSha?.substring(0, 8));
}

export async function atomicMetering(key: string, limit: number, amount: number): Promise<number> {
  if (meteringSha) {
    const result = await redis.evalsha(meteringSha, 1, key, limit.toString(), amount.toString());
    return parseInt(result as string, 10);
  }
  // Fallback to eval if script not registered
  const result = await redis.eval(METERING_LUA_SCRIPT, 1, key, limit.toString(), amount.toString());
  return parseInt(result as string, 10);
}

// Plan cache helpers
export const PLAN_CACHE_TTL = 3600; // 1 hour

export async function cachePlan(userId: string, plan: string, status: string): Promise<void> {
  await redis.setex(`plan:${userId}`, PLAN_CACHE_TTL, `${plan}:${status}`);
}

export async function getCachedPlan(userId: string): Promise<{ plan: string; status: string } | null> {
  const cached = await redis.get(`plan:${userId}`);
  if (cached) {
    const [plan, status] = cached.split(':');
    return { plan, status };
  }
  return null;
}

export async function invalidatePlanCache(userId: string): Promise<void> {
  await redis.del(`plan:${userId}`);
}
