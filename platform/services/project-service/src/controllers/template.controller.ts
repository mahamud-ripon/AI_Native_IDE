import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { ListTemplatesQuerySchema, CreateTemplateSchema } from '../dto';
import { NotFoundError, ForbiddenError } from '../middleware';

const logger = createLogger('template-controller');

interface AuthenticatedRequest extends FastifyRequest {
  user: { sub: string; email: string; username: string; iat?: number; exp?: number };
}

/**
 * List templates
 * GET /api/v1/templates
 */
export async function listTemplates(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const traceId = request.id;

  try {
    const query = ListTemplatesQuerySchema.parse(request.query);
    const { category, language, framework, limit } = query;

    const templates = await prisma.projectTemplate.findMany({
      where: {
        isPublic: true,
        ...(category && { category }),
        ...(language && { language }),
        ...(framework && { framework }),
      },
      take: limit,
      orderBy: { useCount: 'desc' },
    });

    reply.send({
      success: true,
      data: { templates },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to list templates', { error, traceId });
    throw error;
  }
}

/**
 * Get template by slug
 * GET /api/v1/templates/:slug
 */
export async function getTemplate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { slug } = request.params as { slug: string };
  const traceId = request.id;

  try {
    const template = await prisma.projectTemplate.findUnique({
      where: { slug },
    });

    if (!template || (!template.isPublic && template.createdById)) {
      throw new NotFoundError('Template');
    }

    reply.send({
      success: true,
      data: template,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to get template', { error, slug, traceId });
    throw error;
  }
}

/**
 * Create template (authenticated)
 * POST /api/v1/templates
 */
export async function createTemplate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const traceId = request.id;

  try {
    const data = CreateTemplateSchema.parse(request.body);

    // Check if slug already exists
    const existingTemplate = await prisma.projectTemplate.findUnique({
      where: { slug: data.slug },
    });

    if (existingTemplate) {
      return reply.code(400).send({
        success: false,
        error: 'Template slug already exists',
        traceId,
      });
    }

    const template = await prisma.projectTemplate.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        category: data.category,
        language: data.language,
        framework: data.framework,
        fileStructureJson: JSON.parse(JSON.stringify(data.fileStructureJson ?? {})),
        isPublic: data.isPublic,
        createdById: userId,
      },
    });

    logger.info('Template created', { templateId: template.id, userId, traceId });

    reply.code(201).send({
      success: true,
      data: template,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to create template', { error, userId, traceId });
    throw error;
  }
}

/**
 * Increment template usage count
 * POST /api/v1/templates/:slug/use
 */
export async function useTemplate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { slug } = request.params as { slug: string };
  const traceId = request.id;

  try {
    const template = await prisma.projectTemplate.update({
      where: { slug },
      data: {
        useCount: { increment: 1 },
      },
    });

    if (!template) {
      throw new NotFoundError('Template');
    }

    reply.send({
      success: true,
      data: { useCount: template.useCount },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to use template', { error, slug, traceId });
    throw error;
  }
}
