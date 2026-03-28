/**
 * Fastify app factory for testing and production.
 * 
 * Exports a build() function that creates the Fastify instance
 * with all routes registered, suitable for testing.
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { aiRoutes } from './routes/api.js';
import { llmRoutes } from './routes/llm.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { adminConfigRoutes } from './routes/admin_config.js';

export async function build(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV !== 'test' 
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  await fastify.register(helmet);
  
  await fastify.register(cors, {
    origin: true,
  });

  // Register WebSocket plugin before routes
  await fastify.register(websocket);

  await fastify.register(aiRoutes, { prefix: '/ai' });
  await fastify.register(llmRoutes, { prefix: '/ai/llm' });
  await fastify.register(registerWorkflowRoutes, { prefix: '/ai' });
  await fastify.register(adminConfigRoutes);

  // Root health check
  fastify.get('/health', async () => ({ status: 'ok', service: 'ai-service' }));

  return fastify;
}

export default build;
