import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { ProjectRole } from '@prisma/client';

const logger = createLogger('permission-service');

export type RequiredRole = 'viewer' | 'editor' | 'owner';

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

class PermissionService {
  /**
   * Check if user has required access to project
   * Returns true if user has role >= requiredRole
   */
  async checkAccess(
    userId: string,
    projectId: string,
    requiredRole: RequiredRole
  ): Promise<boolean> {
    try {
      // Check if user is project owner
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true, deletedAt: true },
      });

      if (!project) {
        logger.warn('Project not found for permission check', { projectId, userId });
        return false;
      }

      if (project.deletedAt) {
        logger.warn('Cannot access deleted project', { projectId, userId });
        return false;
      }

      // Owner has full access
      if (project.ownerId === userId) {
        return true;
      }

      // Check collaborator role
      const collaborator = await prisma.projectCollaborator.findUnique({
        where: {
          projectId_userId: { projectId, userId },
        },
        select: { role: true },
      });

      if (!collaborator) {
        logger.debug('User is not a collaborator', { projectId, userId });
        return false;
      }

      const userRoleLevel = ROLE_HIERARCHY[collaborator.role];
      const requiredRoleLevel = ROLE_HIERARCHY[requiredRole as ProjectRole];

      const hasAccess = userRoleLevel >= requiredRoleLevel;

      logger.debug('Permission check result', {
        projectId,
        userId,
        userRole: collaborator.role,
        requiredRole,
        hasAccess,
      });

      return hasAccess;
    } catch (error) {
      logger.error('Permission check failed', { projectId, userId, error });
      return false;
    }
  }

  /**
   * Get user's role in project
   * Returns null if user has no access
   */
  async getUserRole(userId: string, projectId: string): Promise<ProjectRole | null> {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true },
      });

      if (!project) {
        return null;
      }

      if (project.ownerId === userId) {
        return 'owner';
      }

      const collaborator = await prisma.projectCollaborator.findUnique({
        where: {
          projectId_userId: { projectId, userId },
        },
        select: { role: true },
      });

      return collaborator?.role || null;
    } catch (error) {
      logger.error('Failed to get user role', { projectId, userId, error });
      return null;
    }
  }

  /**
   * Check if user can modify project (owner or editor)
   */
  async canModify(userId: string, projectId: string): Promise<boolean> {
    return this.checkAccess(userId, projectId, 'editor');
  }

  /**
   * Check if user can delete project (owner only)
   */
  async canDelete(userId: string, projectId: string): Promise<boolean> {
    return this.checkAccess(userId, projectId, 'owner');
  }

  /**
   * Check if user can manage secrets (owner only)
   */
  async canManageSecrets(userId: string, projectId: string): Promise<boolean> {
    return this.checkAccess(userId, projectId, 'owner');
  }

  /**
   * Check if user can invite collaborators (owner or editor)
   */
  async canInviteCollaborators(userId: string, projectId: string): Promise<boolean> {
    return this.checkAccess(userId, projectId, 'editor');
  }

  /**
   * Get all projects user has access to
   */
  async getUserProjectIds(userId: string): Promise<string[]> {
    try {
      const [ownedProjects, collaboratedProjects] = await Promise.all([
        prisma.project.findMany({
          where: { ownerId: userId, deletedAt: null },
          select: { id: true },
        }),
        prisma.projectCollaborator.findMany({
          where: { userId },
          include: {
            project: {
              select: { id: true, deletedAt: true },
            },
          },
        }),
      ]);

      const ownedIds = ownedProjects.map((p: { id: string }) => p.id);
      const collaboratedIds = collaboratedProjects
        .filter((c: { project: { deletedAt: Date | null; id: string } }) => !c.project.deletedAt)
        .map((c: { project: { deletedAt: Date | null; id: string } }) => c.project.id);

      return [...new Set([...ownedIds, ...collaboratedIds])];
    } catch (error) {
      logger.error('Failed to get user project IDs', { userId, error });
      return [];
    }
  }
}

export const permissionService = new PermissionService();
export default permissionService;
