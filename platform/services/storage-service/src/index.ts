import dotenv from 'dotenv';
dotenv.config();

import { config } from './config/index';
import { logger } from './lib/logger';
import { connectRedis, disconnectRedis } from './lib/redis';
import { disconnectPrisma } from './lib/prisma';
import { KafkaConsumer } from './events/kafka-consumer';
import { buildApp } from './app';

async function main() {
  logger.info({ port: config.port, env: config.nodeEnv }, 'Starting storage service...');

  // Connect to Redis (optional)
  await connectRedis();

  // Start Kafka consumer (optional)
  await KafkaConsumer.start();

  // Build and start Fastify app
  const app = await buildApp();

  // Start server
  await app.listen({ port: config.port, host: '0.0.0.0' });

  logger.info(`Storage service running on port ${config.port}`);
}

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down storage service...');

  try {
    await KafkaConsumer.stop();
    await disconnectRedis();
    await disconnectPrisma();
    logger.info('Storage service shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  process.exit(1);
});

// Start the service
main().catch((error) => {
  logger.fatal({ error }, 'Failed to start storage service');
  process.exit(1);
});
