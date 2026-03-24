import type { FastifyRequest, FastifyReply } from 'fastify';
import { StripeClient } from '../services/stripe_client.js';
import { SubscriptionService } from '../services/subscription_srv.js';
import { KafkaPublisher } from '../events/kafka_publisher.js';
import type { PlanType, SubStatus } from '@workspace/database';

export const WebhookController = {
  // POST /api/v1/billing/webhooks/stripe
  async handleStripeWebhook(request: FastifyRequest, reply: FastifyReply) {
    const sig = request.headers['stripe-signature'] as string;
    
    // Get raw body - Fastify stores it in request.body as string when using rawBody config
    const payload = request.body as string | Buffer;
    
    let event;
    try {
      event = StripeClient.constructWebhookEvent(payload, sig);
    } catch (err: any) {
      console.error('[Webhook] Signature verification failed:', err.message);
      return reply.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          const subscriptionId = invoice.subscription as string;
          
          // Determine plan from invoice line items
          const plan = determinePlanFromInvoice(invoice);
          
          await SubscriptionService.handleWebhookUpdate(subscriptionId, {
            status: 'active' as SubStatus,
            plan,
            currentPeriodStart: new Date(invoice.period_start * 1000),
            currentPeriodEnd: new Date(invoice.period_end * 1000)
          });
          
          await KafkaPublisher.publish('subscription.updated', {
            stripeSubscriptionId: subscriptionId,
            status: 'active',
            plan,
            timestamp: new Date().toISOString()
          });
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          
          const plan = determinePlanFromSubscription(subscription);
          const status = subscription.status === 'active' ? 'active' : 'past_due';

          await SubscriptionService.handleWebhookUpdate(subscription.id, {
            status: status as SubStatus,
            plan,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000)
          });
          
          await KafkaPublisher.publish('subscription.updated', {
            stripeSubscriptionId: subscription.id,
            status,
            plan,
            timestamp: new Date().toISOString()
          });
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any;
          
          await SubscriptionService.handleWebhookUpdate(subscription.id, {
            status: 'canceled' as SubStatus,
            plan: 'FREE' as PlanType,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date()
          });
          
          await KafkaPublisher.publish('subscription.canceled', {
            stripeSubscriptionId: subscription.id,
            timestamp: new Date().toISOString()
          });
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          const subscriptionId = invoice.subscription as string;
          
          // Update subscription status to past_due
          await SubscriptionService.handleWebhookUpdate(subscriptionId, {
            status: 'past_due' as SubStatus,
            plan: undefined, // Keep existing plan
            currentPeriodStart: undefined,
            currentPeriodEnd: undefined
          });
          
          await KafkaPublisher.publish('payment.failed', {
            stripeSubscriptionId: subscriptionId,
            customerId: invoice.customer,
            timestamp: new Date().toISOString()
          });
          break;
        }

        default:
          console.log(`[Webhook] Unhandled event type: ${event.type}`);
      }

      // Always return 200 quickly to Stripe to prevent retries
      return reply.send({ received: true });
    } catch (error: any) {
      console.error('[Webhook] Processing error:', error);
      // Still return 200 to prevent Stripe retries
      return reply.send({ received: true, error: error.message });
    }
  }
};

// Helper to determine plan from invoice
function determinePlanFromInvoice(invoice: any): PlanType {
  const priceId = invoice.lines?.data?.[0]?.price?.id;
  return getPlanFromPriceId(priceId);
}

// Helper to determine plan from subscription
function determinePlanFromSubscription(subscription: any): PlanType {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  return getPlanFromPriceId(priceId);
}

// Helper to map price ID to plan
function getPlanFromPriceId(priceId: string | undefined): PlanType {
  if (!priceId) return 'FREE';
  
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'PRO';
  if (priceId === process.env.STRIPE_PRICE_TEAM) return 'TEAM';
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return 'ENTERPRISE';
  
  return 'FREE';
}
