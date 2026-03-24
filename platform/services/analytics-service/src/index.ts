// Validate environment variables at startup
import '@workspace/config/env';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { analyticsRoutes } from './routes/api.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import { KafkaConsumer } from './events/kafka_consumer.js';
import { DailySnapshotWorker } from './workers/daily_snapshot_worker.js';

const fastify = Fastify({
  logger: true,
});

async function start() {
  try {
    await fastify.register(helmet);
    await fastify.register(cors, {
      origin: process.env.NODE_ENV === 'production'
        ? ['https://platform.io', /^https:\/\/.*\.platform\.io$/]
        : true,
      credentials: true,
    });
    await fastify.register(analyticsRoutes);

    await connectRedis();
    await KafkaConsumer.start();

    setInterval(() => {
      DailySnapshotWorker.run().catch(console.error);
    }, 24 * 60 * 60 * 1000);

    await fastify.listen({ port: config.port });
    console.log(`Analytics Service running on port ${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await fastify.close();
  await KafkaConsumer.stop();
  await disconnectRedis();
  process.exit(0);
});

start();
