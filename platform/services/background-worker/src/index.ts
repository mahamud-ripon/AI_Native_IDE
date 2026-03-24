// Validate environment variables at startup
import '@workspace/config/env';

import { redisClient, redlockClient } from './lib/redis.js';
import { prisma } from './lib/prisma.js';
import { initializeQueues, startQueueConsumers, stopQueueConsumers } from './queue/queue_consumer.js';
import { startKafkaConsumer, stopKafkaConsumer } from './queue/kafka_consumer.js';
import { startCronManager, stopCronManager } from './scheduler/cron_manager.js';

const logger = {
  info: (msg: string) => console.log(`[Background Worker] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[Background Worker] ${msg}`, err),
  warn: (msg: string) => console.warn(`[Background Worker] ${msg}`),
};

let isShuttingDown = false;

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  logger.info(`🛑 Received ${signal}, starting graceful shutdown...`);

  try {
    // Stop accepting new jobs
    logger.info('⏸️ Stopping cron manager...');
    stopCronManager();

    logger.info('⏸️ Stopping queue consumers...');
    await stopQueueConsumers();

    logger.info('⏸️ Stopping Kafka consumer...');
    await stopKafkaConsumer();

    // Wait for active jobs to complete (with timeout)
    logger.info('⏳ Waiting for active jobs to complete (5s timeout)...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Close connections with graceful degradation
    logger.info('🔌 Closing connections...');
    const results = await Promise.allSettled([
      redisClient.quit(),
      redlockClient.quit(),
      prisma.$disconnect(),
    ]);

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const names = ['Redis', 'Redlock', 'Prisma'];
        logger.error(`Failed to disconnect ${names[index]}: ${result.reason}`);
      }
    });

    logger.info('✅ Graceful shutdown complete');
    process.exit(0);

  } catch (error: any) {
    logger.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
}

/**
 * Health check - verify all connections
 */
async function healthCheck(): Promise<boolean> {
  try {
    // Check Redis
    await redisClient.ping();
    
    // Check Prisma
    await prisma.$queryRaw`SELECT 1`;

    return true;
  } catch (error: any) {
    logger.error('Health check failed:', error.message);
    return false;
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info('🚀 Starting Background Worker...');
  logger.info(`   Node Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`   Redis URL: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);

  try {
    // Verify database and Redis connections
    logger.info('🔌 Verifying connections...');
    const healthy = await healthCheck();
    
    if (!healthy) {
      throw new Error('Health check failed - cannot start worker');
    }

    logger.info('✅ All connections verified');

    // Initialize BullMQ queues
    logger.info('📦 Initializing BullMQ queues...');
    initializeQueues();

    // Start queue consumers
    logger.info('👷 Starting queue consumers...');
    startQueueConsumers();

    // Start Kafka consumer
    logger.info('📨 Starting Kafka consumer...');
    await startKafkaConsumer();

    // Start cron manager for scheduled jobs
    logger.info('🕐 Starting cron manager...');
    startCronManager();

    logger.info('✅ Background Worker is running!');
    logger.info('   Press Ctrl+C to stop gracefully');

    // Register shutdown handlers
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('💥 Unhandled Rejection:', reason);
      gracefulShutdown('unhandledRejection');
    });

  } catch (error: any) {
    logger.error('❌ Failed to start Background Worker:', error.message);
    process.exit(1);
  }
}

// Start the worker
main();
