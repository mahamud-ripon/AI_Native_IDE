import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export const PermissionService = {
  /**
   * Check if user has required access to a project
   */
  async checkAccess(
    userId: string,
    projectId: string,
    requiredRole: ProjectRole
  ): Promise<boolean> {
    try {
      // Get project to check ownership
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true, visibility: true },
      });

      if (!project) {
        logger.warn({ projectId, userId }, 'Project not found for access check');
        return false;
      }

      // Owner has full access
      if (project.ownerId === userId) {
        return true;
      }

      // Check collaborator role
      const collaborator = await prisma.projectCollaborator.findFirst({
        where: {
          projectId,
          userId,
        },
        select: { role: true },
      });

      if (!collaborator) {
        // For public projects, allow viewer access
        if (project.visibility === 'public' && requiredRole === 'viewer') {
          return true;
        }
        return false;
      }

      // Role hierarchy: owner > editor > viewer
      const roleHierarchy: Record<ProjectRole, number> = {
        owner: 3,
        editor: 2,
        viewer: 1,
      };

      const userRoleLevel = roleHierarchy[collaborator.role as ProjectRole] || 0;
      const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

      return userRoleLevel >= requiredRoleLevel;
    } catch (error) {
      logger.error({ error, projectId, userId }, 'Error checking project access');
      return false;
    }
  },

  /**
   * Check if user can upload to a project (editor or owner)
   */
  async canUpload(userId: string, projectId: string): Promise<boolean> {
    return this.checkAccess(userId, projectId, 'editor');
  },

  /**
   * Check if user can download from a project (viewer or higher)
   */
  async canDownload(userId: string, projectId: string): Promise<boolean> {
    return this.checkAccess(userId, projectId, 'viewer');
  },

  /**
   * Check if user can delete from a project (editor or owner)
   */
  async canDelete(userId: string, projectId: string): Promise<boolean> {
    return this.checkAccess(userId, projectId, 'editor');
  },

  /**
   * Get all project IDs the user has access to
   */
  async getAccessibleProjectIds(userId: string): Promise<string[]> {
    // Get owned projects
    const ownedProjects = await prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });

    // Get collaborated projects
    const collaborations = await prisma.projectCollaborator.findMany({
      where: { userId },
      select: { projectId: true },
    });

    // Combine and deduplicate
    const projectIds = new Set([
      ...ownedProjects.map((p) => p.id),
      ...collaborations.map((c) => c.projectId),
    ]);

    return Array.from(projectIds);
  },

  /**
   * Validate that a key belongs to a project the user has access to
   */
  async validateKeyAccess(
    userId: string,
    key: string,
    requiredRole: ProjectRole
  ): Promise<{ valid: boolean; projectId?: string; error?: string }> {
    // Extract project ID from key path (format: projects/{projectId}/files/{fileId})
    const pathParts = key.split('/');
    
    if (pathParts[0] !== 'projects' || !pathParts[1]) {
      return {
        valid: false,
        error: 'Invalid key format',
      };
    }

    const projectId = pathParts[1];
    const hasAccess = await this.checkAccess(userId, projectId, requiredRole);

    if (!hasAccess) {
      return {
        valid: false,
        projectId,
        error: 'Access denied',
      };
    }

    return {
      valid: true,
      projectId,
    };
  },
};

export default PermissionService;
