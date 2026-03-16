import { redis, atomicMetering } from '../lib/redis.js';
import { SubscriptionService } from './subscription_srv.js';
import type { PlanType } from '@workspace/database';

function getDateKey(): string {
  return new Date().toISOString().split('T')[0];
}

export type MeteringType = 'ai_tokens' | 'compute_minutes' | 'storage_gb';

export const MeteringService = {
  // Get plan limits for user
  async getUserLimits(userId: string): Promise<{ aiTokens: number; computeMinutes: number; storageGb: number }> {
    const { plan } = await SubscriptionService.getUserPlan(userId);
    return SubscriptionService.getPlanLimits(plan);
  },

  // Meter usage (atomic check-and-decrement via Redis Lua script)
  async meterUsage(
    userId: string,
    type: MeteringType,
    amount: number
  ): Promise<{ success: boolean; remaining: number; limit: number }> {
    const limits = await MeteringService.getUserLimits(userId);
    
    let limit: number;
    let redisKey: string;
    let actualAmount = amount;
    
    switch (type) {
      case 'ai_tokens':
        limit = limits.aiTokens;
        redisKey = `usage:${userId}:${getDateKey()}:ai_tokens`;
        break;
      case 'compute_minutes':
        limit = limits.computeMinutes;
        redisKey = `usage:${userId}:${getDateKey()}:compute`;
        break;
      case 'storage_gb':
        limit = limits.storageGb;
        redisKey = `usage:${userId}:${getDateKey()}:storage`;
        // Convert GB to bytes for storage
        actualAmount = amount * 1024 * 1024 * 1024;
        break;
    }

    // Unlimited for enterprise (limit === -1)
    if (limit === -1) {
      await redis.incrby(redisKey, actualAmount);
      return { success: true, remaining: -1, limit: -1 };
    }

    // Atomic check-and-decrement via Lua script
    const remaining = await atomicMetering(redisKey, limit, actualAmount);

    if (remaining === -1) {
      // Quota exceeded
      const currentUsage = await redis.get(redisKey) || '0';
      console.log(`[Metering] Quota exceeded for ${userId} - ${type}: ${currentUsage}/${limit}`);
      
      return { success: false, remaining: 0, limit };
    }

    return { success: true, remaining, limit };
  },

  // Check if user has quota (without incrementing)
  async checkQuota(
    userId: string,
    type: MeteringType,
    amount: number
  ): Promise<{ hasQuota: boolean; remaining: number; limit: number }> {
    const limits = await MeteringService.getUserLimits(userId);
    
    let limit: number;
    let redisKey: string;
    let actualAmount = amount;
    
    switch (type) {
      case 'ai_tokens':
        limit = limits.aiTokens;
        redisKey = `usage:${userId}:${getDateKey()}:ai_tokens`;
        break;
      case 'compute_minutes':
        limit = limits.computeMinutes;
        redisKey = `usage:${userId}:${getDateKey()}:compute`;
        break;
      case 'storage_gb':
        limit = limits.storageGb;
        redisKey = `usage:${userId}:${getDateKey()}:storage`;
        actualAmount = amount * 1024 * 1024 * 1024;
        break;
    }

    // Unlimited for enterprise
    if (limit === -1) {
      return { hasQuota: true, remaining: -1, limit: -1 };
    }

    const current = parseInt(await redis.get(redisKey) || '0', 10);
    const remaining = limit - current;

    return {
      hasQuota: remaining >= actualAmount,
      remaining: Math.max(0, remaining),
      limit
    };
  },

  // Get current usage (Redis real-time)
  async getCurrentUsage(userId: string): Promise<{
    aiTokensUsed: number;
    aiTokensLimit: number;
    computeMinutes: number;
    computeLimit: number;
    storageGb: number;
    storageLimit: number;
    plan: PlanType;
  }> {
    const { plan } = await SubscriptionService.getUserPlan(userId);
    const limits = SubscriptionService.getPlanLimits(plan);
    const dateKey = getDateKey();

    const [aiTokens, compute, storage] = await Promise.all([
      redis.get(`usage:${userId}:${dateKey}:ai_tokens`),
      redis.get(`usage:${userId}:${dateKey}:compute`),
      redis.get(`usage:${userId}:${dateKey}:storage`)
    ]);

    return {
      plan,
      aiTokensUsed: parseInt(aiTokens || '0', 10),
      aiTokensLimit: limits.aiTokens,
      computeMinutes: parseInt(compute || '0', 10),
      computeLimit: limits.computeMinutes,
      storageGb: parseInt(storage || '0', 10) / (1024 * 1024 * 1024),
      storageLimit: limits.storageGb
    };
  },

  // Reset usage for a user (admin only)
  async resetUsage(userId: string, type?: MeteringType): Promise<void> {
    const dateKey = getDateKey();
    
    if (type) {
      const key = `usage:${userId}:${dateKey}:${type === 'ai_tokens' ? 'ai_tokens' : type === 'compute_minutes' ? 'compute' : 'storage'}`;
      await redis.del(key);
    } else {
      // Reset all
      await redis.del(`usage:${userId}:${dateKey}:ai_tokens`);
      await redis.del(`usage:${userId}:${dateKey}:compute`);
      await redis.del(`usage:${userId}:${dateKey}:storage`);
    }
  }
};
