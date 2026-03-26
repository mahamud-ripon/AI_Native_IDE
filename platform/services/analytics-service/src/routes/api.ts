import { FastifyInstance } from 'fastify';
import { getOverview } from '../controllers/overview_controller.js';
import { getUsage } from '../controllers/usage_controller.js';
import { getRevenue } from '../controllers/revenue_controller.js';
import { listFlags, createFlag, updateFlag, evaluateFlag } from '../controllers/feature_flag_controller.js';
import { config } from '../config.js';

async function verifyAdmin(request: any, reply: any) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  if (token !== config.adminApiKey) {
    return reply.status(403).send({ error: 'Forbidden' });
  }
}

export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({ status: 'ok', service: 'analytics-service' }));

  fastify.get('/api/v1/admin/analytics/overview', { preHandler: verifyAdmin }, getOverview);
  fastify.get('/api/v1/admin/analytics/usage', { preHandler: verifyAdmin }, getUsage);
  fastify.get('/api/v1/admin/analytics/revenue', { preHandler: verifyAdmin }, getRevenue);

  fastify.get('/api/v1/admin/feature-flags', { preHandler: verifyAdmin }, listFlags);
  fastify.post('/api/v1/admin/feature-flags', { preHandler: verifyAdmin }, createFlag);
  fastify.patch('/api/v1/admin/feature-flags/:id', { preHandler: verifyAdmin }, updateFlag);

  fastify.get('/api/v1/features/evaluate', evaluateFlag);
}
