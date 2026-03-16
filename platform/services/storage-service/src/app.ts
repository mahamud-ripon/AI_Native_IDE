import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config/index';
import { logger } from './lib/logger';
import { authMiddleware, adminAuthMiddleware } from './middleware/auth.middleware';
import { uploadRateLimiter, downloadRateLimiter } from './middleware/rate-limiter.middleware';
import { UploadController } from './controllers/upload.controller';
import { DownloadController } from './controllers/download.controller';
import { AdminController } from './controllers/admin.controller';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === 'development',
    trustProxy: true,
  });

  // Register security plugins
  await app.register(helmet);
  await app.register(cors, {
    origin: config.nodeEnv === 'production'
      ? ['https://platform.io', /.*\.platform\.io$/]
      : true,
    credentials: true,
  });

  // Health check endpoint (public)
  app.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      service: 'storage-service',
      timestamp: new Date().toISOString(),
    });
  });

  // Circuit breaker health check
  app.get('/health/circuit-breaker', async (request, reply) => {
    return reply.send({
      status: 'closed',
      failures: 0,
      nextAttempt: 0,
    });
  });

  // Storage health check (with S3 connectivity)
  app.get('/api/v1/storage/health', { preHandler: authMiddleware }, AdminController.healthCheck);

  // Pre-signed URL endpoints
  // POST /api/v1/storage/presign/upload - Generate upload URL
  app.post('/api/v1/storage/presign/upload', {
    preHandler: [authMiddleware, uploadRateLimiter],
  }, UploadController.getPresignedUploadUrl);

  // POST /api/v1/storage/presign/avatar - Generate avatar upload URL
  app.post('/api/v1/storage/presign/avatar', {
    preHandler: [authMiddleware, uploadRateLimiter],
  }, UploadController.getPresignedAvatarUrl);

  // POST /api/v1/storage/presign/download - Generate download URL
  app.post('/api/v1/storage/presign/download', {
    preHandler: [authMiddleware, downloadRateLimiter],
  }, DownloadController.getPresignedDownloadUrl);

  // GET /api/v1/storage/download/:key - Direct download (redirects)
  app.get('/api/v1/storage/download/:key', {
    preHandler: [authMiddleware, downloadRateLimiter],
  }, DownloadController.downloadFile);

  // Object management endpoints
  // DELETE /api/v1/storage/objects - Batch delete objects
  app.delete('/api/v1/storage/objects', {
    preHandler: authMiddleware,
  }, AdminController.deleteObjects);

  // Admin endpoints
  // GET /api/v1/storage/stats - Get storage statistics
  app.get('/api/v1/storage/stats', {
    preHandler: authMiddleware,
  }, AdminController.getStats);

  // POST /api/v1/storage/cleanup - Run orphan cleanup (admin only)
  app.post('/api/v1/storage/cleanup', {
    preHandler: adminAuthMiddleware,
  }, AdminController.runCleanup);

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({ error, url: request.url }, 'Unhandled error');

    // Validation errors
    if (error.validation) {
      reply.status(400).send({
        success: false,
        error: 'Validation error',
        details: error.validation,
      });
      return;
    }

    // Fastify errors
    if (error.statusCode) {
      reply.status(error.statusCode).send({
        success: false,
        error: error.message,
      });
      return;
    }

    // Generic errors
    reply.status(500).send({
      success: false,
      error: 'Internal server error',
    });
  });

  return app;
}

export default buildApp;
