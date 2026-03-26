import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { kafkaService, vaultService } from '../services';

const logger = createLogger('health-controller');

/**
 * Basic health check
 * GET /api/v1/health
 */
export async function healthCheck(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.send({
    status: 'healthy',
    service: 'project-service',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
}

/**
 * Detailed health check with dependencies
 * GET /api/v1/health/detailed
 */
export async function detailedHealthCheck(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const traceId = request.id;
  const checks: Record<string, { status: string; message?: string; latency?: number }> = {};

  // Check database
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = {
      status: 'healthy',
      latency: Date.now() - start,
    };
  } catch (error) {
    checks.database = {
      status: 'unhealthy',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Check Kafka
  const kafkaHealth = await kafkaService.healthCheck();
  checks.kafka = {
    status: kafkaHealth.healthy ? 'healthy' : 'unhealthy',
    message: kafkaHealth.message,
  };

  // Check Vault
  const vaultHealth = await vaultService.healthCheck();
  checks.vault = {
    status: vaultHealth.healthy ? 'healthy' : 'unhealthy',
    message: vaultHealth.message,
  };

  const allHealthy = Object.values(checks).every((c) => c.status === 'healthy');

  reply.code(allHealthy ? 200 : 503).send({
    status: allHealthy ? 'healthy' : 'degraded',
    service: 'project-service',
    timestamp: new Date().toISOString(),
    checks,
    traceId,
  });
}

/**
 * Circuit breaker status
 * GET /api/v1/health/circuit-breaker
 */
export async function circuitBreakerStatus(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const kafkaHealth = await kafkaService.healthCheck();
  const vaultHealth = await vaultService.healthCheck();

  reply.send({
    success: true,
    data: {
      storageService: {
        state: 'closed',
        failureCount: 0,
      },
      vaultService: {
        state: vaultHealth.healthy ? 'closed' : 'open',
        failureCount: vaultHealth.healthy ? 0 : 1,
      },
      kafkaService: {
        state: kafkaHealth.healthy ? 'closed' : 'open',
        failureCount: kafkaHealth.healthy ? 0 : 1,
      },
    },
  });
}
