import { Consumer } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import { config } from '../config.js';
import { redis } from '../lib/redis.js';

const kafka = createKafkaClient({ clientId: 'analytics-service', groupId: config.kafkaGroupId });

const consumer = kafka.consumer({ groupId: config.kafkaGroupId });

export const KafkaConsumer = {
  async start() {
    try {
      await consumer.connect();
      console.log('[Kafka] Consumer connected');

      const topics = ['user.created', 'project.created', 'subscription.updated'];
      
      for (const topic of topics) {
        try {
          await consumer.subscribe({ topic, fromBeginning: false });
          console.log(`[Kafka] Subscribed to ${topic}`);
        } catch (error: any) {
          console.warn(`[Kafka] Failed to subscribe to ${topic}: ${error.message}`);
        }
      }

      await consumer.run({
        eachMessage: async ({ topic, message }) => {
          try {
            const payload = JSON.parse(message.value?.toString() || '{}');
            
            switch (topic) {
              case 'user.created':
                await this.handleUserCreated(payload);
                break;
              case 'project.created':
                await this.handleProjectCreated(payload);
                break;
              case 'subscription.updated':
                await this.handleSubscriptionUpdated(payload);
                break;
            }
          } catch (error) {
            console.error('[Kafka] Error:', error);
          }
        }
      });
    } catch (error: any) {
      console.warn('[Kafka] Consumer start failed:', error.message);
      console.log('[Kafka] Continuing without Kafka consumer...');
    }
  },

  async handleUserCreated(payload: { userId: string }) {
    await redis.incr('analytics:total_users');
  },

  async handleProjectCreated(payload: { projectId: string; ownerId: string }) {
    await redis.incr('analytics:total_projects');
  },

  async handleSubscriptionUpdated(payload: { userId: string; plan: string }) {
    await redis.setex(`user:plan:${payload.userId}`, 3600, payload.plan);
  },

  async stop() {
    try {
      await consumer.disconnect();
    } catch (error) {
      // Ignore disconnect errors
    }
  }
};
