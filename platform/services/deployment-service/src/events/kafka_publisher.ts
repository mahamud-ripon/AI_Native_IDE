import { Producer } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import { config } from '../config/index.js';

const kafka = createKafkaClient({ clientId: 'deployment-service' });

const producer = kafka.producer();
let isConnected = false;

export const KafkaPublisher = {
  async connect() {
    if (!isConnected && process.env.NODE_ENV !== 'test') {
      await producer.connect();
      isConnected = true;
    }
  },

  async publish(topic: string, payload: any) {
    if (!isConnected) return;

    try {
      await producer.send({
        topic,
        messages: [{ value: JSON.stringify(payload) }]
      });
    } catch (error) {
      console.error('[Kafka] Publish error:', error);
    }
  }
};
