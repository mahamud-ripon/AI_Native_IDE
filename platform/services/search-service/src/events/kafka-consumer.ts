import { Consumer, EachMessagePayload } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import { config } from '../config/index.js';
import { FileIndexer } from '../indexers/file-indexer.js';
import { ProjectIndexer } from '../indexers/project-indexer.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

const kafka = createKafkaClient({ clientId: 'search-service', groupId: config.kafka.groupId });

let consumer: Consumer | null = null;

export const KafkaConsumer = {
  async start(): Promise<void> {
    if (!config.kafka.enabled) {
      logger.info('Kafka consumer disabled');
      return;
    }

    const newConsumer = kafka.consumer({ groupId: config.kafka.groupId });

    await newConsumer.connect();
    logger.info('Kafka consumer connected');

    await newConsumer.subscribe({ topic: 'file.modified', fromBeginning: false });
    await newConsumer.subscribe({ topic: 'file.deleted', fromBeginning: false });
    await newConsumer.subscribe({ topic: 'project.created', fromBeginning: false });
    await newConsumer.subscribe({ topic: 'project.deleted', fromBeginning: false });
    await newConsumer.subscribe({ topic: 'project.updated', fromBeginning: false });

    await newConsumer.run({
      eachMessage: async ({ topic, message }: EachMessagePayload) => {
        try {
          if (!message.value) return;

          const payload = JSON.parse(message.value.toString());

          switch (topic) {
            case 'file.modified':
              await handleFileModified(payload);
              break;
            case 'file.deleted':
              await handleFileDeleted(payload);
              break;
            case 'project.created':
              await handleProjectCreated(payload);
              break;
            case 'project.deleted':
              await handleProjectDeleted(payload);
              break;
            case 'project.updated':
              await handleProjectUpdated(payload);
              break;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error({ 
            topic, 
            error: errorMessage, 
            stack: errorStack 
          }, 'Kafka message processing failed');
        }
      },
    });

    consumer = newConsumer;
  },

  async stop(): Promise<void> {
    if (consumer) {
      await consumer.disconnect();
      logger.info('Kafka consumer disconnected');
    }
  },
};

async function handleFileModified(payload: {
  projectId: string;
  fileId?: string;
  id?: string;
  path?: string;
  content?: string;
}): Promise<void> {
  const fileId = payload.fileId || payload.id;
  if (!fileId) {
    logger.warn({ payload }, 'Skipping file.modified event without file id');
    return;
  }

  const file = await prisma.projectFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      path: true,
      inlineContent: true,
      language: true,
      sizeBytes: true,
    },
  });

  if (!file || !file.inlineContent) return;

  await FileIndexer.indexFile(
    payload.projectId,
    fileId,
    file.inlineContent.toString(),
    file.path,
    file.language || 'text',
    file.sizeBytes || undefined
  );
}

async function handleFileDeleted(payload: {
  projectId: string;
  fileId?: string;
  id?: string;
}): Promise<void> {
  const fileId = payload.fileId || payload.id;
  if (!fileId) {
    logger.warn({ payload }, 'Skipping file.deleted event without file id');
    return;
  }

  await FileIndexer.deleteFile(payload.projectId, fileId);
}

async function handleProjectCreated(payload: { projectId: string }): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: payload.projectId },
    select: {
      id: true,
      name: true,
      description: true,
      template: true,
      ownerId: true,
      visibility: true,
      language: true,
      framework: true,
      lastOpenedAt: true,
      createdAt: true,
    },
  });

  if (project) {
    await ProjectIndexer.indexProject(project);
  }
}

async function handleProjectDeleted(payload: { projectId: string }): Promise<void> {
  await ProjectIndexer.deleteProject(payload.projectId);
}

async function handleProjectUpdated(payload: {
  projectId: string;
  updates?: Record<string, unknown>;
}): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: payload.projectId },
    select: {
      id: true,
      name: true,
      description: true,
      template: true,
      ownerId: true,
      visibility: true,
      language: true,
      framework: true,
      lastOpenedAt: true,
      createdAt: true,
    },
  });

  if (project) {
    await ProjectIndexer.indexProject(project);
  }
}

export default KafkaConsumer;
