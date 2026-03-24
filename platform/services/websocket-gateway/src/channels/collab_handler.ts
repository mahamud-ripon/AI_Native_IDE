import { publish } from '../lib/redis';

const MAX_UPDATE_SIZE = 5 * 1024 * 1024; // 5MB max Yjs update

function sanitizeId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

export const CollabHandler = {
  async handleYjsUpdate(connId: string, projectId: string, fileId: string, update: Buffer): Promise<void> {
    if (!sanitizeId(projectId)) throw new Error('Invalid projectId');
    if (!sanitizeId(fileId)) throw new Error('Invalid fileId');
    if (!Buffer.isBuffer(update) || update.length > MAX_UPDATE_SIZE) {
      throw new Error('Update exceeds maximum size');
    }

    await publish(`collab:${projectId}:${fileId}`, {
      type: 'update',
      connId,
      update: update.toString('base64'),
    });
  },

  async handleAwarenessUpdate(connId: string, projectId: string, fileId: string, awareness: unknown): Promise<void> {
    if (!sanitizeId(projectId)) throw new Error('Invalid projectId');
    if (!sanitizeId(fileId)) throw new Error('Invalid fileId');

    await publish(`awareness:${projectId}:${fileId}`, {
      type: 'awareness',
      connId,
      awareness,
    });
  },

  async handleSyncRequest(connId: string, projectId: string, fileId: string): Promise<void> {
    if (!sanitizeId(projectId)) throw new Error('Invalid projectId');
    if (!sanitizeId(fileId)) throw new Error('Invalid fileId');

    await publish(`collab:${projectId}:${fileId}`, {
      type: 'sync_request',
      connId,
    });
  },

  async handleCursorMove(connId: string, projectId: string, userId: string, cursor: { fileId: string; line: number; column: number }): Promise<void> {
    if (!sanitizeId(projectId)) throw new Error('Invalid projectId');
    if (!sanitizeId(userId)) throw new Error('Invalid userId');
    if (!cursor || !sanitizeId(cursor.fileId)) throw new Error('Invalid cursor fileId');
    if (!Number.isInteger(cursor.line) || cursor.line < 0) throw new Error('Invalid cursor line');
    if (!Number.isInteger(cursor.column) || cursor.column < 0) throw new Error('Invalid cursor column');

    await publish(`presence:${projectId}`, {
      type: 'cursor',
      userId,
      cursor,
    });
  },
};

export default CollabHandler;
