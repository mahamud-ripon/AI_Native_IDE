import { prisma } from '@workspace/database';
import { redisClient } from '../lib/redis.js';

const logger = {
  info: (msg: string) => console.log(`[Stripe Sync] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[Stripe Sync] ${msg}`, err),
  warn: (msg: string) => console.warn(`[Stripe Sync] ${msg}`),
};

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

interface UsageReport {
  userId: string;
  subscriptionId: string;
  meteredUsage: number;
  periodStart: Date;
  periodEnd: Date;
}

export async function syncStripeUsage(data?: { userId?: string }): Promise<void> {
  logger.info('Starting Stripe usage sync');

  try {
    // Get active subscriptions with usage data
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: 'active',
        ...(data?.userId ? { userId: data.userId } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    for (const subscription of subscriptions) {
      // Skip subscriptions without a user
      if (!subscription.userId) continue;

      try {
        // Get usage from Redis
        const usageKey = `usage:${subscription.userId}:*`;
        const usageKeys = await redisClient.keys(usageKey);

        let totalTokens = 0;
        let totalComputeMinutes = 0;

        for (const key of usageKeys) {
          const value = await redisClient.get(key);
          if (value) {
            const usage = JSON.parse(value);
            totalTokens += usage.tokens || 0;
            totalComputeMinutes += usage.computeMinutes || 0;
          }
        }

        // Get current period usage from database
        const periodUsage = await prisma.usageRecord.findFirst({
          where: {
            userId: subscription.userId,
            periodStart: { lte: new Date() },
            periodEnd: { gte: new Date() },
          },
        });

        const meteredUsage = periodUsage?.aiTokensUsed 
          ? Number(periodUsage.aiTokensUsed) 
          : totalTokens;

        // Report to Stripe
        await reportToStripe({
          subscriptionId: subscription.stripeSubscriptionId,
          meteredUsage,
        });

        logger.info(`Synced usage for user ${subscription.userId}: ${meteredUsage} tokens`);

      } catch (error: any) {
        logger.error(`Failed to sync usage for subscription ${subscription.id}:`, error.message);
      }
    }

    logger.info(`Stripe sync completed: ${subscriptions.length} subscriptions processed`);

  } catch (error: any) {
    logger.error('Stripe sync failed:', error.message);
    throw error;
  }
}

async function reportToStripe(data: {
  subscriptionId: string;
  meteredUsage: number;
}): Promise<void> {
  if (!STRIPE_SECRET_KEY) {
    logger.warn('Stripe secret key not configured, skipping actual sync');
    return;
  }

  try {
    // In production, use Stripe SDK
    // const stripe = require('stripe')(STRIPE_SECRET_KEY);
    // await stripe.subscriptionItems.createUsageRecord(
    //   data.subscriptionId,
    //   { quantity: data.meteredUsage, timestamp: Math.floor(Date.now() / 1000) }
    // );

    // For now, log the sync
    logger.info(`[DEV] Would report ${data.meteredUsage} usage to Stripe for subscription ${data.subscriptionId}`);

    // Store sync record in Redis
    await redisClient.setex(
      `stripe:sync:${data.subscriptionId}`,
      3600,
      JSON.stringify({
        meteredUsage: data.meteredUsage,
        syncedAt: new Date().toISOString(),
      })
    );

  } catch (error: any) {
    logger.error(`Stripe API error for ${data.subscriptionId}:`, error.message);
    throw error;
  }
}

export async function getUsageReport(userId: string): Promise<UsageReport | null> {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { userId, status: 'active' },
    });

    if (!subscription) {
      return null;
    }

    const usageRecord = await prisma.usageRecord.findFirst({
      where: {
        userId,
        periodStart: { lte: new Date() },
        periodEnd: { gte: new Date() },
      },
    });

    return {
      userId,
      subscriptionId: subscription.stripeSubscriptionId,
      meteredUsage: usageRecord?.aiTokensUsed ? Number(usageRecord.aiTokensUsed) : 0,
      periodStart: usageRecord?.periodStart || subscription.currentPeriodStart,
      periodEnd: usageRecord?.periodEnd || subscription.currentPeriodEnd,
    };

  } catch (error: any) {
    logger.error(`Failed to get usage report for ${userId}:`, error.message);
    return null;
  }
}
