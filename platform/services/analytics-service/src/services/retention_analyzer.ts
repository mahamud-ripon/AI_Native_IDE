import { prisma } from '@workspace/database';

export const RetentionAnalyzer = {
  async calculateD7Retention(cohortDate: Date): Promise<number> {
    const cohortStart = new Date(cohortDate);
    cohortStart.setUTCHours(0, 0, 0, 0);
    
    const cohortEnd = new Date(cohortDate);
    cohortEnd.setUTCHours(23, 59, 59, 999);

    const d7Date = new Date(cohortDate);
    d7Date.setUTCDate(d7Date.getUTCDate() + 7);

    const cohortUsers = await prisma.user.findMany({
      where: {
        createdAt: { gte: cohortStart, lte: cohortEnd }
      },
      select: { id: true }
    });

    const cohortCount = cohortUsers.length;
    if (cohortCount === 0) return 0;

    const retainedCount = await prisma.user.count({
      where: {
        id: { in: cohortUsers.map(u => u.id) },
        lastActiveAt: { gte: d7Date }
      }
    });

    return (retainedCount / cohortCount) * 100;
  },

  async calculateD30Retention(cohortDate: Date): Promise<number> {
    const cohortStart = new Date(cohortDate);
    cohortStart.setUTCHours(0, 0, 0, 0);
    
    const cohortEnd = new Date(cohortDate);
    cohortEnd.setUTCHours(23, 59, 59, 999);

    const d30Date = new Date(cohortDate);
    d30Date.setUTCDate(d30Date.getUTCDate() + 30);

    const cohortUsers = await prisma.user.findMany({
      where: {
        createdAt: { gte: cohortStart, lte: cohortEnd }
      },
      select: { id: true }
    });

    const cohortCount = cohortUsers.length;
    if (cohortCount === 0) return 0;

    const retainedCount = await prisma.user.count({
      where: {
        id: { in: cohortUsers.map(u => u.id) },
        lastActiveAt: { gte: d30Date }
      }
    });

    return (retainedCount / cohortCount) * 100;
  },

  async getCohortAnalysis(days: number): Promise<any[]> {
    const results = [];
    const today = new Date();

    for (let i = 0; i < days; i += 7) {
      const cohortDate = new Date(today);
      cohortDate.setUTCDate(cohortDate.getUTCDate() - i);

      const [d7, d30] = await Promise.all([
        this.calculateD7Retention(cohortDate),
        this.calculateD30Retention(cohortDate)
      ]);

      results.push({
        cohortDate: cohortDate.toISOString().split('T')[0],
        d7Retention: d7,
        d30Retention: d30
      });
    }

    return results;
  }
};
