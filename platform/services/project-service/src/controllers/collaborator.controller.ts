import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { generateToken } from '../lib/crypto';
import { permissionService, kafkaService } from '../services';
import { InviteCollaboratorSchema, UpdateCollaboratorRoleSchema } from '../dto';
import { NotFoundError, ForbiddenError, ValidationError } from '../middleware';

const logger = createLogger('collaborator-controller');

interface AuthenticatedRequest extends FastifyRequest {
  user: { sub: string; email: string; username: string; iat?: number; exp?: number };
}

/**
 * List collaborators
 * GET /api/v1/projects/:id/collaborators
 */
export async function listCollaborators(
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

    const collaborators = await prisma.projectCollaborator.findMany({
      where: { projectId: id },
      include: {
        user: {
          select: { id: true, username: true, email: true, avatarUrl: true },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    // Get owner info
    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        ownerId: true,
        owner: {
          select: { id: true, username: true, email: true, avatarUrl: true },
        },
      },
    });

    const ownerCollaborator = project
      ? {
          userId: project.owner.id,
          username: project.owner.username,
          email: project.owner.email,
          avatarUrl: project.owner.avatarUrl,
          role: 'owner' as const,
          joinedAt: project.ownerId ? new Date(0) : new Date(),
        }
      : null;

    const allCollaborators = [
      ownerCollaborator,
      ...collaborators.map((c) => ({
        userId: c.user.id,
        username: c.user.username,
        email: c.user.email,
        avatarUrl: c.user.avatarUrl,
        role: c.role,
        joinedAt: c.joinedAt,
      })),
    ].filter(Boolean);

    reply.send({
      success: true,
      data: { collaborators: allCollaborators },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to list collaborators', { error, projectId: id, userId, traceId });
    throw error;
  }
}

/**
 * Invite collaborator
 * POST /api/v1/projects/:id/collaborators
 */
export async function inviteCollaborator(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id } = request.params as { id: string };
  const traceId = request.id;

  try {
    const data = InviteCollaboratorSchema.parse(request.body);

    const hasAccess = await permissionService.checkAccess(userId, id, 'editor');
    if (!hasAccess) {
      throw new ForbiddenError('Edit permission required to invite collaborators');
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    // Check if already a collaborator
    if (existingUser) {
      const existingCollaborator = await prisma.projectCollaborator.findUnique({
        where: {
          projectId_userId: { projectId: id, userId: existingUser.id },
        },
      });

      if (existingCollaborator) {
        throw new ValidationError('User is already a collaborator');
      }

      // Check if owner
      const project = await prisma.project.findUnique({
        where: { id },
        select: { ownerId: true },
      });

      if (project?.ownerId === existingUser.id) {
        throw new ValidationError('Cannot invite the project owner as a collaborator');
      }
    }

    // Check for pending invitation
    const existingInvitation = await prisma.invitation.findFirst({
      where: {
        projectId: id,
        invitedEmail: data.email,
        status: 'pending',
      },
    });

    if (existingInvitation) {
      throw new ValidationError('Pending invitation already exists for this email');
    }

    // Create invitation
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await prisma.invitation.create({
      data: {
        projectId: id,
        invitedEmail: data.email,
        invitedById: userId,
        role: data.role === 'owner' ? 'admin' : data.role, // Map owner to admin for invitations
        token,
        status: 'pending',
        expiresAt,
      },
    });

    // Publish collaborator invited event
    await kafkaService.publish('collaborator.invited', {
      id: invitation.id,
      projectId: id,
      invitedEmail: data.email,
      role: data.role,
      invitedBy: userId,
    });

    logger.info('Collaborator invited', { projectId: id, invitationId: invitation.id, email: data.email, userId, traceId });

    reply.code(201).send({
      success: true,
      data: {
        id: invitation.id,
        invitedEmail: invitation.invitedEmail,
        role: data.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to invite collaborator', { error, projectId: id, userId, traceId });
    throw error;
  }
}

/**
 * Remove collaborator
 * DELETE /api/v1/projects/:id/collaborators/:userId
 */
export async function removeCollaborator(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const currentUserId = (request as AuthenticatedRequest).user.sub;
  const { id, userId } = request.params as { id: string; userId: string };
  const traceId = request.id;

  try {
    const hasAccess = await permissionService.checkAccess(currentUserId, id, 'owner');
    if (!hasAccess) {
      throw new ForbiddenError('Only owner can remove collaborators');
    }

    const collaborator = await prisma.projectCollaborator.findUnique({
      where: {
        projectId_userId: { projectId: id, userId },
      },
    });

    if (!collaborator) {
      throw new NotFoundError('Collaborator');
    }

    await prisma.projectCollaborator.delete({
      where: {
        projectId_userId: { projectId: id, userId },
      },
    });

    // Publish collaborator removed event
    await kafkaService.publish('collaborator.removed', {
      projectId: id,
      userId,
      removedBy: currentUserId,
    });

    logger.info('Collaborator removed', { projectId: id, userId, currentUserId, traceId });

    reply.send({
      success: true,
      data: null,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to remove collaborator', { error, projectId: id, userId, currentUserId, traceId });
    throw error;
  }
}

/**
 * Update collaborator role
 * PUT /api/v1/projects/:id/collaborators/:userId/role
 */
export async function updateCollaboratorRole(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const currentUserId = (request as AuthenticatedRequest).user.sub;
  const { id, userId } = request.params as { id: string; userId: string };
  const traceId = request.id;

  try {
    const data = UpdateCollaboratorRoleSchema.parse(request.body);

    const hasAccess = await permissionService.checkAccess(currentUserId, id, 'owner');
    if (!hasAccess) {
      throw new ForbiddenError('Only owner can update collaborator roles');
    }

    const collaborator = await prisma.projectCollaborator.findUnique({
      where: {
        projectId_userId: { projectId: id, userId },
      },
    });

    if (!collaborator) {
      throw new NotFoundError('Collaborator');
    }

    const updatedCollaborator = await prisma.projectCollaborator.update({
      where: {
        projectId_userId: { projectId: id, userId },
      },
      data: {
        role: data.role,
      },
    });

    logger.info('Collaborator role updated', { projectId: id, userId, newRole: data.role, currentUserId, traceId });

    reply.send({
      success: true,
      data: {
        userId: updatedCollaborator.userId,
        role: updatedCollaborator.role,
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to update collaborator role', { error, projectId: id, userId, currentUserId, traceId });
    throw error;
  }
}
