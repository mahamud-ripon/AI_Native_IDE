import { prisma } from '@workspace/database';
import { redis } from '../lib/redis.js';
import { config } from '../config.js';
import { createHash } from 'crypto';

export const FeatureFlagEngine = {
  async evaluate(userId: string, flagName: string): Promise<boolean> {
    const cacheKey = `feature:${flagName}:${userId}`;
    
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return cached === 'true';
    }

    const flag = await prisma.featureFlag.findFirst({
      where: { flagKey: flagName }
    });

    if (!flag || !flag.isEnabledDefault) {
      await redis.setex(cacheKey, config.featureFlagTTL, 'false');
      return false;
    }

    if (flag.enabledForPlans && flag.enabledForPlans.length > 0) {
      const userPlan = await this.getUserPlan(userId);
      if (!flag.enabledForPlans.includes(userPlan)) {
        await redis.setex(cacheKey, config.featureFlagTTL, 'false');
        return false;
      }
    }

    const rolloutPercentage = flag.rolloutPercentage ?? 100;
    if (rolloutPercentage < 100) {
      const isIncluded = this.isInRollout(userId, flagName, rolloutPercentage);
      if (!isIncluded) {
        await redis.setex(cacheKey, config.featureFlagTTL, 'false');
        return false;
      }
    }

    await redis.setex(cacheKey, config.featureFlagTTL, 'true');
    return true;
  },

  async getUserPlan(userId: string): Promise<string> {
    const cached = await redis.get(`user:plan:${userId}`);
    return cached || 'free';
  },

  isInRollout(userId: string, flagName: string, percentage: number): boolean {
    const hash = createHash('sha256')
      .update(`${userId}:${flagName}`)
      .digest('hex');
    
    const hashValue = parseInt(hash.substring(0, 8), 16);
    const bucket = hashValue % 100;
    
    return bucket < percentage;
  },

  async getAllFlags(): Promise<any[]> {
    return prisma.featureFlag.findMany({
      orderBy: { createdAt: 'desc' }
    });
  },

  async createFlag(data: {
    flagKey: string;
    description?: string;
    isEnabledDefault: boolean;
    rolloutPercentage?: number;
    enabledForPlans: string[];
  }): Promise<any> {
    return prisma.featureFlag.create({
      data: {
        flagKey: data.flagKey,
        description: data.description,
        isEnabledDefault: data.isEnabledDefault,
        rolloutPercentage: data.rolloutPercentage,
        enabledForPlans: data.enabledForPlans,
        enabledForUsers: []
      }
    });
  },

  async updateFlag(id: string, data: Partial<{
    isEnabledDefault: boolean;
    rolloutPercentage: number;
    enabledForPlans: string[];
  }>): Promise<any> {
    const flag = await prisma.featureFlag.update({
      where: { id },
      data: {
        isEnabledDefault: data.isEnabledDefault,
        rolloutPercentage: data.rolloutPercentage,
        enabledForPlans: data.enabledForPlans
      }
    });

    const keys = await redis.keys(`feature:${flag.flagKey}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    return flag;
  },

  async flushCache(flagName: string): Promise<void> {
    const keys = await redis.keys(`feature:${flagName}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
};
