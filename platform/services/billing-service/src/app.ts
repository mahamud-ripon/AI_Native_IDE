import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { CheckoutController } from './controllers/checkout_controller.js';
import { WebhookController } from './controllers/webhooks_controller.js';
import { UsageController } from './controllers/usage_controller.js';
import { SubscriptionController } from './controllers/subscription_controller.js';
import { getCircuitBreakerStatus } from './services/stripe_client.js';

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'development' ? 'debug' : 'info',
  },
  // Raw body for Stripe webhooks
  bodyLimit: 1048576, // 1MB
});

// Register plugins async
async function registerPlugins() {
  await fastify.register(helmet);
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
}

// Health check endpoints
fastify.get('/health', async () => {
  return { status: 'ok', service: 'billing-service' };
});

fastify.get('/health/circuit-breaker', async () => {
  const status = getCircuitBreakerStatus();
  return {
    status: status.status,
    failures: status.failures,
    lastFailureTime: status.lastFailureTime,
    nextAttemptTime: status.nextAttemptTime
  };
});

// Public endpoints - Plans
fastify.get('/api/v1/billing/plans', SubscriptionController.getPlans);

// Webhook endpoint (no auth - uses Stripe signature verification)
fastify.post('/api/v1/billing/webhooks/stripe', {
  config: {
    rawBody: true,
  },
}, WebhookController.handleStripeWebhook);

// Protected endpoints - require auth
fastify.post('/api/v1/billing/checkout', { preHandler: authMiddleware }, CheckoutController.createCheckout);
fastify.post('/api/v1/billing/portal', { preHandler: authMiddleware }, CheckoutController.createPortal);
fastify.get('/api/v1/billing/usage/current', { preHandler: authMiddleware }, UsageController.getCurrentUsage);
fastify.get('/api/v1/billing/usage/history', { preHandler: authMiddleware }, UsageController.getUsageHistory);
fastify.get('/api/v1/billing/subscription', { preHandler: authMiddleware }, SubscriptionController.getSubscription);
fastify.put('/api/v1/billing/subscription/cancel', { preHandler: authMiddleware }, SubscriptionController.cancelSubscription);

// Internal endpoints - require x-api-key
fastify.post('/api/v1/billing/meter', UsageController.meterUsage);
fastify.post('/api/v1/billing/check-quota', UsageController.checkQuota);

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  console.error('[App] Error:', error);
  
  if (error.validation) {
    return reply.status(400).send({ error: 'Validation error', details: error.validation });
  }
  
  return reply.status(500).send({ error: 'Internal server error' });
});

export { fastify, registerPlugins };
