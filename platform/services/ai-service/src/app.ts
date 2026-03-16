/**
 * Fastify app factory for testing and production.
 * 
 * Exports a build() function that creates the Fastify instance
 * with all routes registered, suitable for testing.
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { aiRoutes } from './routes/api.js';
import { llmRoutes } from './routes/llm.js';
import { registerWorkflowRoutes } from './routes/workflows.js';

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

  await fastify.register(aiRoutes, { prefix: '/ai' });
  await fastify.register(llmRoutes, { prefix: '/ai/llm' });
  await registerWorkflowRoutes(fastify);

  // Root health check
  fastify.get('/health', async () => ({ status: 'ok', service: 'ai-service' }));

  return fastify;
}

export default build;
