import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from './config/index';
import { logger } from './lib/logger';
import { ConnectionManager } from './connection/manager';
import { HeartbeatManager } from './connection/heartbeat';
import { wsRateLimiterMiddleware } from './middleware/rate-limiter';

// Track disconnected connections to prevent double cleanup
const disconnectedConns = new Set<string>();

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === 'development',
    trustProxy: ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.nodeEnv === 'production'
      ? ['https://platform.io', /^https:\/\/.*\.platform\.io$/]
      : true,
    credentials: true,
  });

  await app.register(fastifyRateLimit, {
    max: config.rateLimit.perSecond * 60,
    timeWindow: '1 minute',
    allowList: ['/health', '/health/circuit-breaker'],
  });

  // Register WebSocket plugin
  await app.register(websocket, {
    options: {
      maxPayload: 10 * 1024 * 1024, // 10MB max message size
      clientTracking: true,
    }
  });

  // Health endpoints
  app.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      service: 'websocket-gateway',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health/circuit-breaker', async (request, reply) => {
    return reply.send({
      success: true,
      data: { message: 'No circuit breakers configured for this service' },
    });
  });

  // WebSocket stats
  app.get('/api/v1/ws/stats', async (request, reply) => {
    return reply.send({
      active_connections: ConnectionManager.getActiveConnectionCount(),
      active_users: ConnectionManager.getActiveUserCount(),
    });
  });

  // Get connection info for a user (requires authentication)
  app.get('/api/v1/ws/user/:userId', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const internalApiKey = request.headers['x-internal-api-key'] as string | undefined;
    
    // Only allow internal service calls or authenticated requests
    if (internalApiKey !== config.internalApiKey && !authHeader) {
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }

    const { userId } = request.params as { userId: string };
    const connections = ConnectionManager.getUserConnections(userId);
    return reply.send({
      userId,
      connectionCount: connections.length,
      connections,
    });
  });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({ error, url: request.url }, 'Unhandled error');

    if (error.validation) {
      reply.status(400).send({
        success: false,
        error: 'Validation error',
        details: error.validation,
      });
      return;
    }

    reply.status(500).send({
      success: false,
      error: 'Internal server error',
    });
  });

  return app;
}

export async function setupWebSocket(app: FastifyInstance): Promise<void> {
  // WebSocket endpoint with proper upgrade using @fastify/websocket
  // NOTE: @fastify/websocket v8+ passes the raw WebSocket socket as the first arg,
  // not a wrapper object. v10 handler signature is (socket, request).
  app.get('/gateway', { websocket: true }, async (socket: any, req) => {
    const ip = req.ip;
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.close(1008, 'Missing token');
      return;
    }

    // Use ConnectionManager to handle authentication and registration
    const connId = await ConnectionManager.handleConnection(socket, token);
    if (!connId) {
      return; // Connection was closed by handleConnection
    }

    // Clear any prior disconnect tracking for this connId
    disconnectedConns.delete(connId);

    logger.info({ connId, ip }, 'WebSocket connected');

    // Start global heartbeat manager (singleton)
    HeartbeatManager.start();

    // Handle incoming messages
    socket.on('message', (data: Buffer) => {
      ConnectionManager.handleMessage(connId, data);
    });

    // Handle close - guard against double disconnect
    socket.on('close', () => {
      if (disconnectedConns.has(connId)) return;
      disconnectedConns.add(connId);
      ConnectionManager.handleDisconnect(connId).catch((err) => {
        logger.error({ err, connId }, 'Error handling disconnect');
      });
      logger.info({ connId }, 'WebSocket disconnected');
      // Clean up tracking after a delay
      setTimeout(() => disconnectedConns.delete(connId), 60000);
    });

    // Handle errors - guard against double disconnect
    socket.on('error', (err: Error) => {
      logger.error({ err, connId }, 'WebSocket error');
      if (disconnectedConns.has(connId)) return;
      disconnectedConns.add(connId);
      ConnectionManager.handleDisconnect(connId).catch((disconnectErr) => {
        logger.error({ disconnectErr, connId }, 'Error handling disconnect');
      });
    });
  });

  logger.info('WebSocket endpoint configured at /gateway');
}

export default buildApp;
