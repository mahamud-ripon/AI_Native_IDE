import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { authMiddleware, internalAuthMiddleware } from './middleware/auth.js';
import { CollabController } from './controllers/collab_controller.js';

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'development' ? 'debug' : 'info',
  },
  bodyLimit: 10485760, // 10MB for document updates
});

// Register plugins async
async function registerPlugins() {
  await fastify.register(helmet);
  await fastify.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://platform.io', /^https:\/\/.*\.platform\.io$/]
      : true,
    credentials: true,
  });
}

// Health check endpoints
fastify.get('/health', async () => {
  return { status: 'ok', service: 'collab-service' };
});

fastify.get('/health/circuit-breaker', async () => {
  return { status: 'closed', failures: 0 };
});

// Protected endpoints with auth
fastify.get('/api/v1/collab/files/:file_id', { 
  preHandler: [authMiddleware] 
}, async (request, reply) => CollabController.getFile(request as any, reply));

fastify.post('/api/v1/collab/join', { 
  preHandler: [authMiddleware] 
}, async (request, reply) => CollabController.joinCollab(request as any, reply));

fastify.post('/api/v1/collab/leave', { 
  preHandler: [authMiddleware] 
}, async (request, reply) => CollabController.leaveCollab(request as any, reply));

fastify.get('/api/v1/collab/documents', { 
  preHandler: [authMiddleware] 
}, async (request, reply) => CollabController.listDocuments(request as any, reply));

fastify.get('/api/v1/collab/presence/:file_id', { 
  preHandler: [authMiddleware] 
}, async (request, reply) => CollabController.getPresence(request as any, reply));

// Internal endpoints
fastify.get('/api/v1/collab/stats', { 
  preHandler: [internalAuthMiddleware] 
}, async (request, reply) => CollabController.getStats(request, reply));

// Error handler
fastify.setErrorHandler((error, _request, reply) => {
  console.error('[App] Error:', error);
  
  if (error.validation) {
    return reply.status(400).send({ error: 'Validation error', details: error.validation });
  }
  
  return reply.status(500).send({ error: 'Internal server error' });
});

export { fastify, registerPlugins };
