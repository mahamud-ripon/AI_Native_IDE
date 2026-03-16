import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

// Permission service for tenant isolation (CRITICAL for SOC2 compliance)
// User A must NEVER see User B's private code
export const PermissionService = {
  // Check if user has access to a project
  async checkAccess(
    userId: string,
    projectId: string,
    requiredRole: 'owner' | 'editor' | 'viewer' = 'viewer'
  ): Promise<boolean> {
    try {
      // Check if user is the owner
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true, visibility: true },
      });

      if (!project) {
        return false;
      }

      // Owner has full access
      if (project.ownerId === userId) {
        return true;
      }

      // Public projects can be viewed by anyone
      if (project.visibility === 'public' && requiredRole === 'viewer') {
        return true;
      }

      // Check collaborator role
      const collaborator = await prisma.projectCollaborator.findFirst({
        where: { projectId, userId },
      });

      if (!collaborator) {
        return false;
      }

      // Role hierarchy: viewer < editor < owner
      const roleHierarchy = { viewer: 0, editor: 1, owner: 2 };
      return roleHierarchy[collaborator.role] >= roleHierarchy[requiredRole];
    } catch (error) {
      logger.error({ error, userId, projectId }, 'Permission check failed');
      return false;
    }
  },

  // Check if user can search within a project
  async canSearchProject(userId: string | undefined, projectId: string): Promise<boolean> {
    if (!userId) {
      // Anonymous users can only search public projects
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { visibility: true },
      });
      return project?.visibility === 'public';
    }

    return this.checkAccess(userId, projectId, 'viewer');
  },

  // Get list of project IDs user can access
  async getAccessibleProjectIds(userId: string): Promise<string[]> {
    const [ownedProjects, collaboratorProjects] = await Promise.all([
      prisma.project.findMany({
        where: { ownerId: userId },
        select: { id: true },
      }),
      prisma.projectCollaborator.findMany({
        where: { userId },
        select: { projectId: true },
      }),
    ]);

    const projectIds = new Set<string>();
    ownedProjects.forEach((p) => projectIds.add(p.id));
    collaboratorProjects.forEach((c) => projectIds.add(c.projectId));

    return Array.from(projectIds);
  },
};

export default PermissionService;
