import { Kafka, Producer } from 'kafkajs';
import { config } from '../config.js';

const kafka = new Kafka({
  clientId: 'billing-service-publisher',
  brokers: config.kafkaBrokers,
});

const producer: Producer = kafka.producer();
let isConnected = false;

export const KafkaPublisher = {
  async connect(): Promise<void> {
    if (!isConnected && process.env.NODE_ENV !== 'test') {
      try {
        await producer.connect();
        isConnected = true;
        console.log('[Kafka Publisher] Connected');
      } catch (error: any) {
        console.warn('[Kafka Publisher] Connection failed:', error.message);
        console.log('[Kafka Publisher] Continuing without Kafka...');
      }
    }
  },

  async publish(topic: string, payload: any): Promise<void> {
    if (!isConnected) {
      console.log(`[Kafka Mock] ${topic}:`, JSON.stringify(payload).substring(0, 100));
      return;
    }

    try {
      await producer.send({
        topic,
        messages: [{ 
          key: payload.userId || payload.stripeSubscriptionId || undefined,
          value: JSON.stringify(payload) 
        }]
      });
      console.log(`[Kafka] Published to ${topic}`);
    } catch (error: any) {
      console.error('[Kafka] Publish error:', error.message);
    }
  },

  async disconnect(): Promise<void> {
    if (isConnected) {
      try {
        await producer.disconnect();
        isConnected = false;
        console.log('[Kafka Publisher] Disconnected');
      } catch (error) {
        // Ignore disconnect errors
      }
    }
  }
};
