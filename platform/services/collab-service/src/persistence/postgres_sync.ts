import { prisma } from '../lib/prisma.js';
import { redis, RedisKeys } from '../lib/redis.js';
import { YjsManager } from '../core/yjs_manager.js';
import { config } from '../config.js';

let syncInterval: NodeJS.Timeout | null = null;

export const PostgresSync = {
  /**
   * Start the periodic sync worker
   */
  start(): void {
    if (syncInterval) return;
    
    console.log('[PostgresSync] Starting sync worker');
    
    syncInterval = setInterval(async () => {
      try {
        await PostgresSync.syncAllDocuments();
      } catch (error: any) {
        console.error('[PostgresSync] Error:', error.message);
      }
    }, config.syncInterval);
  },

  /**
   * Stop the sync worker
   */
  stop(): void {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  },

  /**
   * Sync all active documents to PostgreSQL
   */
  async syncAllDocuments(): Promise<number> {
    // Get all documents that need syncing
    const cutoffTime = new Date(Date.now() - config.syncInterval);
    
    const documents = await prisma.collabDocument.findMany({
      where: {
        lastSyncedAt: {
          lt: cutoffTime
        }
      },
      take: 100
    });

    let syncedCount = 0;
    
    for (const doc of documents) {
      try {
        await PostgresSync.syncDocument(doc.fileId);
        syncedCount++;
      } catch (error: any) {
        console.error(`[PostgresSync] Error syncing ${doc.fileId}:`, error.message);
      }
    }

    if (syncedCount > 0) {
      console.log(`[PostgresSync] Synced ${syncedCount} documents`);
    }
    
    return syncedCount;
  },

  /**
   * Sync a single document to PostgreSQL
   */
  async syncDocument(fileId: string): Promise<void> {
    // Get text from Yjs
    const text = await YjsManager.flushToPostgres(fileId);
    
    // Update project file - convert string to Buffer
    await prisma.projectFile.update({
      where: { id: fileId },
      data: { 
        inlineContent: Buffer.from(text, 'utf-8'),
        lastEditedAt: new Date()
      }
    });

    // Update collab document sync time
    await prisma.collabDocument.update({
      where: { fileId },
      data: { lastSyncedAt: new Date() }
    });
  },

  /**
   * Sync when last user leaves a file
   */
  async syncOnDisconnect(fileId: string, userId: string): Promise<void> {
    // Check if any other users are still in the file
    const activeUsers = await PostgresSync.getActiveUserCount(fileId);
    
    if (activeUsers === 0) {
      console.log(`[PostgresSync] Last user left, syncing ${fileId}`);
      await PostgresSync.syncDocument(fileId);
      await YjsManager.unloadDoc(fileId);
    }
  },

  /**
   * Get active user count for a file
   */
  async getActiveUserCount(fileId: string): Promise<number> {
    const count = await redis.scard(RedisKeys.fileUsers(fileId));
    return count;
  },

  /**
   * Force sync all cached documents (on shutdown)
   */
  async syncAllCached(): Promise<void> {
    const fileIds = YjsManager.getCachedFileIds();
    
    for (const fileId of fileIds) {
      try {
        await PostgresSync.syncDocument(fileId);
      } catch (error: any) {
        console.error(`[PostgresSync] Error syncing ${fileId}:`, error.message);
      }
    }
    
    console.log(`[PostgresSync] Synced ${fileIds.length} cached documents`);
  }
};
