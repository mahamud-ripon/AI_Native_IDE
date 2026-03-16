import { Kafka, Producer, Admin, logLevel } from 'kafkajs';
import { config } from '../config';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';

const logger = createLogger('kafka-service');

export type EventTopic = 
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'file.created'
  | 'file.modified'
  | 'file.deleted'
  | 'project.files.events'  // Single topic for all file events
  | 'secret.created'
  | 'secret.updated'
  | 'secret.deleted'
  | 'collaborator.invited'
  | 'collaborator.removed'
  | 'execution.git_clone';

export interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'published' | 'failed';
  retryCount: number;
  createdAt: Date;
  publishedAt?: Date;
}

class KafkaService {
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private admin: Admin | null = null;
  private connected = false;

  constructor() {
    if (config.kafka.enabled) {
      this.kafka = new Kafka({
        clientId: 'project-service',
        brokers: config.kafka.brokers,
        logLevel: config.nodeEnv === 'development' ? logLevel.DEBUG : logLevel.ERROR,
        retry: {
          initialRetryTime: 100,
          retries: 8,
          maxRetryTime: 30000,
        },
      });
      this.producer = this.kafka.producer();
      this.admin = this.kafka.admin();
      logger.info('Kafka service initialized', { brokers: config.kafka.brokers });
    } else {
      logger.warn('Kafka service disabled');
    }
  }

  /**
   * Connect to Kafka broker
   */
  async connect(): Promise<void> {
    if (!config.kafka.enabled || !this.producer) {
      logger.warn('Kafka disabled - skipping connection');
      return;
    }

    try {
      await this.producer.connect();
      this.connected = true;
      logger.info('Connected to Kafka broker');
    } catch (error) {
      logger.error('Failed to connect to Kafka', { error });
      throw error;
    }
  }

  /**
   * Disconnect from Kafka broker
   */
  async disconnect(): Promise<void> {
    if (this.producer && this.connected) {
      await this.producer.disconnect();
      this.connected = false;
      logger.info('Disconnected from Kafka broker');
    }
  }

  /**
   * Publish event to Kafka topic
   */
  async publish(
    topic: EventTopic,
    payload: Record<string, unknown>,
    key?: string
  ): Promise<void> {
    if (!config.kafka.enabled || !this.producer) {
      logger.warn('Kafka disabled - skipping publish', { topic });
      return;
    }

    if (!this.connected) {
      await this.connect();
    }

    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: key || payload.id as string || undefined,
            value: JSON.stringify({
              ...payload,
              timestamp: new Date().toISOString(),
              source: 'project-service',
            }),
            headers: {
              'content-type': 'application/json',
              'source': 'project-service',
            },
          },
        ],
      });

      logger.info('Event published to Kafka', { topic, key });
    } catch (error) {
      logger.error('Failed to publish event to Kafka', { topic, error });
      throw error;
    }
  }

  /**
   * Publish event with Outbox pattern
   * Ensures event is stored in database before publishing
   */
  async publishWithOutbox(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<string> {
    const eventId = payload.id as string || crypto.randomUUID();

    if (!config.kafka.enabled) {
      logger.warn('Kafka disabled - skipping outbox', { eventType, aggregateId });
      return eventId;
    }

    try {
      // Store event in outbox table within transaction
      await prisma.$executeRaw`
        INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
        VALUES (${eventId}, ${aggregateType}, ${aggregateId}, ${eventType}, ${JSON.stringify(payload)}, 'pending', NOW())
      `;

      // Try to publish immediately
      await this.publish(eventType as EventTopic, payload, aggregateId);

      // Mark as published
      await prisma.$executeRaw`
        UPDATE outbox_events 
        SET status = 'published', published_at = NOW() 
        WHERE id = ${eventId}
      `;

      logger.info('Event published with outbox pattern', { eventId, eventType, aggregateId });
      return eventId;
    } catch (error) {
      logger.error('Failed to publish event with outbox', { eventId, eventType, error });
      
      // Mark as failed - will be retried by background worker
      try {
        await prisma.$executeRaw`
          UPDATE outbox_events 
          SET status = 'failed', retry_count = retry_count + 1 
          WHERE id = ${eventId}
        `;
      } catch (updateError) {
        logger.error('Failed to mark event as failed', { eventId, error: updateError });
      }
      
      throw error;
    }
  }

  /**
   * Create required topics
   */
  async createTopics(): Promise<void> {
    if (!config.kafka.enabled || !this.admin) {
      return;
    }

    const topics = [
      'project.created',
      'project.updated',
      'project.deleted',
      'file.created',
      'file.modified',
      'file.deleted',
      'secret.created',
      'secret.deleted',
      'collaborator.invited',
      'collaborator.removed',
      'execution.git_clone',
    ];

    try {
      await this.admin.connect();
      await this.admin.createTopics({
        topics: topics.map((topic) => ({
          topic,
          numPartitions: 3,
          replicationFactor: 1,
          configEntries: [
            { name: 'retention.ms', value: '604800000' }, // 7 days
          ],
        })),
      });
      await this.admin.disconnect();
      logger.info('Kafka topics created', { topics });
    } catch (error) {
      logger.error('Failed to create Kafka topics', { error });
    }
  }

  /**
   * Health check for Kafka connection
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    if (!config.kafka.enabled) {
      return { healthy: true, message: 'Kafka disabled' };
    }

    if (!this.connected) {
      return { healthy: false, message: 'Kafka not connected' };
    }

    try {
      // Simple health check by attempting to get metadata
      if (this.admin) {
        await this.admin.connect();
        await this.admin.disconnect();
      }
      return { healthy: true, message: 'Kafka connection healthy' };
    } catch (error) {
      return { 
        healthy: false, 
        message: `Kafka connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }
}

export const kafkaService = new KafkaService();
export default kafkaService;
