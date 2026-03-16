import { Kafka } from 'kafkajs';

// Connect to AWS MSK / Local Kafka
const kafka = new Kafka({
  clientId: 'auth-service',
  brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
});

const producer = kafka.producer();
let isConnected = false;

export const KafkaPublisher = {
  connect: async () => {
    try {
      if(process.env.NODE_ENV !== 'test') {
        await producer.connect();
        isConnected = true;
        console.log('✅ Connected to Kafka cluster');
      }
    } catch (e) {
      console.error('Failed to connect to Kafka:', e);
    }
  },

  publish: async (topic: string, payload: any) => {
    if (!isConnected) {
      console.warn(`[Mock Publish] ${topic}:`, payload);
      return;
    }

    try {
      await producer.send({
        topic,
        messages: [{ value: JSON.stringify(payload) }],
      });
    } catch (e) {
      console.error('Kafka Publish Error:', e);
      // In production, queue to DB Outbox table as fallback
    }
  }
};
