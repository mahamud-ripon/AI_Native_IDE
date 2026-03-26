// Validate environment variables at startup
import '@workspace/config/env';

import { app } from './app.js';
import { config } from './config/index.js';
import { redis } from './lib/redis.js';
import { disconnectPrisma } from './lib/prisma.js';
import { KafkaConsumer } from './events/kafka_consumer.js';
import { EmailWorker } from './workers/email_worker.js';

async function main() {
  console.log('[Notification] Starting service...');

  await redis.connect();
  await KafkaConsumer.start();
  EmailWorker.start();

  app.listen(config.port, () => {
    console.log(`[Notification] Service running on port ${config.port}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[Notification] Shutting down...');
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Notification] SIGINT received, shutting down...');
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Notification] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Notification] Uncaught Exception:', error);
  process.exit(1);
});

main().catch(console.error);
