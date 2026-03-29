import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyHttpProxy from '@fastify/http-proxy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from root directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { requestTracerMiddleware, logRequestResolution } from './logging/request_tracer';
import { idempotencyMiddleware, resolveIdempotency } from './middleware/idempotency';
import { ddosProtectionMiddleware } from './middleware/ddos_protection';
import { edgeAuthMiddleware } from './middleware/edge_auth';
import { globalRateLimiterMiddleware } from './middleware/global_rate_limiter';
import { proxyRouter } from './routes/proxy_router';


export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: true,
    bodyLimit: 2 * 1024 * 1024, // 2MB max body size
  });

  // 1. Request Tracing (X-Trace-Id injection) - must be first
  app.addHook('onRequest', requestTracerMiddleware);

  // 1.5 Body size check (before proxy)
  app.addHook('onRequest', async (request, reply) => {
    const contentLength = parseInt(request.headers['content-length'] || '0', 10);
    if (contentLength > 2 * 1024 * 1024) { // 2MB
      return reply.status(413).send({ error: 'Payload Too Large', maxSize: '2MB' });
    }
  });

  // 2. CORS - Only allow specific origins
  await app.register(fastifyCors, {
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://platform.io', /.*\.platform\.io$/] 
      : ['http://localhost:5173', true],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Trace-Id'],
  });

  // 3. Cookie parsing
  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || (() => { throw new Error('Missing required environment variable: COOKIE_SECRET'); })(),
    hook: 'onRequest',
  });

  // 4. Global IP-based rate limiting for anonymous endpoints (fallback)
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    skipOnError: true,
  });

  // 5. DDoS Protection (JSON depth, prototype pollution)
  app.addHook('onRequest', ddosProtectionMiddleware);

  // 6. Idempotency middleware for POST/PUT/DELETE
  app.addHook('onRequest', idempotencyMiddleware);

  // 7. JWT Edge Authentication (stateless verification)
  app.addHook('onRequest', edgeAuthMiddleware);

  // 8. Auth-aware rate limiting (after auth middleware so we have user context)
  app.addHook('onRequest', globalRateLimiterMiddleware);

  // Healthcheck Route
  app.get('/health', async () => {
    return { status: 'ok', service: 'api-gateway' };
  });

  // 9. Register Proxy Router (routes to downstream services)
  await proxyRouter(app);

  // 10. Custom error handler for proxy failures
  app.setErrorHandler((error: any, request, reply) => {
    const isConnectionRefused =
      error.code === 'ECONNREFUSED' ||
      error.code === 'FST_REPLY_FROM_INTERNAL_SERVER_ERROR' ||
      error.message?.includes('ECONNREFUSED');

    if (isConnectionRefused) {
      request.log.warn({ err: error, url: request.url }, 'Downstream service unavailable');
      return reply.status(503).send({
        success: false,
        error: 'Service temporarily unavailable',
        message: 'The downstream service is starting up. Please retry.',
        code: 'SERVICE_UNAVAILABLE',
      });
    }

    request.log.error({ err: error, url: request.url }, 'Unhandled proxy error');
    return reply.status(500).send({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  // Response hooks for logging and idempotency resolution
  app.addHook('onSend', async (request, reply, payload) => {
    // Log request completion
    logRequestResolution(request, reply);
    
    // Handle idempotency caching
    return resolveIdempotency(request, reply, payload);
  });

  return app;
};
