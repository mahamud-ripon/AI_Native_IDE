// Validate environment variables at startup
import '@workspace/config/env';

import { Consumer } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import { config } from './config/index';
import { logger } from './lib/logger';
import { connectRedis, disconnectRedis, getSubscriber } from './lib/redis';
import { ConnectionManager } from './connection/manager';
import { HeartbeatManager } from './connection/heartbeat';
import { buildApp, setupWebSocket } from './app';

let kafkaConsumer: Consumer | null = null;

async function startKafkaConsumer(): Promise<boolean> {
  if (!config.kafkaBrokers) {
    logger.warn('Kafka brokers not configured, skipping file events consumer');
    return false;
  }

  try {
    const kafka = createKafkaClient({ clientId: 'websocket-gateway', groupId: 'websocket-gateway-file-events' });

    kafkaConsumer = kafka.consumer({ groupId: 'websocket-gateway-file-events' });

    if (!kafkaConsumer) {
      logger.error('Failed to create Kafka consumer');
      return false;
    }

    await kafkaConsumer.connect();
    logger.info('Kafka consumer connected');

    await kafkaConsumer.subscribe({ topic: 'project.files.events', fromBeginning: false });

    await kafkaConsumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const event = JSON.parse(message.value?.toString() || '{}');
          logger.debug({ topic, event }, 'Received file event from Kafka');

          const { projectId, event: eventType, filePath } = event;

          if (!projectId) {
            logger.warn('File event missing projectId', { event });
            return;
          }

          // Broadcast to all clients subscribed to this project
          const broadcastMessage = JSON.stringify({
            type: 'workspace.file.event',
            data: {
              eventType: eventType || 'file.modified',
              projectId,
              filePath,
              timestamp: Date.now()
            }
          });

          ConnectionManager.broadcastToChannel(`project:${projectId}`, broadcastMessage);
          logger.debug({ projectId, eventType, filePath }, 'Broadcasted file event to project channel');
        } catch (error) {
          logger.error({ error, topic }, 'Error processing Kafka message');
        }
      },
    });

    logger.info('Kafka file events consumer started');
    return true;
  } catch (error) {
    // Make Kafka failures non-fatal - the gateway can still handle WebSocket connections
    logger.error({ error }, 'Failed to start Kafka consumer - WebSocket Gateway will run without file events');
    return false;
  }
}

async function setupRedisSubscriber() {
  const subscriber = getSubscriber();
  if (!subscriber) {
    logger.warn('Redis subscriber not available, skipping pub/sub setup');
    return;
  }

  const SUBSCRIBED_CHANNELS = [
    'collab:*',
    'terminal:*',
    'ai:*',
    'execution:*',
    'notifications:*',
    'deploy:*',
    'presence:*',
    'preview.hmr:*',
  ];

  subscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        payload = message;
      }

      ConnectionManager.broadcastToChannel(channel, {
        type: 'message',
        channel,
        payload,
      });
    } catch (err) {
      logger.error({ err, channel }, 'Error handling pmessage');
    }
  });

  // Subscribe to all broadcast channels
  for (const pattern of SUBSCRIBED_CHANNELS) {
    try {
      await subscriber.psubscribe(pattern);
    } catch (err) {
      logger.error({ err, pattern }, 'Failed to subscribe to pattern');
    }
  }

  logger.info('Redis pub/sub subscriber started for channels: ' + SUBSCRIBED_CHANNELS.join(', '));
}

async function main() {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  logger.info({ port: config.port, env: config.nodeEnv }, 'Starting WebSocket Gateway...');

  // Connect to Redis
  await connectRedis();

  // Start Redis pub/sub subscriber
  await setupRedisSubscriber();

  // Start Kafka consumer for file events (non-fatal)
  const kafkaStarted = await startKafkaConsumer();
  if (!kafkaStarted) {
    logger.warn('WebSocket Gateway running without Kafka file events support');
  }

  // Build Fastify app
  app = await buildApp();

  // Setup WebSocket endpoint
  await setupWebSocket(app);

  // Start heartbeat manager
  HeartbeatManager.start();

  // Start server
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`WebSocket Gateway running on port ${config.port}`);

  // Setup graceful shutdown with timeout
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down WebSocket Gateway...');

    const shutdownTimeout = setTimeout(() => {
      logger.error('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 15000);

    try {
      HeartbeatManager.stop();

      // Disconnect Kafka consumer
      if (kafkaConsumer) {
        try {
          await kafkaConsumer.disconnect();
        } catch (err) {
          logger.error({ err }, 'Error disconnecting Kafka consumer');
        }
      }

      // Close all WebSocket connections (snapshot to avoid concurrent modification)
      const connections = Array.from(ConnectionManager.getConnections().values());
      for (const conn of connections) {
        try {
          if (conn.ws.readyState === 1) { // OPEN
            conn.ws.close(1001, 'Server shutting down');
          }
        } catch {
          // Ignore close errors during shutdown
        }
      }

      await disconnectRedis();

      if (app) {
        await app.close();
      }

      logger.info('WebSocket Gateway shutdown complete');
      clearTimeout(shutdownTimeout);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    shutdown('unhandledRejection').catch(() => process.exit(1));
  });
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start WebSocket Gateway');
  process.exit(1);
});
