import { prisma } from '../lib/prisma.js';
import { redis, RedisKeys } from '../lib/redis.js';
import { YjsManager } from '../core/yjs_manager.js';
import { config } from '../config.js';
import { S3Client } from '@aws-sdk/client-s3';

// Initialize S3 client for uploading large files
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

const S3_BUCKET = process.env.S3_FILE_BUCKET || 'ide-files';
const INLINE_THRESHOLD = 64 * 1024; // 64KB threshold for dual-storage strategy
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
   * Applies dual-storage strategy: files >64KB go to S3, small files inline
   */
  async syncDocument(fileId: string): Promise<void> {
    // Get text from Yjs
    const text = await YjsManager.flushToPostgres(fileId);
    const contentBuffer = Buffer.from(text, 'utf-8');
    const fileSize = contentBuffer.length;
    
    // Get current file to check existing storage location
    const currentFile = await prisma.projectFile.findUnique({
      where: { id: fileId },
      select: { s3Key: true, isDirectory: true }
    });
    
    if (currentFile?.isDirectory) {
      // Directories don't have content - just update timestamp
      await prisma.projectFile.update({
        where: { id: fileId },
        data: { lastEditedAt: new Date() }
      });
    } else if (fileSize > INLINE_THRESHOLD) {
      // Large file: upload to S3, store null inlineContent
      const s3Key = `projects/${fileId}/content`;
      
      // Upload to S3
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: contentBuffer,
        ContentType: 'text/plain'
      }));
      
      await prisma.projectFile.update({
        where: { id: fileId },
        data: { 
          s3Key: s3Key,
          inlineContent: null, // Clear inline content for large files
          lastEditedAt: new Date()
        }
      });
      
      console.log(`[PostgresSync] Large file ${fileId} synced to S3 (${fileSize} bytes)`);
    } else {
      // Small file: store inline, clear s3Key
      await prisma.projectFile.update({
        where: { id: fileId },
        data: { 
          inlineContent: contentBuffer,
          s3Key: null, // Clear S3 key when storing inline
          lastEditedAt: new Date()
        }
      });
      
      // If there was an old S3 object, delete it to save storage
      if (currentFile?.s3Key) {
        try {
          const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
          await s3Client.send(new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: currentFile.s3Key
          }));
        } catch (e) {
          // Non-fatal: old S3 object may not exist
          console.warn(`[PostgresSync] Failed to delete old S3 object: ${currentFile.s3Key}`);
        }
      }
    }

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
