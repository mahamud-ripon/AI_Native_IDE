import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { createLogger } from '../lib/logger';

const logger = createLogger('request-middleware');

/**
 * Request logging middleware
 */
export function requestLoggingMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  const startTime = Date.now();

  // Log request
  logger.info('Incoming request', {
    method: request.method,
    path: request.url,
    userAgent: request.headers['user-agent'],
    ip: request.ip,
    traceId: request.id,
  });

  // Set response headers on send
  reply.header('X-Trace-Id', request.id);

  // Log on response finish
  reply.raw.on('finish', () => {
    const responseTime = Date.now() - startTime;
    reply.header('X-Response-Time', `${responseTime}ms`);

    logger.info('Response sent', {
      method: request.method,
      path: request.url,
      statusCode: reply.statusCode,
      responseTime,
      traceId: request.id,
    });
  });

  done();
}

/**
 * Rate limiting configuration
 */
export const rateLimitConfig = {
  max: 100,
  timeWindow: '1 minute',
  cache: 10000,
  allowList: ['127.0.0.1', '::1'],
  redis: process.env.REDIS_URL ? process.env.REDIS_URL : undefined,
  nameSpace: 'project-service-rate-limit:',
  continueExceeding: true,
  skipOnError: true,
};
