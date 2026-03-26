// Validate environment variables at startup
import '@workspace/config/env';

import { fastify, registerPlugins } from './app.js';
import { config } from './config.js';
import { redis } from './lib/redis.js';
import { disconnectPrisma } from './lib/prisma.js';
import { KafkaConsumer } from './events/kafka_consumer.js';
import { PostgresSync } from './persistence/postgres_sync.js';
import { AwarenessManager } from './core/awareness_manager.js';
import { GatewayHandler } from './rpc/gateway_handler.js';

let isShuttingDown = false;

async function main() {
  console.log('[Collab] Starting service...');
  console.log(`[Collab] Environment: ${config.nodeEnv}`);

  // Connect to Redis
  try {
    await redis.ping();
    console.log('[Collab] Redis connected');
  } catch (error: any) {
    console.warn('[Collab] Redis connection failed:', error.message);
  }

  // Start Kafka consumer
  try {
    await KafkaConsumer.start();
  } catch (error: any) {
    console.warn('[Collab] Kafka connection failed:', error.message);
  }

  // Start Postgres sync worker
  PostgresSync.start();

  // Start awareness cleanup interval (every 5 seconds)
  setInterval(() => {
    AwarenessManager.cleanupStale();
  }, 5000);

  // Register Fastify plugins
  await registerPlugins();

  // Start server
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[Collab] Service running on port ${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Collab] Received ${signal}, shutting down gracefully...`);

  try {
    // Sync all cached documents
    await PostgresSync.syncAllCached();
    
    // Stop sync worker
    PostgresSync.stop();

    // Stop Kafka consumer
    await KafkaConsumer.stop();

    // Cleanup gateway subscribers
    await GatewayHandler.cleanup();

    // Close Redis connection
    await redis.quit();

    // Close Fastify
    await fastify.close();

    // Disconnect Prisma
    await disconnectPrisma();

    console.log('[Collab] Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[Collab] Shutdown error:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[Collab] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Collab] Uncaught Exception:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error('[Collab] Startup error:', error);
  process.exit(1);
});
