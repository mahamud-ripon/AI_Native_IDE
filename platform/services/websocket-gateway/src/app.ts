import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from './config/index';
import { logger } from './lib/logger';
import { ConnectionManager } from './connection/manager';
import { HeartbeatManager } from './connection/heartbeat';
import { wsRateLimiterMiddleware } from './middleware/rate-limiter';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === 'development',
    trustProxy: true,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.nodeEnv === 'production'
      ? ['https://platform.io', /.*\.platform\.io$/]
      : true,
    credentials: true,
  });

  await app.register(fastifyRateLimit, {
    max: config.rateLimit.perSecond * 60,
    timeWindow: '1 minute',
    allowList: ['/health', '/health/circuit-breaker'],
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
      status: 'closed',
      failures: 0,
      nextAttempt: 0,
    });
  });

  // WebSocket stats
  app.get('/api/v1/ws/stats', async (request, reply) => {
    return reply.send({
      active_connections: ConnectionManager.getActiveConnectionCount(),
      active_users: ConnectionManager.getActiveUserCount(),
    });
  });

  // Get connection info for a user
  app.get('/api/v1/ws/user/:userId', async (request, reply) => {
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
  app.get('/gateway', { config: { rateLimit: { max: config.rateLimit.perSecond } } }, async (request, reply) => {
    const ip = request.ip;
    
    // Get token from query
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      reply.status(400).send({ error: 'Missing token' });
      return;
    }

    // Upgrade to WebSocket
    const socket = reply.raw;
    if (!socket) return;

    socket.on('error', (err) => {
      logger.error({ err }, 'Socket error');
    });

    // Note: In production, use @fastify/websocket for proper Fastify integration
    // This is a simplified version - the actual WS handling happens in the HTTP upgrade
  });

  logger.info('WebSocket endpoint configured at /gateway');
}

export default buildApp;
