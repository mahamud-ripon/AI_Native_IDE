import { esClient, IndexManager } from '../services/elasticsearch.service.js';
import { logger } from '../lib/logger.js';

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  template: string | null;
  ownerId: string;
  visibility: string;
  language: string | null;
  framework: string | null;
  lastOpenedAt: Date | null;
  createdAt: Date;
}

export const ProjectIndexer = {
  // Index a project in the global projects index
  async indexProject(project: ProjectData): Promise<void> {
    try {
      await IndexManager.ensureProjectIndex();

      await esClient.index({
        index: 'projects_global',
        id: project.id,
        document: {
          projectId: project.id,
          name: project.name,
          description: project.description,
          template: project.template,
          ownerId: project.ownerId,
          visibility: project.visibility,
          language: project.language,
          framework: project.framework,
          forkCount: 0,
          starCount: 0,
          lastOpenedAt: project.lastOpenedAt?.toISOString(),
          createdAt: project.createdAt.toISOString(),
        },
      });

      logger.info({ projectId: project.id, name: project.name }, 'Project indexed');
    } catch (error) {
      logger.error({ error, projectId: project.id }, 'Failed to index project');
      throw error;
    }
  },

  // Update project metadata in index
  async updateProject(projectId: string, updates: Partial<ProjectData>): Promise<void> {
    try {
      await esClient.update({
        index: 'projects_global',
        id: projectId,
        doc: {
          ...updates,
          lastOpenedAt: updates.lastOpenedAt?.toISOString(),
        },
      });

      logger.info({ projectId }, 'Project updated in index');
    } catch (error: any) {
      if (error.meta?.statusCode === 404) {
        // Project not in index, create it
        logger.warn({ projectId }, 'Project not found in index, skipping update');
        return;
      }
      throw error;
    }
  },

  // Delete a project from the global index and its code index
  async deleteProject(projectId: string): Promise<void> {
    try {
      await esClient.delete({
        index: 'projects_global',
        id: projectId,
      });

      logger.info({ projectId }, 'Project deleted from global index');
    } catch (error: any) {
      if (error.meta?.statusCode !== 404) {
        logger.error({ error, projectId }, 'Failed to delete project from index');
      }
    }

    // Also delete the code index
    await IndexManager.deleteCodeIndex(projectId);
  },
};

export default ProjectIndexer;
