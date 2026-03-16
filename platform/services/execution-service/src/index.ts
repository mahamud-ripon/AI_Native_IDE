import dotenv from 'dotenv';
dotenv.config();

import { app, server } from './app.js';
import { config } from './config/index.js';
import { redis } from './lib/redis.js';
import { disconnectPrisma } from './lib/prisma.js';
import { Prewarmer } from './vm_manager/prewarmer.js';
import { FileSync } from './streams/fs_sync.js';
import { KafkaPublisher } from './events/kafka_publisher.js';

async function main() {
  console.log('[Execution] Starting service...');

  await redis.connect();
  await KafkaPublisher.connect();

  // Start VM prewarmer
  Prewarmer.start();

  // Start file sync
  FileSync.start();

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

main().catch(console.error);
