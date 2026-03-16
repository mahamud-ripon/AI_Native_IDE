import { Kafka, Consumer } from 'kafkajs';
import { config } from '../config.js';
import { StripeClient } from '../services/stripe_client.js';
import { SubscriptionService } from '../services/subscription_srv.js';
import { prisma } from '../lib/prisma.js';

const kafka = new Kafka({
  clientId: 'billing-service-consumer',
  brokers: config.kafkaBrokers,
});

const consumer: Consumer = kafka.consumer({ groupId: 'billing-service' });

export const KafkaConsumer = {
  async start(): Promise<void> {
    try {
      await consumer.connect();
      console.log('[Kafka Consumer] Connected');

      const topics = ['user.created'];
      
      for (const topic of topics) {
        try {
          await consumer.subscribe({ topic, fromBeginning: false });
          console.log(`[Kafka Consumer] Subscribed to ${topic}`);
        } catch (error: any) {
          console.warn(`[Kafka Consumer] Failed to subscribe to ${topic}: ${error.message}`);
        }
      }

      await consumer.run({
        eachMessage: async ({ topic, message }) => {
          try {
            const payload = JSON.parse(message.value?.toString() || '{}');
            
            if (topic === 'user.created') {
              await KafkaConsumer.handleUserCreated(payload);
            }
          } catch (error: any) {
            console.error('[Kafka Consumer] Message processing error:', error.message);
          }
        }
      });
    } catch (error: any) {
      console.warn('[Kafka Consumer] Start failed:', error.message);
      console.log('[Kafka Consumer] Continuing without Kafka consumer...');
    }
  },

  async handleUserCreated(payload: { userId: string; email: string; username: string }): Promise<void> {
    console.log(`[Kafka Consumer] Processing user.created for ${payload.email}`);

    try {
      // Create Stripe customer
      const customer = await StripeClient.createCustomer(
        payload.email,
        payload.username
      );

      // Update user with Stripe customer ID
      await prisma.user.update({
        where: { id: payload.userId },
        data: { stripeCustomerId: customer.id }
      });

      // Create FREE subscription
      await SubscriptionService.createFreeSubscription(payload.userId, customer.id);

      console.log(`[Kafka Consumer] Created Stripe customer ${customer.id} and FREE subscription for ${payload.email}`);
    } catch (error: any) {
      console.error(`[Kafka Consumer] Failed to create customer for ${payload.email}:`, error.message);
    }
  },

  async stop(): Promise<void> {
    try {
      await consumer.disconnect();
      console.log('[Kafka Consumer] Disconnected');
    } catch (error) {
      // Ignore disconnect errors
    }
  }
};
