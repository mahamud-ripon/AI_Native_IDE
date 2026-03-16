import { FastifyRequest, FastifyReply } from 'fastify';
import { RevenueCalculator } from '../services/revenue_calculator.js';

export async function getRevenue(request: FastifyRequest, reply: FastifyReply) {
  try {
    const [mrr, arr, churnRate, revenueByPlan] = await Promise.all([
      RevenueCalculator.calculateMRR(),
      RevenueCalculator.calculateARR(),
      RevenueCalculator.calculateChurnRate(),
      RevenueCalculator.getRevenueByPlan()
    ]);

    return reply.send({
      success: true,
      data: {
        mrr_usd: mrr,
        arr_usd: arr,
        churn_rate_pct: churnRate,
        revenue_by_plan: revenueByPlan
      }
    });
  } catch (error: any) {
    return reply.status(500).send({ error: error.message });
  }
}
