import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { createLogger } from '../lib/logger';

const logger = createLogger('error-middleware');

export interface ApiError {
  success: false;
  error: string;
  details?: unknown;
  traceId: string;
}

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/**
 * Global error handler middleware
 */
export async function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const traceId = request.id;

  // Log the error
  logger.error('Request error', {
    traceId,
    error: error.message,
    stack: error.stack,
    path: request.url,
    method: request.method,
  });

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    reply.code(400).send({
      success: false,
      error: 'Validation failed',
      details: error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
      traceId,
    } as ApiError);
    return;
  }

  // Handle custom AppError
  if (error instanceof AppError) {
    reply.code(error.statusCode).send({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
      traceId,
    } as ApiError);
    return;
  }

  // Handle Fastify errors
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    reply.code(error.statusCode).send({
      success: false,
      error: error.message || 'Request error',
      traceId,
    } as ApiError);
    return;
  }

  // Handle unknown errors
  reply.code(500).send({
    success: false,
    error: config.nodeEnv === 'development' ? error.message : 'Internal server error',
    traceId,
  } as ApiError);
}

import { config } from '../config';
