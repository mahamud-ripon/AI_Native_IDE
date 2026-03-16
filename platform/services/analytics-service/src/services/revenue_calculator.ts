import { prisma } from '@workspace/database';

const PRICE_MAP: Record<string, number> = {
  'price_free': 0,
  'price_pro_monthly': 1500,
  'price_pro_yearly': 14400,
  'price_team_monthly': 4000,
  'price_team_yearly': 38400,
  'price_enterprise_monthly': 20000,
  'price_enterprise_yearly': 192000
};

export const RevenueCalculator = {
  async calculateMRR(): Promise<number> {
    const activeSubscriptions = await prisma.subscription.findMany({
      where: { status: 'active' }
    });

    let mrr = 0;
    for (const sub of activeSubscriptions) {
      const price = PRICE_MAP[sub.stripePriceId] || 0;
      mrr += price;
    }

    return mrr / 100;
  },

  async calculateARR(): Promise<number> {
    const mrr = await this.calculateMRR();
    return mrr * 12;
  },

  async calculateChurnRate(): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const activeStartOfMonth = await prisma.subscription.count({
      where: { 
        status: 'active',
        createdAt: { lt: startOfMonth }
      }
    });

    const cancelledThisMonth = await prisma.subscription.count({
      where: {
        status: 'canceled',
        cancelAtPeriodEnd: true
      }
    });

    if (activeStartOfMonth === 0) return 0;
    return (cancelledThisMonth / activeStartOfMonth) * 100;
  },

  async getRevenueByPlan(): Promise<Record<string, number>> {
    const activeSubscriptions = await prisma.subscription.findMany({
      where: { status: 'active' }
    });

    const revenueByPlan: Record<string, number> = {};
    
    for (const sub of activeSubscriptions) {
      const plan = this.getPlanFromPriceId(sub.stripePriceId);
      const price = PRICE_MAP[sub.stripePriceId] || 0;
      revenueByPlan[plan] = (revenueByPlan[plan] || 0) + price;
    }

    for (const plan in revenueByPlan) {
      revenueByPlan[plan] = revenueByPlan[plan] / 100;
    }

    return revenueByPlan;
  },

  getPlanFromPriceId(priceId: string): string {
    if (priceId.includes('enterprise')) return 'Enterprise';
    if (priceId.includes('team')) return 'Team';
    if (priceId.includes('pro')) return 'Pro';
    return 'Free';
  }
};
