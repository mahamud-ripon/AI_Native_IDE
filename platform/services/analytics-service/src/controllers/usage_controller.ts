import { FastifyRequest, FastifyReply } from 'fastify';
import { MetricsAggregator } from '../services/metrics_aggregator.js';

export async function getUsage(request: FastifyRequest<{ Querystring: { period?: string } }>, reply: FastifyReply) {
  try {
    const period = request.query?.period || '30d';
    
    let days = 30;
    if (period === '7d') days = 7;
    if (period === '90d') days = 90;

    const usageData = await MetricsAggregator.getUsageMetrics(days);

    return reply.send({
      success: true,
      data: usageData.map(d => ({
        date: d.date,
        ai_requests: d.aiRequests,
        compute_hours: Math.round(d.computeSeconds / 3600 * 100) / 100,
        storage_gb: Math.round(Number(d.storageBytes) / (1024 * 1024 * 1024) * 100) / 100,
        deploys: d.deploys
      }))
    });
  } catch (error: any) {
    return reply.status(500).send({ error: error.message });
  }
}
