// Validate environment variables at startup
import '@workspace/config/env';

import { app } from './app.js';
import { config } from './config/index.js';
import { disconnectPrisma } from './lib/prisma.js';
import { KafkaPublisher } from './events/kafka_publisher.js';
import { KafkaConsumer } from './events/kafka_consumer.js';
import { DomainVerifier } from './services/domain_verifier.js';

async function main() {
  console.log('[Deployment] Starting service...');

  await KafkaPublisher.connect();
  await KafkaConsumer.start();

  DomainVerifier.start();

  app.listen(config.port, () => {
    console.log(`[Deployment] Service running on port ${config.port}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[Deployment] Shutting down...');
  await disconnectPrisma();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Deployment] SIGINT received, shutting down...');
  await disconnectPrisma();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Deployment] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Deployment] Uncaught Exception:', error);
  process.exit(1);
});

main().catch(console.error);
