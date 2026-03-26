// Validate environment variables at startup
import '@workspace/config/env';

import { app, server } from './app.js';
import { config } from './config/index.js';
import { redis } from './lib/redis.js';
import { disconnectPrisma } from './lib/prisma.js';
import { Prewarmer } from './vm_manager/prewarmer.js';
import { FileSync } from './streams/fs_sync.js';
import { KafkaPublisher } from './events/kafka_publisher.js';

async function main() {
  console.log('[Execution] Starting service...');

  try {
    await redis.connect();
  } catch (err) {
    console.warn('[Execution] Redis connection failed, continuing without Redis:', err);
  }

  try {
    await KafkaPublisher.connect();
  } catch (err) {
    console.warn('[Execution] Kafka connection failed, continuing without Kafka:', err);
  }

  // Start VM prewarmer
  try {
    Prewarmer.start();
  } catch (err) {
    console.warn('[Execution] Prewarmer failed to start:', err);
  }

  // Start file sync
  try {
    FileSync.start();
  } catch (err) {
    console.warn('[Execution] FileSync failed to start:', err);
  }

  server.listen(config.port, () => {
    console.log(`[Execution] Service running on port ${config.port}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[Execution] Shutting down...');
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Execution] SIGINT received, shutting down...');
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Execution] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Execution] Uncaught Exception:', error);
  process.exit(1);
});

main().catch(console.error);
