import Stripe from 'stripe';
import { config } from '../config.js';

export const stripe = new Stripe(config.stripeSecretKey, {
  apiVersion: '2023-10-16',
});

// Circuit breaker state
interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

const circuitBreaker: CircuitBreakerState = {
  status: 'closed',
  failures: 0,
  lastFailureTime: 0,
  nextAttemptTime: 0,
};

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

function checkCircuitBreaker(): boolean {
  const now = Date.now();
  
  if (circuitBreaker.status === 'open') {
    if (now >= circuitBreaker.nextAttemptTime) {
      circuitBreaker.status = 'half-open';
      return true;
    }
    return false;
  }
  
  return true;
}

function recordSuccess(): void {
  circuitBreaker.failures = 0;
  circuitBreaker.status = 'closed';
}

function recordFailure(): void {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = Date.now();
  
  if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.status = 'open';
    circuitBreaker.nextAttemptTime = Date.now() + CIRCUIT_BREAKER_TIMEOUT;
    console.warn('[Stripe] Circuit breaker OPEN - too many failures');
  }
}

export function getCircuitBreakerStatus(): CircuitBreakerState {
  return { ...circuitBreaker };
}

async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  if (!checkCircuitBreaker()) {
    throw new Error('Circuit breaker is OPEN - Stripe API temporarily unavailable');
  }
  
  try {
    const result = await fn();
    recordSuccess();
    return result;
  } catch (error) {
    recordFailure();
    throw error;
  }
}

export const StripeClient = {
  // Create a Stripe customer
  async createCustomer(email: string, name?: string): Promise<Stripe.Customer> {
    return withCircuitBreaker(() => stripe.customers.create({
      email,
      name: name || undefined,
      metadata: {
        platform: 'ai-native-ide'
      }
    }));
  },

  // Create checkout session
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    return withCircuitBreaker(() => stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    }));
  },

  // Create customer portal session
  async createPortalSession(customerId: string, returnUrl: string): Promise<Stripe.BillingPortal.Session> {
    return withCircuitBreaker(() => stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    }));
  },

  // Construct webhook event (uses raw body buffer)
  constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      config.stripeWebhookSecret
    );
  },

  // Cancel subscription
  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return withCircuitBreaker(() => stripe.subscriptions.cancel(subscriptionId));
  },

  // Get subscription
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return withCircuitBreaker(() => stripe.subscriptions.retrieve(subscriptionId));
  },
};
