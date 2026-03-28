import { Consumer, EachMessagePayload } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import { redisClient } from '../lib/redis.js';
import { getQueue } from './queue_consumer.js';

const logger = {
  info: (msg: string) => console.log(`[Kafka Consumer] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[Kafka Consumer] ${msg}`, err),
  warn: (msg: string) => console.warn(`[Kafka Consumer] ${msg}`),
};

const kafka = createKafkaClient({ clientId: 'background-worker', groupId: process.env.KAFKA_GROUP_ID || 'background-worker' });

const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID || 'background-worker' });

let isRunning = false;

export async function startKafkaConsumer(): Promise<void> {
  if (isRunning) {
    logger.warn('Kafka consumer already running');
    return;
  }

  try {
    await consumer.connect();
    logger.info('Connected to Kafka');

    // Subscribe to all relevant topics
    const topics = [
      'user.created',
      'invitation.created',
      'deployment.completed',
      'usage.exceeded',
      'file.modified',
      'file.deleted',
      'ai.task.failed',
    ];

    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: false });
      logger.info(`Subscribed to topic: ${topic}`);
    }

    await consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        try {
          const value = message.value?.toString();
          if (!value) {
            logger.warn(`Empty message on topic ${topic}`);
            return;
          }

          const payload = JSON.parse(value);
          logger.info(`Received event on ${topic}: ${JSON.stringify(payload)}`);

          await handleKafkaEvent(topic, payload);

        } catch (error: any) {
          logger.error(`Error processing ${topic}:`, error.message);
        }
      },
    });

    isRunning = true;
    logger.info('Kafka consumer started');

  } catch (error: any) {
    logger.error('Failed to start Kafka consumer:', error.message);
    throw error;
  }
}

async function handleKafkaEvent(topic: string, envelope: any): Promise<void> {
  // After Bug #10 fix, events use KafkaEventEnvelope with nested payload
  // Extract the actual payload from the envelope
  const payload = envelope.payload || envelope;
  
  switch (topic) {
    case 'user.created':
      await handleUserCreated(payload);
      break;
    case 'invitation.created':
      await handleInvitationCreated(payload);
      break;
    case 'deployment.completed':
      await handleDeploymentCompleted(payload);
      break;
    case 'usage.exceeded':
      await handleUsageExceeded(payload);
      break;
    case 'file.modified':
      await handleFileModified(payload);
      break;
    case 'file.deleted':
      await handleFileDeleted(payload);
      break;
    case 'ai.task.failed':
      await handleAITaskFailed(payload);
      break;
    default:
      logger.warn(`Unknown topic: ${topic}`);
  }
}

function resolveFileId(payload: { fileId?: string; id?: string }): string | undefined {
  return payload.fileId || payload.id;
}

async function handleUserCreated(payload: { userId: string; email: string; name?: string }): Promise<void> {
  const emailQueue = getQueue('email');
  if (!emailQueue) {
    logger.error('Email queue not initialized');
    return;
  }

  await emailQueue.add('email.send_verification', {
    to: payload.email,
    userId: payload.userId,
    name: payload.name,
    type: 'verification',
  }, {
    priority: 1,
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
  });

  logger.info(`Queued verification email for user ${payload.userId}`);
}

async function handleInvitationCreated(payload: { invitationId: string; email: string; orgName?: string; projectName?: string }): Promise<void> {
  const emailQueue = getQueue('email');
  if (!emailQueue) {
    logger.error('Email queue not initialized');
    return;
  }

  await emailQueue.add('email.send_invitation', {
    to: payload.email,
    invitationId: payload.invitationId,
    orgName: payload.orgName,
    projectName: payload.projectName,
    type: 'invitation',
  }, {
    priority: 2,
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
  });

  logger.info(`Queued invitation email for ${payload.email}`);
}

async function handleDeploymentCompleted(payload: { userId: string; email: string; projectId: string; projectName: string; deployUrl: string; status: string }): Promise<void> {
  const emailQueue = getQueue('email');
  if (!emailQueue) {
    logger.error('Email queue not initialized');
    return;
  }

  await emailQueue.add('email.send_deploy_status', {
    to: payload.email,
    userId: payload.userId,
    projectId: payload.projectId,
    projectName: payload.projectName,
    deployUrl: payload.deployUrl,
    status: payload.status,
    type: 'deploy_status',
  }, {
    priority: 2,
    attempts: 2,
    backoff: { type: 'exponential', delay: 60000 },
  });

  logger.info(`Queued deploy status email for user ${payload.userId}`);
}

async function handleUsageExceeded(payload: { userId: string; email: string; usagePercent: number; quotaType: string }): Promise<void> {
  const emailQueue = getQueue('email');
  if (!emailQueue) {
    logger.error('Email queue not initialized');
    return;
  }

  await emailQueue.add('email.send_usage_alert', {
    to: payload.email,
    userId: payload.userId,
    usagePercent: payload.usagePercent,
    quotaType: payload.quotaType,
    type: 'usage_alert',
  }, {
    priority: 2,
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
  });

  logger.info(`Queued usage alert email for user ${payload.userId}`);
}

async function handleFileModified(payload: { fileId?: string; id?: string; projectId: string; path: string }): Promise<void> {
  const embeddingQueue = getQueue('embedding');
  if (!embeddingQueue) {
    logger.error('Embedding queue not initialized');
    return;
  }

  const fileId = resolveFileId(payload);
  if (!fileId) {
    logger.warn(`Skipping file.modified event without file id: ${JSON.stringify(payload)}`);
    return;
  }

  await embeddingQueue.add('embedding.update_file', {
    fileId,
    projectId: payload.projectId,
    path: payload.path,
  }, {
    priority: 2,
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
  });

  logger.info(`Queued embedding update for file ${fileId}`);
}

async function handleFileDeleted(payload: { fileId?: string; id?: string; projectId: string }): Promise<void> {
  const embeddingQueue = getQueue('embedding');
  if (!embeddingQueue) {
    logger.error('Embedding queue not initialized');
    return;
  }

  const fileId = resolveFileId(payload);
  if (!fileId) {
    logger.warn(`Skipping file.deleted event without file id: ${JSON.stringify(payload)}`);
    return;
  }

  await embeddingQueue.add('embedding.remove_file', {
    fileId,
    projectId: payload.projectId,
  }, {
    priority: 3,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
  });

  logger.info(`Queued embedding removal for file ${fileId}`);
}

async function handleAITaskFailed(payload: { taskId: string; conversationId: string; provider: string; error: string }): Promise<void> {
  const aiQueue = getQueue('ai');
  if (!aiQueue) {
    logger.error('AI queue not initialized');
    return;
  }

  // Trigger fallback provider
  await aiQueue.add('ai.fallback_provider', {
    taskId: payload.taskId,
    conversationId: payload.conversationId,
    failedProvider: payload.provider,
    error: payload.error,
  }, {
    priority: 1,
    attempts: 1,
  });

  logger.info(`Queued fallback provider for task ${payload.taskId}`);
}

export async function stopKafkaConsumer(): Promise<void> {
  if (!isRunning) {
    return;
  }

  try {
    await consumer.disconnect();
    isRunning = false;
    logger.info('Kafka consumer stopped');
  } catch (error: any) {
    logger.error('Error stopping Kafka consumer:', error.message);
  }
}
