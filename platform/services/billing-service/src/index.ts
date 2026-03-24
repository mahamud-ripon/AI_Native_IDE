// Validate environment variables at startup
import '@workspace/config/env';

import { fastify, registerPlugins } from './app.js';
import { config } from './config.js';
import { redis, registerMeteringScript } from './lib/redis.js';
import { disconnectPrisma } from './lib/prisma.js';
import { KafkaPublisher } from './events/kafka_publisher.js';
import { KafkaConsumer } from './events/kafka_consumer.js';
import { DailyRollupWorker } from './workers/daily_rollup_worker.js';

async function main() {
  console.log('[Billing] Starting service...');
  console.log(`[Billing] Environment: ${config.nodeEnv}`);
  console.log(`[Billing] Port: ${config.port}`);

  // Connect to Redis
  try {
    await redis.connect();
    await registerMeteringScript();
    console.log('[Billing] Redis connected');
  } catch (error: any) {
    console.warn('[Billing] Redis connection failed:', error.message);
    console.log('[Billing] Continuing without Redis caching...');
  }

  // Connect Kafka
  try {
    await KafkaPublisher.connect();
    await KafkaConsumer.start();
  } catch (error: any) {
    console.warn('[Billing] Kafka connection failed:', error.message);
  }

  // Start rollup worker
  DailyRollupWorker.start();

  // Register Fastify plugins
  await registerPlugins();

  // Start server
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[Billing] Service running on port ${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[Billing] Received ${signal}, shutting down...`);
  
  try {
    await fastify.close();
    DailyRollupWorker.stop();
    await KafkaPublisher.disconnect();
    await KafkaConsumer.stop();
    await redis.quit();
    await disconnectPrisma();
    console.log('[Billing] Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[Billing] Shutdown error:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  console.error('[Billing] Startup error:', err);
  process.exit(1);
});
