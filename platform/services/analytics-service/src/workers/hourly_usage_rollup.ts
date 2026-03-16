import { prisma } from '@workspace/database';

export const HourlyUsageRollup = {
  async run(): Promise<void> {
    console.log('[HourlyRollup] Starting...');
    
    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setUTCMinutes(0, 0, 0);

    const [aiRequests, computeSeconds, deploys] = await Promise.all([
      prisma.usageRecord.aggregate({
        where: { createdAt: { gte: hourStart } },
        _sum: { aiTokensUsed: true }
      }),
      prisma.usageRecord.aggregate({
        where: { createdAt: { gte: hourStart } },
        _sum: { computeMinutes: true }
      }),
      prisma.usageRecord.aggregate({
        where: { createdAt: { gte: hourStart } },
        _sum: { deploymentsCount: true }
      })
    ]);

    console.log('[HourlyRollup] Completed');
  }
};
