import { Consumer, EachMessagePayload } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import { config } from '../config/index.js';
import { prisma } from '../lib/prisma.js';

const kafka = createKafkaClient({ clientId: 'deployment-service', groupId: config.kafka.groupId });

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

export const KafkaConsumer = {
  async start() {
    await consumer.connect();
    console.log('[Kafka] Consumer connected');

    await consumer.subscribe({ topic: 'project.deleted', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, message }: EachMessagePayload) => {
        try {
          const payload = JSON.parse(message.value?.toString() || '{}');

          if (topic === 'project.deleted') {
            await this.handleProjectDeleted(payload);
          }
        } catch (error) {
          console.error('[Kafka] Error:', error);
        }
      }
    });
  },

  async handleProjectDeleted(payload: { projectId: string }) {
    // Delete deployment records
    await prisma.deployment.deleteMany({
      where: { projectId: payload.projectId }
    });
  }
};
