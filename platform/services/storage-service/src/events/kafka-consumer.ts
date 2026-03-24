import { Consumer, EachMessagePayload } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import { config } from '../config/index';
import { OrphanCleaner } from '../services/orphan-cleaner.service';
import { logger } from '../lib/logger';

let consumer: Consumer | null = null;

export const KafkaConsumer = {
  /**
   * Start the Kafka consumer
   */
  async start(): Promise<void> {
    if (!config.kafka.enabled) {
      logger.info('Kafka disabled, skipping consumer startup');
      return;
    }

    try {
      const kafka = createKafkaClient({ clientId: 'storage-service', groupId: config.kafka.groupId });

      consumer = kafka.consumer({ groupId: config.kafka.groupId });

      if (!consumer) {
        logger.error('Failed to create Kafka consumer');
        return;
      }

      await consumer.connect();
      logger.info({ brokers: config.kafka.brokers }, 'Kafka consumer connected');

      // Subscribe to relevant topics
      await consumer.subscribe({ topic: 'project.deleted', fromBeginning: false });

      await consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          const { topic, message } = payload;

          try {
            const value = message.value?.toString();
            if (!value) {
              return;
            }

            const data = JSON.parse(value);
            logger.debug({ topic, data }, 'Received Kafka message');

            switch (topic) {
              case 'project.deleted':
                await this.handleProjectDeleted(data);
                break;
              default:
                logger.warn({ topic }, 'Unknown topic received');
            }
          } catch (error) {
            logger.error({ error, topic }, 'Error processing Kafka message');
          }
        },
      });

      logger.info('Kafka consumer started');
    } catch (error) {
      logger.error({ error }, 'Failed to start Kafka consumer');
      // Don't throw - service can still function without Kafka
    }
  },

  /**
   * Stop the Kafka consumer
   */
  async stop(): Promise<void> {
    if (consumer) {
      try {
        await consumer.disconnect();
        consumer = null;
        logger.info('Kafka consumer stopped');
      } catch (error) {
        logger.error({ error }, 'Error stopping Kafka consumer');
      }
    }
  },

  /**
   * Handle project.deleted event
   * Delete all S3 files associated with the project
   */
  async handleProjectDeleted(data: { projectId: string; deletedBy?: string }): Promise<void> {
    const { projectId, deletedBy } = data;

    logger.info({ projectId, deletedBy }, 'Processing project.deleted event');

    try {
      const result = await OrphanCleaner.cleanupProjectFiles(projectId);

      logger.info(
        { projectId, deleted: result.deleted, errors: result.errors.length },
        'Project files cleaned up'
      );

      // Log to audit
      // Note: In production, this would use a proper audit service
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to cleanup project files');
    }
  },
};

export default KafkaConsumer;
