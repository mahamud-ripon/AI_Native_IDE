import type { FastifyRequest, FastifyReply } from 'fastify';
import { StripeClient } from '../services/stripe_client.js';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { z } from 'zod';

const CheckoutSchema = z.object({
  plan: z.enum(['PRO', 'TEAM', 'ENTERPRISE']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

const PortalSchema = z.object({
  returnUrl: z.string().url().optional()
});

// Price IDs from environment
const PRICE_MAP: Record<string, string> = {
  PRO: process.env.STRIPE_PRICE_PRO || '',
  TEAM: process.env.STRIPE_PRICE_TEAM || '',
  ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE || ''
};

export const CheckoutController = {
  // POST /api/v1/billing/checkout
  async createCheckout(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = CheckoutSchema.parse(request.body);
      const userId = (request.user as any)?.id;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      // Get user's Stripe customer ID
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { stripeCustomerId: true }
      });

      if (!user?.stripeCustomerId) {
        return reply.status(400).send({ error: 'No Stripe customer found' });
      }

      const priceId = PRICE_MAP[data.plan];
      if (!priceId) {
        return reply.status(400).send({ error: `Invalid plan: ${data.plan}` });
      }

      const session = await StripeClient.createCheckoutSession(
        user.stripeCustomerId,
        priceId,
        data.successUrl,
        data.cancelUrl
      );

      return reply.send({ url: session.url });
    } catch (error: any) {
      console.error('[Checkout] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // POST /api/v1/billing/portal
  async createPortal(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = PortalSchema.parse(request.body || {});
      const userId = (request.user as any)?.id;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { stripeCustomerId: true }
      });

      if (!user?.stripeCustomerId) {
        return reply.status(400).send({ error: 'No Stripe customer found' });
      }

      const returnUrl = data.returnUrl || 'https://platform.io/billing';
      
      const session = await StripeClient.createPortalSession(
        user.stripeCustomerId,
        returnUrl
      );

      return reply.send({ url: session.url });
    } catch (error: any) {
      console.error('[Portal] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  }
};
