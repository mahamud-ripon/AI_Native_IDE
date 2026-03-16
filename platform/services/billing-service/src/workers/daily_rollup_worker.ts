import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

const ROLLUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

export const DailyRollupWorker = {
  intervalId: null as NodeJS.Timeout | null,

  start(): void {
    console.log('[Rollup Worker] Starting daily rollup worker');
    
    // Run immediately on start
    this.rollup().catch(err => console.error('[Rollup Worker] Initial rollup error:', err));
    
    // Then run on interval
    this.intervalId = setInterval(async () => {
      try {
        await this.rollup();
      } catch (error: any) {
        console.error('[Rollup Worker] Error:', error.message);
      }
    }, ROLLUP_INTERVAL);
  },

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  },

  async rollup(): Promise<void> {
    const dateKey = new Date().toISOString().split('T')[0];
    console.log(`[Rollup Worker] Running rollup for ${dateKey}`);
    
    // Get all usage keys for today
    const keys = await redis.keys(`usage:*:${dateKey}:*`);
    
    if (keys.length === 0) {
      console.log('[Rollup Worker] No usage data to rollup');
      return;
    }
    
    // Group by user
    const userUsage = new Map<string, {
      aiTokens: number;
      compute: number;
      storage: number;
    }>();

    for (const key of keys) {
      const parts = key.split(':');
      const userId = parts[1];
      const type = parts[3];
      const value = parseInt(await redis.get(key) || '0', 10);

      if (!userUsage.has(userId)) {
        userUsage.set(userId, { aiTokens: 0, compute: 0, storage: 0 });
      }

      const usage = userUsage.get(userId)!;
      if (type === 'ai_tokens') usage.aiTokens = value;
      if (type === 'compute') usage.compute = value;
      if (type === 'storage') usage.storage = value;
    }

    // Batch upsert to database
    let processedCount = 0;
    for (const [userId, usage] of userUsage) {
      try {
        // Find existing record for this user/date
        const existing = await prisma.usageDaily.findFirst({
          where: {
            userId,
            date: new Date(dateKey)
          }
        });

        if (existing) {
          await prisma.usageDaily.update({
            where: { id: existing.id },
            data: {
              aiTokensUsed: BigInt(usage.aiTokens),
              computeSeconds: usage.compute,
              storageBytes: BigInt(usage.storage),
            }
          });
        } else {
          await prisma.usageDaily.create({
            data: {
              userId,
              date: new Date(dateKey),
              aiTokensUsed: BigInt(usage.aiTokens),
              computeSeconds: usage.compute,
              storageBytes: BigInt(usage.storage),
              aiRequestsCount: 0,
              deploysCount: 0,
            }
          });
        }
        processedCount++;
      } catch (error: any) {
        console.error(`[Rollup Worker] Failed to upsert for user ${userId}:`, error.message);
      }
    }

    console.log(`[Rollup Worker] Processed ${processedCount} users for ${dateKey}`);
  }
};
