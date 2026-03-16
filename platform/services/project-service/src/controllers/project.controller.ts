import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { generateSlug } from '../lib/crypto';
import { permissionService, kafkaService, gitCloneService } from '../services';
import { CreateProjectSchema, UpdateProjectSchema, ImportProjectSchema, ListProjectsQuerySchema } from '../dto';
import { NotFoundError, ForbiddenError, ValidationError } from '../middleware';

const logger = createLogger('project-controller');

interface AuthenticatedRequest extends FastifyRequest {
  user: { sub: string; email: string; username: string; iat?: number; exp?: number };
}

/**
 * Create a new project
 * POST /api/v1/projects
 */
export async function createProject(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const traceId = request.id;

  try {
    const data = CreateProjectSchema.parse(request.body);
    const slug = generateSlug(data.name);

    const project = await prisma.$transaction(async (tx) => {
      const newProject = await tx.project.create({
        data: {
          ownerId: userId,
          name: data.name,
          slug,
          description: data.description,
          template: data.template,
          visibility: data.visibility,
          orgId: data.orgId,
          status: 'pending',
        },
        include: {
          owner: {
            select: { id: true, username: true, email: true },
          },
        },
      });

      // Create default branch
      await tx.projectBranch.create({
        data: {
          projectId: newProject.id,
          name: 'main',
          isDefault: true,
        },
      });

      return newProject;
    });

    // Publish Kafka event
    await kafkaService.publish('project.created', {
      id: project.id,
      projectId: project.id,
      ownerId: userId,
      name: project.name,
      template: project.template,
      visibility: project.visibility,
    });

    logger.info('Project created', { projectId: project.id, userId, traceId });

    reply.code(201).send({
      success: true,
      data: project,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to create project', { error, userId, traceId });
    throw error;
  }
}

/**
 * List user projects
 * GET /api/v1/projects
 */
export async function listProjects(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const traceId = request.id;

  try {
    const query = ListProjectsQuerySchema.parse(request.query);
    const { page, limit, visibility, status, cursor } = query;

    // Get owned projects
    const ownedProjects = await prisma.project.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        ...(visibility && { visibility }),
        ...(status && { status }),
      },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor } }),
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: { select: { id: true, username: true } },
        _count: { select: { files: true, collaborators: true } },
      },
    });

    // Get collaborated projects
    const collaboratedProjects = await prisma.projectCollaborator.findMany({
      where: { userId },
      include: {
        project: {
          include: {
            owner: { select: { id: true, username: true } },
            _count: { select: { files: true, collaborators: true } },
          },
        },
      },
    });

    const collabProjects = collaboratedProjects
      .map((c) => c.project)
      .filter((p) => !p.deletedAt && (!visibility || p.visibility === visibility) && (!status || p.status === status));

    // Combine and sort
    const allProjects = [...ownedProjects, ...collabProjects]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit + 1);

    const hasMore = allProjects.length > limit;
    const projects = hasMore ? allProjects.slice(0, -1) : allProjects;
    const nextCursor = hasMore ? projects[projects.length - 1]?.id : undefined;

    reply.send({
      success: true,
      data: {
        projects,
        pagination: {
          page,
          limit,
          total: projects.length,
          hasMore,
          nextCursor,
        },
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to list projects', { error, userId, traceId });
    throw error;
  }
}

/**
 * Get project by ID
 * GET /api/v1/projects/:id
 */
export async function getProject(
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

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, username: true, email: true } },
        branches: true,
        _count: { select: { files: true, collaborators: true } },
      },
    });

    if (!project || project.deletedAt) {
      throw new NotFoundError('Project');
    }

    // Update lastOpenedAt
    await prisma.project.update({
      where: { id },
      data: { lastOpenedAt: new Date() },
    });

    reply.send({
      success: true,
      data: project,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to get project', { error, projectId: id, userId, traceId });
    throw error;
  }
}

/**
 * Update project
 * PUT /api/v1/projects/:id
 */
export async function updateProject(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id } = request.params as { id: string };
  const traceId = request.id;

  try {
    const data = UpdateProjectSchema.parse(request.body);

    const hasAccess = await permissionService.checkAccess(userId, id, 'owner');
    if (!hasAccess) {
      throw new ForbiddenError('Only owner can update project');
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.visibility && { visibility: data.visibility }),
      },
      include: {
        owner: { select: { id: true, username: true } },
      },
    });

    // Publish update event
    await kafkaService.publish('project.updated', {
      id: project.id,
      projectId: project.id,
      name: project.name,
      visibility: project.visibility,
    });

    logger.info('Project updated', { projectId: id, userId, traceId });

    reply.send({
      success: true,
      data: project,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to update project', { error, projectId: id, userId, traceId });
    throw error;
  }
}

/**
 * Delete project (soft delete)
 * DELETE /api/v1/projects/:id
 */
export async function deleteProject(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id } = request.params as { id: string };
  const traceId = request.id;

  try {
    const hasAccess = await permissionService.checkAccess(userId, id, 'owner');
    if (!hasAccess) {
      throw new ForbiddenError('Only owner can delete project');
    }

    // Soft delete
    await prisma.project.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // Publish deletion event
    await kafkaService.publish('project.deleted', {
      id,
      projectId: id,
      deletedBy: userId,
    });

    logger.info('Project deleted', { projectId: id, userId, traceId });

    reply.send({
      success: true,
      data: null,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to delete project', { error, projectId: id, userId, traceId });
    throw error;
  }
}

/**
 * Import project from Git
 * POST /api/v1/projects/import
 */
export async function importProject(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const traceId = request.id;

  try {
    const data = ImportProjectSchema.parse(request.body);
    const slug = generateSlug(data.name);

    const project = await prisma.project.create({
      data: {
        ownerId: userId,
        name: data.name,
        slug,
        visibility: data.visibility,
        gitRepoUrl: data.gitRepoUrl,
        status: 'pending',
      },
    });

    // Create default branch
    await prisma.projectBranch.create({
      data: {
        projectId: project.id,
        name: data.branch,
        isDefault: true,
      },
    });

    // Trigger git clone via execution-service
    await gitCloneService.importFromGit(project.id, data.gitRepoUrl, data.branch);

    logger.info('Project import initiated', { projectId: project.id, userId, traceId });

    reply.code(202).send({
      success: true,
      data: {
        id: project.id,
        status: 'importing',
        message: 'Project import started. Check status via GET /api/v1/projects/:id',
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to import project', { error, userId, traceId });
    throw error;
  }
}
