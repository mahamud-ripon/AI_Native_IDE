import { publish } from '../lib/redis';

export const CollabHandler = {
  async handleYjsUpdate(connId: string, projectId: string, fileId: string, update: Buffer): Promise<void> {
    await publish(`collab:${projectId}:${fileId}`, {
      type: 'update',
      connId,
      update: update.toString('base64'),
    });
  },

  async handleAwarenessUpdate(connId: string, projectId: string, fileId: string, awareness: unknown): Promise<void> {
    await publish(`awareness:${projectId}:${fileId}`, {
      type: 'awareness',
      connId,
      awareness,
    });
  },

  async handleSyncRequest(connId: string, projectId: string, fileId: string): Promise<void> {
    await publish(`collab:${projectId}:${fileId}`, {
      type: 'sync_request',
      connId,
    });
  },

  async handleCursorMove(connId: string, projectId: string, userId: string, cursor: { fileId: string; line: number; column: number }): Promise<void> {
    await publish(`presence:${projectId}`, {
      type: 'cursor',
      userId,
      cursor,
    });
  },
};

export default CollabHandler;
