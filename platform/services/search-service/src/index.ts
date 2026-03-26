// Validate environment variables at startup
import '@workspace/config/env';

import { buildApp } from './app.js';
import { config } from './config/index.js';
import { disconnectPrisma } from './lib/prisma.js';
import { KafkaConsumer } from './events/kafka-consumer.js';
import { IndexManager } from './services/elasticsearch.service.js';
import { logger } from './lib/logger.js';

async function main() {
  logger.info('Starting search-service...');

  // Ensure Elasticsearch indices exist
  try {
    await IndexManager.ensureProjectIndex();
    logger.info('Elasticsearch indices initialized');
  } catch (error) {
    logger.warn({ error }, 'Elasticsearch not available, continuing without it');
  }

  // Start Kafka consumer for real-time indexing
  try {
    await KafkaConsumer.start();
  } catch (error) {
    logger.warn({ error }, 'Kafka not available, continuing without it');
  }

  // Build and start Fastify app
  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`Search service running on port ${config.port}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await KafkaConsumer.stop();
  await disconnectPrisma();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await KafkaConsumer.stop();
  await disconnectPrisma();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Rejection');
});

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught Exception');
  process.exit(1);
});

main().catch((error) => {
  logger.error(error, 'Failed to start search service');
  process.exit(1);
});
