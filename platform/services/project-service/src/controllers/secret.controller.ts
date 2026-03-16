import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { permissionService, vaultService, kafkaService } from '../services';
import { CreateSecretSchema, UpdateSecretSchema } from '../dto';
import { NotFoundError, ForbiddenError, ValidationError } from '../middleware';

const logger = createLogger('secret-controller');

interface AuthenticatedRequest extends FastifyRequest {
  user: { sub: string; email: string; username: string; iat?: number; exp?: number };
}

/**
 * List secrets (only key names, never values)
 * GET /api/v1/projects/:id/secrets
 */
export async function listSecrets(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id } = request.params as { id: string };
  const traceId = request.id;

  try {
    const hasAccess = await permissionService.checkAccess(userId, id, 'viewer');
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to this project');
    }

    // Only return key names, never values
    const secrets = await prisma.projectSecret.findMany({
      where: { projectId: id },
      select: {
        id: true,
        keyName: true,
        environment: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    logger.debug('Secrets listed', { projectId: id, count: secrets.length, userId, traceId });

    reply.send({
      success: true,
      data: secrets,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to list secrets', { error, projectId: id, userId, traceId });
    throw error;
  }
}

/**
 * Create secret
 * POST /api/v1/projects/:id/secrets
 */
export async function createSecret(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id } = request.params as { id: string };
  const traceId = request.id;

  try {
    const data = CreateSecretSchema.parse(request.body);

    const hasAccess = await permissionService.checkAccess(userId, id, 'owner');
    if (!hasAccess) {
      throw new ForbiddenError('Only owner can manage secrets');
    }

    // Check if secret with same key exists
    const existingSecret = await prisma.projectSecret.findFirst({
      where: { projectId: id, keyName: data.keyName, environment: data.environment },
    });

    if (existingSecret) {
      throw new ValidationError(`Secret '${data.keyName}' already exists for ${data.environment} environment`);
    }

    // Store in Vault
    const vaultReferenceId = await vaultService.storeSecret(
      id,
      data.keyName,
      data.value,
      data.environment
    );

    // Store reference in DB (never the value)
    const secret = await prisma.projectSecret.create({
      data: {
        projectId: id,
        keyName: data.keyName,
        vaultReferenceId,
        environment: data.environment,
        createdById: userId,
      },
    });

    // Publish secret created event
    await kafkaService.publish('secret.created', {
      id: secret.id,
      projectId: id,
      keyName: data.keyName,
      environment: data.environment,
      createdBy: userId,
    });

    logger.info('Secret created', { projectId: id, secretId: secret.id, keyName: data.keyName, userId, traceId });

    reply.code(201).send({
      success: true,
      data: {
        id: secret.id,
        keyName: secret.keyName,
        environment: secret.environment,
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to create secret', { error, projectId: id, userId, traceId });
    throw error;
  }
}

/**
 * Update secret
 * PUT /api/v1/projects/:id/secrets/:secretId
 */
export async function updateSecret(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id, secretId } = request.params as { id: string; secretId: string };
  const traceId = request.id;

  try {
    const data = UpdateSecretSchema.parse(request.body);

    const hasAccess = await permissionService.checkAccess(userId, id, 'owner');
    if (!hasAccess) {
      throw new ForbiddenError('Only owner can manage secrets');
    }

    const secret = await prisma.projectSecret.findUnique({
      where: { id: secretId },
    });

    if (!secret || secret.projectId !== id) {
      throw new NotFoundError('Secret');
    }

    // Update in Vault
    const vaultReferenceId = await vaultService.storeSecret(
      id,
      secret.keyName,
      data.value,
      secret.environment
    );

    // Update reference in DB
    const updatedSecret = await prisma.projectSecret.update({
      where: { id: secretId },
      data: {
        vaultReferenceId,
      },
    });

    // Publish secret updated event
    await kafkaService.publish('secret.updated', {
      id: secret.id,
      projectId: id,
      keyName: secret.keyName,
      environment: secret.environment,
      updatedBy: userId,
    });

    logger.info('Secret updated', { projectId: id, secretId, userId, traceId });

    reply.send({
      success: true,
      data: {
        id: updatedSecret.id,
        keyName: updatedSecret.keyName,
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to update secret', { error, projectId: id, secretId, userId, traceId });
    throw error;
  }
}

/**
 * Delete secret
 * DELETE /api/v1/projects/:id/secrets/:secretId
 */
export async function deleteSecret(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id, secretId } = request.params as { id: string; secretId: string };
  const traceId = request.id;

  try {
    const hasAccess = await permissionService.checkAccess(userId, id, 'owner');
    if (!hasAccess) {
      throw new ForbiddenError('Only owner can delete secrets');
    }

    const secret = await prisma.projectSecret.findUnique({
      where: { id: secretId },
    });

    if (!secret || secret.projectId !== id) {
      throw new NotFoundError('Secret');
    }

    // Delete from Vault
    await vaultService.deleteSecret(id, secret.keyName, secret.environment);

    // Delete from DB
    await prisma.projectSecret.delete({
      where: { id: secretId },
    });

    // Publish secret deleted event
    await kafkaService.publish('secret.deleted', {
      id: secret.id,
      projectId: id,
      keyName: secret.keyName,
      environment: secret.environment,
      deletedBy: userId,
    });

    logger.info('Secret deleted', { projectId: id, secretId, userId, traceId });

    reply.send({
      success: true,
      data: null,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to delete secret', { error, projectId: id, secretId, userId, traceId });
    throw error;
  }
}
