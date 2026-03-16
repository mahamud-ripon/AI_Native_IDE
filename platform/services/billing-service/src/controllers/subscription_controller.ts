import type { FastifyRequest, FastifyReply } from 'fastify';
import { SubscriptionService } from '../services/subscription_srv.js';
import { StripeClient } from '../services/stripe_client.js';
import { prisma } from '../lib/prisma.js';

export const SubscriptionController = {
  // GET /api/v1/billing/subscription
  async getSubscription(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request.user as any)?.id;
      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const subscription = await SubscriptionService.getSubscription(userId);

      if (!subscription) {
        return reply.send({
          success: true,
          data: { plan: 'FREE', status: 'active' }
        });
      }

      return reply.send({
        success: true,
        data: {
          plan: subscription.plan,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
        }
      });
    } catch (error: any) {
      console.error('[Subscription] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // PUT /api/v1/billing/subscription/cancel
  async cancelSubscription(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request.user as any)?.id;
      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const subscription = await SubscriptionService.getSubscription(userId);

      if (!subscription || subscription.plan === 'FREE') {
        return reply.status(400).send({ error: 'No active subscription to cancel' });
      }

      // Cancel via Stripe if not already free tier
      if (subscription.stripeSubscriptionId && subscription.stripeSubscriptionId !== 'free_tier') {
        try {
          await StripeClient.cancelSubscription(subscription.stripeSubscriptionId);
        } catch (stripeError: any) {
          console.error('[Cancel] Stripe error:', stripeError);
          // Continue to update local DB even if Stripe fails
        }
      }

      await SubscriptionService.cancelAtPeriodEnd(userId);

      return reply.send({
        success: true,
        message: 'Subscription will be canceled at the end of the billing period'
      });
    } catch (error: any) {
      console.error('[Cancel] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // GET /api/v1/billing/plans
  async getPlans(request: FastifyRequest, reply: FastifyReply) {
    return reply.send({
      plans: [
        { 
          id: 'FREE', 
          name: 'Free', 
          price: 0, 
          limits: { 
            aiTokens: 10000, 
            computeMinutes: 100, 
            storageGb: 1 
          }
        },
        { 
          id: 'PRO', 
          name: 'Pro', 
          price: 29, 
          limits: { 
            aiTokens: 1000000, 
            computeMinutes: 5000, 
            storageGb: 50 
          }
        },
        { 
          id: 'TEAM', 
          name: 'Team', 
          price: 99, 
          limits: { 
            aiTokens: 5000000, 
            computeMinutes: 20000, 
            storageGb: 200 
          }
        },
        { 
          id: 'ENTERPRISE', 
          name: 'Enterprise', 
          price: 'custom', 
          limits: { 
            aiTokens: -1, 
            computeMinutes: -1, 
            storageGb: -1 
          }
        }
      ]
    });
  }
};
