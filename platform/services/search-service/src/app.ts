import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { IndexManager } from './services/elasticsearch.service.js';
import { searchCode } from './controllers/code-search.controller.js';
import { searchFiles } from './controllers/file-search.controller.js';
import { discoverProjects } from './controllers/project-discovery.controller.js';
import { upsertEmbedding, deleteEmbedding } from './controllers/embed.controller.js';
import { authMiddleware, optionalAuthMiddleware } from './middleware/auth.middleware.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === 'development',
  });

  // Register security plugins
  await app.register(helmet);
  await app.register(cors, {
    origin: config.nodeEnv === 'production' 
      ? ['https://platform.io', /.*\.platform\.io$/] 
      : true,
    credentials: true,
  });

  // Health check endpoint
  app.get('/health', async (request, reply) => {
    const esHealth = await IndexManager.healthCheck();
    return reply.send({
      status: 'ok',
      service: 'search-service',
      elasticsearch: esHealth,
      timestamp: new Date().toISOString(),
    });
  });

  // Circuit breaker health check
  app.get('/health/circuit-breaker', async (request, reply) => {
    const esHealth = await IndexManager.healthCheck();
    return reply.send({
      success: true,
      data: {
        elasticsearch: { state: esHealth.status === 'healthy' ? 'closed' : 'open' },
      },
    });
  });

  // Code search - requires auth
  app.get('/api/v1/search/code', { preHandler: authMiddleware }, searchCode);

  // File search - requires auth
  app.get('/api/v1/search/files', { preHandler: authMiddleware }, searchFiles);

  // Project discovery - public endpoint
  app.get('/api/v1/search/projects', { preHandler: optionalAuthMiddleware }, discoverProjects);

  // Embed routes - internal service-to-service (uses X-Internal-Api-Key)
  app.post('/embed', { preHandler: authMiddleware }, upsertEmbedding);
  app.delete('/embed/:fileId', { preHandler: authMiddleware }, deleteEmbedding);

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({ error, url: request.url }, 'Unhandled error');
    reply.status(500).send({
      success: false,
      error: 'Internal server error',
    });
  });

  return app;
}

export default buildApp;
