import { FastifyRequest, FastifyReply } from 'fastify';
import { MetricsAggregator } from '../services/metrics_aggregator.js';
import { RevenueCalculator } from '../services/revenue_calculator.js';

export async function getOverview(request: FastifyRequest, reply: FastifyReply) {
  try {
    const today = new Date();
    
    const [dailyMetrics, weeklyMetrics, monthlyMetrics, mrr, arr, churnRate] = await Promise.all([
      MetricsAggregator.getDailyMetrics(today),
      MetricsAggregator.getWeeklyMetrics(today),
      MetricsAggregator.getMonthlyMetrics(today),
      RevenueCalculator.calculateMRR(),
      RevenueCalculator.calculateARR(),
      RevenueCalculator.calculateChurnRate()
    ]);

    return reply.send({
      success: true,
      data: {
        dau: dailyMetrics.dau,
        wau: weeklyMetrics.wau,
        mau: monthlyMetrics.mau,
        total_users: monthlyMetrics.totalUsers,
        new_signups_today: dailyMetrics.newSignups,
        mrr_usd: mrr,
        arr_usd: arr,
        churn_rate_pct: churnRate
      }
    });
  } catch (error: any) {
    return reply.status(500).send({ error: error.message });
  }
}
