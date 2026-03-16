import { prisma } from '@workspace/database';

export const MetricsAggregator = {
  async getDailyMetrics(date: Date): Promise<any> {
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const [dau, newSignups, activeProjects] = await Promise.all([
      prisma.user.count({
        where: { lastActiveAt: { gte: startOfDay, lte: endOfDay } }
      }),
      prisma.user.count({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } }
      }),
      prisma.project.count({
        where: { lastOpenedAt: { gte: startOfDay, lte: endOfDay } }
      })
    ]);

    return { dau, newSignups, activeProjects, date: startOfDay };
  },

  async getWeeklyMetrics(startDate: Date): Promise<any> {
    const start = new Date(startDate);
    start.setUTCDate(start.getUTCDate() - 7);

    const wau = await prisma.user.count({
      where: { lastActiveAt: { gte: start } }
    });

    return { wau, startDate: start };
  },

  async getMonthlyMetrics(startDate: Date): Promise<any> {
    const start = new Date(startDate);
    start.setUTCDate(start.getUTCDate() - 30);

    const mau = await prisma.user.count({
      where: { lastActiveAt: { gte: start } }
    });

    const totalUsers = await prisma.user.count();

    return { mau, totalUsers, startDate: start };
  },

  async getUsageMetrics(days: number): Promise<any[]> {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);

    const metrics = await prisma.usageDaily.findMany({
      where: { date: { gte: startDate } },
      orderBy: { date: 'asc' }
    });

    return metrics.map(m => ({
      date: m.date,
      aiRequests: m.aiRequestsCount,
      computeSeconds: m.computeSeconds,
      storageBytes: m.storageBytes,
      deploys: m.deploysCount
    }));
  }
};
