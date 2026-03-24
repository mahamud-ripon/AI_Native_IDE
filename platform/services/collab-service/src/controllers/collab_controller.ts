import { FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';
import { YjsManager } from '../core/yjs_manager.js';
import { AwarenessManager } from '../core/awareness_manager.js';
import { PostgresSync } from '../persistence/postgres_sync.js';
import { GatewayHandler } from '../rpc/gateway_handler.js';
import { prisma } from '../lib/prisma.js';

interface JoinBody {
  projectId: string;
  fileId: string;
}

interface LeaveBody {
  fileId: string;
}

interface FileParams {
  file_id: string;
}

interface ListQuery {
  cursor?: string;
  limit?: string;
}

export const CollabController = {
  /**
   * GET /api/v1/collab/files/:file_id
   * Get file state and active users
   */
  getFile: async function(
    request: FastifyRequest<{ Params: FileParams }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { file_id } = request.params;
      const userId = request.user?.id;

      if (!userId) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      // Check access - verify file exists and user has access
      const file = await prisma.projectFile.findUnique({
        where: { id: file_id },
        include: { 
          project: {
            include: {
              collaborators: {
                where: { userId }
              }
            }
          }
        }
      });

      if (!file) {
        reply.code(404).send({ error: 'File not found' });
        return;
      }

      // Check if user is project owner OR a collaborator
      const isOwner = file.project.ownerId === userId;
      const isCollaborator = file.project.collaborators.length > 0;

      if (!isOwner && !isCollaborator) {
        reply.code(403).send({ error: 'Access denied' });
        return;
      }

      // Get Yjs state
      const yjsState = await YjsManager.getYDocState(file_id);
      
      // Get active users
      const activeUsers = AwarenessManager.getFileUsers(file_id);

      reply.send({
        success: true,
        data: {
          fileId: file_id,
          yjsBinaryState: yjsState ? yjsState.toString('base64') : null,
          lastSyncedAt: file.lastEditedAt,
          activeUsers: activeUsers.map(u => u.user)
        }
      });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      reply.code(500).send({ error: error.message });
    }
  },

  /**
   * POST /api/v1/collab/join
   * Join a collaboration session
   */
  joinCollab: async function(
    request: FastifyRequest<{ Body: JoinBody }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { projectId, fileId } = request.body;
      const userId = request.user?.id;

      if (!userId) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      // Verify access
      const collaborator = await prisma.projectCollaborator.findFirst({
        where: {
          projectId,
          userId,
          role: { in: ['owner', 'editor', 'viewer'] }
        }
      });

      if (!collaborator) {
        reply.code(403).send({ error: 'Access denied' });
        return;
      }

      // Record collab document
      await prisma.collabDocument.upsert({
        where: { fileId },
        update: { lastSyncedAt: new Date() },
        create: {
          fileId,
          projectId,
          yjsBinaryState: Buffer.alloc(0),
          lastSyncedAt: new Date()
        }
      });

      // Join via gateway handler
      const { state, awareness } = await GatewayHandler.onUserJoinFile({
        projectId,
        fileId,
        userId,
        user: request.user!
      });

      reply.send({
        success: true,
        data: { 
          sessionId: `${projectId}:${fileId}:${userId}`,
          state: Buffer.from(state).toString('base64'),
          awareness
        }
      });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      reply.code(500).send({ error: error.message });
    }
  },

  /**
   * POST /api/v1/collab/leave
   * Leave a collaboration session
   */
  leaveCollab: async function(
    request: FastifyRequest<{ Body: LeaveBody }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { fileId } = request.body;
      const userId = request.user?.id;

      if (!userId) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      // Sync and cleanup
      await GatewayHandler.onUserLeaveFile({
        fileId,
        userId
      });

      reply.send({ success: true });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      reply.code(500).send({ error: error.message });
    }
  },

  /**
   * GET /api/v1/collab/documents
   * List collaboration documents with cursor pagination
   */
  listDocuments: async function(
    request: FastifyRequest<{ Querystring: ListQuery }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const userId = request.user?.id;

      if (!userId) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      const { cursor, limit = '20' } = request.query;
      const limitNum = parseInt(limit, 10);

      // Get user's projects
      const projects = await prisma.projectCollaborator.findMany({
        where: { userId },
        select: { projectId: true }
      });

      const projectIds = projects.map((p: { projectId: string }) => p.projectId);

      const documents = await prisma.collabDocument.findMany({
        where: {
          projectId: { in: projectIds }
        },
        take: limitNum + 1,
        cursor: cursor ? { fileId: cursor } : undefined,
        orderBy: { lastSyncedAt: 'desc' },
        include: {
          project: { select: { id: true, name: true } }
        }
      });

      let nextCursor: string | undefined;
      if (documents.length > limitNum) {
        const next = documents.pop();
        nextCursor = next?.fileId;
      }

      reply.send({
        success: true,
        data: documents.map((d: any) => ({
          fileId: d.fileId,
          projectId: d.projectId,
          projectName: d.project.name,
          lastSyncedAt: d.lastSyncedAt
        })),
        nextCursor
      });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      reply.code(500).send({ error: error.message });
    }
  },

  /**
   * GET /api/v1/collab/presence/:file_id
   * Get presence info for a file
   */
  getPresence: async function(
    request: FastifyRequest<{ Params: FileParams }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { file_id } = request.params;

      const activeUsers = AwarenessManager.getFileUsers(file_id);

      reply.send({
        success: true,
        data: activeUsers
      });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      reply.code(500).send({ error: error.message });
    }
  },

  /**
   * GET /api/v1/collab/stats
   * Get service stats (internal)
   */
  getStats: async function(
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    reply.send({
      success: true,
      data: {
        activeDocs: YjsManager.getActiveDocCount(),
        activeAwareness: AwarenessManager.getActiveAwarenessCount(),
        cachedFiles: YjsManager.getCachedFileIds().length
      }
    });
  }
};
