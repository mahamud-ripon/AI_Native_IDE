import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Kafka, Consumer } from 'kafkajs';
import { config } from './config/index';
import { logger } from './lib/logger';
import { connectRedis, disconnectRedis } from './lib/redis';
import { ConnectionManager } from './connection/manager';
import { HeartbeatManager } from './connection/heartbeat';
import { buildApp } from './app';

let kafkaConsumer: Consumer | null = null;

async function startKafkaConsumer() {
  if (!config.kafkaBrokers) {
    logger.warn('Kafka brokers not configured, skipping file events consumer');
    return;
  }

  const kafka = new Kafka({
    clientId: 'websocket-gateway',
    brokers: config.kafkaBrokers.split(','),
  });

  kafkaConsumer = kafka.consumer({ groupId: 'websocket-gateway-file-events' });

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
}

async function main() {
  logger.info({ port: config.port, env: config.nodeEnv }, 'Starting WebSocket Gateway...');

  // Connect to Redis
  await connectRedis();

  // Start Kafka consumer for file events
  await startKafkaConsumer();

  // Build Fastify app for HTTP endpoints
  const app = await buildApp();

  // Create HTTP server
  const server = createServer(app.server);

  // Setup WebSocket server
  const wss = new WebSocketServer({ server, path: '/gateway' });

  wss.on('connection', async (ws: WebSocket, req) => {
    // Get token from query
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing token');
      return;
    }

    // Handle WebSocket connection
    const connId = await ConnectionManager.handleConnection(ws, token);

    if (!connId) {
      return;
    }

    // Handle messages
    ws.on('message', async (message: Buffer | ArrayBuffer) => {
      const msg = Buffer.isBuffer(message) ? message.toString() : Buffer.from(message).toString();
      await ConnectionManager.handleMessage(connId, msg);
    });

    // Handle pong (heartbeat response)
    ws.on('pong', () => {
      HeartbeatManager.updatePing(connId);
    });

    // Handle close
    ws.on('close', async () => {
      await ConnectionManager.handleDisconnect(connId);
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error({ error, connId }, 'WebSocket error');
    });
  });

  // Start heartbeat manager
  HeartbeatManager.start();

  // Start server
  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      logger.info(`WebSocket Gateway running on port ${config.port}`);
      resolve();
    });
  });

  // Setup graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down WebSocket Gateway...');

    HeartbeatManager.stop();

    // Close all WebSocket connections
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });

    await disconnectRedis();
    server.close();

    logger.info('WebSocket Gateway shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start WebSocket Gateway');
  process.exit(1);
});
