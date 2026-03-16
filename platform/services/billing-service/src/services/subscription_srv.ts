import { prisma } from '../lib/prisma.js';
import { redis, cachePlan, getCachedPlan, invalidatePlanCache, PLAN_CACHE_TTL } from '../lib/redis.js';
import { StripeClient } from './stripe_client.js';
import type { PlanType, SubStatus } from '@workspace/database';

export const SubscriptionService = {
  // Get user's current plan (from Redis cache first, then DB) - SSOT
  async getUserPlan(userId: string): Promise<{ plan: PlanType; status: SubStatus }> {
    // Check Redis cache first
    const cached = await getCachedPlan(userId);
    if (cached) {
      return { plan: cached.plan as PlanType, status: cached.status as SubStatus };
    }

    // Fallback to database
    const subscription = await prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    if (!subscription) {
      // Default to FREE plan
      return { plan: 'FREE' as PlanType, status: 'active' as SubStatus };
    }

    // Cache the result
    await cachePlan(userId, subscription.plan, subscription.status);

    return { plan: subscription.plan, status: subscription.status };
  },

  // Create FREE subscription for new user (called from Kafka consumer)
  async createFreeSubscription(userId: string, stripeCustomerId: string): Promise<void> {
    // Check if already exists
    const existing = await prisma.subscription.findFirst({ where: { userId } });
    if (existing) return;

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await prisma.subscription.create({
      data: {
        userId,
        stripeSubscriptionId: 'free_tier',
        stripePriceId: 'free',
        plan: 'FREE',
        status: 'active' as SubStatus,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      }
    });

    // Cache it
    await cachePlan(userId, 'FREE', 'active');
  },

  // Update subscription from Stripe webhook
  async handleWebhookUpdate(
    stripeSubscriptionId: string,
    data: {
      status: SubStatus;
      plan: PlanType;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      stripeCustomerId?: string;
    }
  ): Promise<void> {
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId }
    });

    if (!subscription) {
      console.warn('[Subscription] No subscription found for Stripe ID:', stripeSubscriptionId);
      return;
    }

    const previousPlan = subscription.plan;

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: data.status,
        plan: data.plan,
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
      }
    });

    // Update Redis cache instantly
    if (subscription.userId) {
      await cachePlan(subscription.userId, data.plan, data.status);
    }

    // Log plan change
    if (previousPlan !== data.plan) {
      console.log(`[Subscription] Plan changed: ${previousPlan} -> ${data.plan} for user ${subscription.userId}`);
    }
  },

  // Get subscription details
  async getSubscription(userId: string) {
    return prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  },

  // Cancel subscription at period end
  async cancelAtPeriodEnd(userId: string): Promise<boolean> {
    const subscription = await prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    if (!subscription || subscription.plan === 'FREE') {
      return false;
    }

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true }
    });

    return true;
  },

  // Invalidate cache (call when subscription changes externally)
  async invalidateCache(userId: string): Promise<void> {
    await invalidatePlanCache(userId);
  },

  // Get plan limits
  getPlanLimits(plan: PlanType): { aiTokens: number; computeMinutes: number; storageGb: number } {
    const limits: Record<string, { aiTokens: number; computeMinutes: number; storageGb: number }> = {
      FREE: { aiTokens: 10000, computeMinutes: 100, storageGb: 1 },
      PRO: { aiTokens: 1000000, computeMinutes: 5000, storageGb: 50 },
      TEAM: { aiTokens: 5000000, computeMinutes: 20000, storageGb: 200 },
      ENTERPRISE: { aiTokens: -1, computeMinutes: -1, storageGb: -1 } // Unlimited
    };
    return limits[plan] || limits.FREE;
  }
};
