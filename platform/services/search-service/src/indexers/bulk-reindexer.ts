import { prisma } from '../lib/prisma.js';
import { FileIndexer } from './file-indexer.js';
import { ProjectIndexer } from './project-indexer.js';
import { logger } from '../lib/logger.js';

export const BulkReindexer = {
  // Reindex all projects and their files
  async reindexAll(): Promise<{ projects: number; files: number; errors: number }> {
    logger.info('Starting full reindex...');

    let projects = 0;
    let files = 0;
    let errors = 0;

    try {
      // Get all projects
      const allProjects = await prisma.project.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          name: true,
          description: true,
          template: true,
          ownerId: true,
          visibility: true,
          language: true,
          framework: true,
          lastOpenedAt: true,
          createdAt: true,
        },
      });

      // Index each project
      for (const project of allProjects) {
        try {
          await ProjectIndexer.indexProject(project);
          projects++;

          // Reindex files for this project
          const result = await FileIndexer.bulkReindex(project.id);
          files += result.indexed;
          errors += result.errors;
        } catch (error) {
          logger.error({ error, projectId: project.id }, 'Failed to reindex project');
          errors++;
        }
      }

      logger.info({ projects, files, errors }, 'Full reindex completed');
      return { projects, files, errors };
    } catch (error) {
      logger.error({ error }, 'Full reindex failed');
      throw error;
    }
  },

  // Reindex a specific project
  async reindexProject(projectId: string): Promise<{ files: number; errors: number }> {
    logger.info({ projectId }, 'Starting project reindex...');

    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          name: true,
          description: true,
          template: true,
          ownerId: true,
          visibility: true,
          language: true,
          framework: true,
          lastOpenedAt: true,
          createdAt: true,
        },
      });

      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      await ProjectIndexer.indexProject(project);
      const result = await FileIndexer.bulkReindex(projectId);

      logger.info({ projectId, files: result.indexed }, 'Project reindex completed');
      return { files: result.indexed, errors: result.errors };
    } catch (error) {
      logger.error({ error, projectId }, 'Project reindex failed');
      throw error;
    }
  },
};

export default BulkReindexer;
