import Redis from 'ioredis';

export type QuotaConfig = {
  redis: Redis;
  userDailyTokenLimit?: number;
  orgMonthlyTokenLimit?: number;
  orgMaxConcurrentWorkflows?: number;
};

const DEFAULT_USER_DAILY_TOKEN_LIMIT = 100_000;
const DEFAULT_ORG_MONTHLY_TOKEN_LIMIT = 1_000_000;
const DEFAULT_ORG_MAX_CONCURRENT_WORKFLOWS = 5;

export type QuotaCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; limit: number; current: number };

export function createQuotaManager(config: QuotaConfig) {
  const redis = config.redis;
  const userDailyLimit = config.userDailyTokenLimit ?? DEFAULT_USER_DAILY_TOKEN_LIMIT;
  const orgMonthlyLimit = config.orgMonthlyTokenLimit ?? DEFAULT_ORG_MONTHLY_TOKEN_LIMIT;
  const orgMaxConcurrent = config.orgMaxConcurrentWorkflows ?? DEFAULT_ORG_MAX_CONCURRENT_WORKFLOWS;

  function getUserDailyKey(userId: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return `quota:user:daily:${userId}:${today}`;
  }

  function getOrgMonthlyKey(orgId: string): string {
    const month = new Date().toISOString().slice(0, 7);
    return `quota:org:monthly:${orgId}:${month}`;
  }

  function getOrgConcurrentKey(orgId: string): string {
    return `quota:org:concurrent:${orgId}`;
  }

  async function checkUserDailyQuota(
    userId: string,
    tokensRequested: number
  ): Promise<QuotaCheckResult> {
    const key = getUserDailyKey(userId);
    const current = parseInt((await redis.get(key)) ?? '0', 10);

    if (current + tokensRequested > userDailyLimit) {
      return {
        allowed: false,
        reason: 'User daily token quota exceeded',
        limit: userDailyLimit,
        current,
      };
    }

    return { allowed: true };
  }

  async function checkOrgMonthlyQuota(
    orgId: string,
    tokensRequested: number
  ): Promise<QuotaCheckResult> {
    const key = getOrgMonthlyKey(orgId);
    const current = parseInt((await redis.get(key)) ?? '0', 10);

    if (current + tokensRequested > orgMonthlyLimit) {
      return {
        allowed: false,
        reason: 'Organization monthly token quota exceeded',
        limit: orgMonthlyLimit,
        current,
      };
    }

    return { allowed: true };
  }

  async function checkOrgConcurrentWorkflows(orgId: string): Promise<QuotaCheckResult> {
    const key = getOrgConcurrentKey(orgId);
    const current = parseInt((await redis.get(key)) ?? '0', 10);

    if (current >= orgMaxConcurrent) {
      return {
        allowed: false,
        reason: 'Organization max concurrent workflows exceeded',
        limit: orgMaxConcurrent,
        current,
      };
    }

    return { allowed: true };
  }

  async function recordUserTokens(userId: string, tokens: number): Promise<void> {
    const key = getUserDailyKey(userId);
    await redis.incrby(key, tokens);
    await redis.expire(key, 86400 * 2); // 2 days TTL
  }

  async function recordOrgTokens(orgId: string, tokens: number): Promise<void> {
    const key = getOrgMonthlyKey(orgId);
    await redis.incrby(key, tokens);
    await redis.expire(key, 86400 * 32); // 32 days TTL
  }

  async function incrementOrgConcurrent(orgId: string): Promise<void> {
    const key = getOrgConcurrentKey(orgId);
    await redis.incr(key);
  }

  async function decrementOrgConcurrent(orgId: string): Promise<void> {
    const key = getOrgConcurrentKey(orgId);
    await redis.decr(key);
  }

  async function assertQuota(args: {
    userId: string;
    orgId?: string;
    tokensRequested: number;
  }): Promise<QuotaCheckResult> {
    const userCheck = await checkUserDailyQuota(args.userId, args.tokensRequested);
    if (!userCheck.allowed) {
      return userCheck;
    }

    if (args.orgId) {
      const orgCheck = await checkOrgMonthlyQuota(args.orgId, args.tokensRequested);
      if (!orgCheck.allowed) {
        return orgCheck;
      }
    }

    return { allowed: true };
  }

  return {
    checkUserDailyQuota,
    checkOrgMonthlyQuota,
    checkOrgConcurrentWorkflows,
    recordUserTokens,
    recordOrgTokens,
    incrementOrgConcurrent,
    decrementOrgConcurrent,
    assertQuota,
  };
}
