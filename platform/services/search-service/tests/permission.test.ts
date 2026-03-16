import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before any imports
const mockFindMany = vi.fn();
const mockFindFirst = vi.fn();
const mockFindUnique = vi.fn();

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    project: {
      findUnique: mockFindUnique,
      findMany: mockFindMany,
    },
    projectCollaborator: {
      findFirst: mockFindFirst,
      findMany: mockFindMany,
    },
  },
}));

describe('Permission Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkAccess', () => {
    it('should allow owner full access', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindUnique.mockResolvedValue({
        id: 'project-123',
        ownerId: 'user-456',
        visibility: 'private',
      });

      const hasAccess = await PermissionService.checkAccess('user-456', 'project-123', 'owner');
      expect(hasAccess).toBe(true);
    });

    it('should deny non-owner owner role', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindUnique.mockResolvedValue({
        id: 'project-123',
        ownerId: 'owner-123',
        visibility: 'private',
      });

      mockFindFirst.mockResolvedValue({
        projectId: 'project-123',
        userId: 'collaborator-456',
        role: 'editor',
      });

      const hasAccess = await PermissionService.checkAccess('collaborator-456', 'project-123', 'owner');
      expect(hasAccess).toBe(false);
    });

    it('should allow editor to view and edit', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindUnique.mockResolvedValue({
        id: 'project-123',
        ownerId: 'owner-123',
        visibility: 'private',
      });

      mockFindFirst.mockResolvedValue({
        projectId: 'project-123',
        userId: 'editor-456',
        role: 'editor',
      });

      const canEdit = await PermissionService.checkAccess('editor-456', 'project-123', 'editor');
      const canView = await PermissionService.checkAccess('editor-456', 'project-123', 'viewer');

      expect(canEdit).toBe(true);
      expect(canView).toBe(true);
    });

    it('should deny viewer from editing', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindUnique.mockResolvedValue({
        id: 'project-123',
        ownerId: 'owner-123',
        visibility: 'private',
      });

      mockFindFirst.mockResolvedValue({
        projectId: 'project-123',
        userId: 'viewer-456',
        role: 'viewer',
      });

      const canEdit = await PermissionService.checkAccess('viewer-456', 'project-123', 'editor');
      const canView = await PermissionService.checkAccess('viewer-456', 'project-123', 'viewer');

      expect(canEdit).toBe(false);
      expect(canView).toBe(true);
    });

    it('should deny access to non-existent project', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindUnique.mockResolvedValue(null);

      const hasAccess = await PermissionService.checkAccess('user-456', 'non-existent', 'viewer');
      expect(hasAccess).toBe(false);
    });
  });

  describe('canSearchProject', () => {
    it('should allow anonymous users to search public projects', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindUnique.mockResolvedValue({
        id: 'project-123',
        visibility: 'public',
      });

      const canSearch = await PermissionService.canSearchProject(undefined, 'project-123');
      expect(canSearch).toBe(true);
    });

    it('should deny anonymous users from searching private projects', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindUnique.mockResolvedValue({
        id: 'project-123',
        visibility: 'private',
      });

      const canSearch = await PermissionService.canSearchProject(undefined, 'project-123');
      expect(canSearch).toBe(false);
    });

    it('should allow authenticated users with access', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindUnique.mockResolvedValue({
        id: 'project-123',
        ownerId: 'user-456',
        visibility: 'private',
      });

      const canSearch = await PermissionService.canSearchProject('user-456', 'project-123');
      expect(canSearch).toBe(true);
    });
  });

  describe('getAccessibleProjectIds', () => {
    it('should return owned and collaborated projects', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindMany.mockResolvedValueOnce([
        { id: 'owned-1' },
        { id: 'owned-2' },
      ]);

      mockFindMany.mockResolvedValueOnce([
        { projectId: 'collab-1' },
        { projectId: 'collab-2' },
      ]);

      const projectIds = await PermissionService.getAccessibleProjectIds('user-456');

      expect(projectIds).toHaveLength(4);
      expect(projectIds).toContain('owned-1');
      expect(projectIds).toContain('owned-2');
      expect(projectIds).toContain('collab-1');
      expect(projectIds).toContain('collab-2');
    });

    it('should deduplicate projects', async () => {
      const { PermissionService } = await import('../src/services/permission.service.js');

      mockFindMany.mockResolvedValueOnce([
        { id: 'project-1' },
      ]);

      mockFindMany.mockResolvedValueOnce([
        { projectId: 'project-1' }, // Same as owned
      ]);

      const projectIds = await PermissionService.getAccessibleProjectIds('user-456');

      expect(projectIds).toHaveLength(1);
    });
  });
});
