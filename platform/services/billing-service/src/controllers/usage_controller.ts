import type { FastifyRequest, FastifyReply } from 'fastify';
import { MeteringService, type MeteringType } from '../services/metering_srv.js';
import { SubscriptionService } from '../services/subscription_srv.js';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const MeterSchema = z.object({
  user_id: z.string().uuid(),
  type: z.enum(['ai_tokens', 'compute_minutes', 'storage_gb']),
  amount: z.number().positive()
});

export const UsageController = {
  // GET /api/v1/billing/usage/current
  async getCurrentUsage(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request.user as any)?.id;
      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const [usage, subscription] = await Promise.all([
        MeteringService.getCurrentUsage(userId),
        SubscriptionService.getUserPlan(userId)
      ]);

      return reply.send({
        success: true,
        data: {
          plan: subscription.plan,
          status: subscription.status,
          usage: {
            ai_tokens_used: usage.aiTokensUsed,
            ai_tokens_limit: usage.aiTokensLimit,
            vm_compute_minutes: usage.computeMinutes,
            vm_compute_limit: usage.computeLimit,
            storage_gb: usage.storageGb,
            storage_limit: usage.storageLimit
          }
        }
      });
    } catch (error: any) {
      console.error('[Usage] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // GET /api/v1/billing/usage/history
  async getUsageHistory(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request.user as any)?.id;
      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { startDate, endDate, limit = '30' } = request.query as any;

      const history = await prisma.usageDaily.findMany({
        where: {
          userId,
          date: {
            gte: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            lte: endDate ? new Date(endDate) : new Date()
          }
        },
        orderBy: { date: 'desc' },
        take: parseInt(limit, 10)
      });

      return reply.send({
        success: true,
        data: history.map(h => ({
          date: h.date,
          ai_tokens: Number(h.aiTokensUsed),
          compute_seconds: h.computeSeconds,
          storage_bytes: Number(h.storageBytes),
          deploys: h.deploysCount
        }))
      });
    } catch (error: any) {
      console.error('[Usage History] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // POST /api/v1/billing/meter (Internal - requires x-api-key)
  async meterUsage(request: FastifyRequest, reply: FastifyReply) {
    try {
      // Internal auth check
      const apiKey = request.headers['x-api-key'];
      const internalApiKey = process.env.INTERNAL_API_KEY || '';
      
      if (apiKey !== internalApiKey) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const data = MeterSchema.parse(request.body);

      const result = await MeteringService.meterUsage(
        data.user_id, 
        data.type as MeteringType, 
        data.amount
      );

      if (!result.success) {
        return reply.status(429).send({
          error: 'QUOTA_EXCEEDED',
          message: `You've exceeded your ${data.type} limit`,
          remaining: result.remaining,
          limit: result.limit
        });
      }

      return reply.send({
        success: true,
        remaining: result.remaining,
        limit: result.limit
      });
    } catch (error: any) {
      console.error('[Meter] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // POST /api/v1/billing/check-quota (Internal - requires x-api-key)
  async checkQuota(request: FastifyRequest, reply: FastifyReply) {
    try {
      const apiKey = request.headers['x-api-key'];
      const internalApiKey = process.env.INTERNAL_API_KEY || '';
      
      if (apiKey !== internalApiKey) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const data = MeterSchema.parse(request.body);

      const result = await MeteringService.checkQuota(
        data.user_id,
        data.type as MeteringType,
        data.amount
      );

      return reply.send({
        has_quota: result.hasQuota,
        remaining: result.remaining,
        limit: result.limit
      });
    } catch (error: any) {
      console.error('[CheckQuota] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  }
};
