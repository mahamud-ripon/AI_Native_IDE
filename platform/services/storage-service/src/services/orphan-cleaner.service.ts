import { S3Service } from './s3.service';
import { prisma } from '../lib/prisma';
import { config } from '../config/index';
import { logger } from '../lib/logger';

const SAFETY_MARGIN_HOURS = config.storage.orphanCleanupSafetyHours;

export interface CleanupResult {
  deleted: number;
  errors: string[];
  scannedKeys: number;
  orphanKeys: number;
}

export interface StorageStats {
  totalGb: number;
  buckets: Record<string, { count: number; sizeBytes: number }>;
  orphanCount: number;
  lastCleanupAt?: Date;
}

/**
 * Orphan Cleaner Service
 * 
 * Finds and deletes S3 objects that are no longer referenced in the database.
 * This handles the case where files are updated (new S3 key) but the old
 * S3 object cleanup fails, leaving orphaned objects.
 */
export const OrphanCleaner = {
  /**
   * Run the orphan cleanup process
   */
  async cleanup(): Promise<CleanupResult> {
    logger.info('Starting orphan cleanup...');

    const errors: string[] = [];
    let deleted = 0;
    let scannedKeys = 0;
    let orphanKeys = 0;

    try {
      // Get all S3 keys in user-files bucket
      const s3Keys = await S3Service.listKeys(config.s3.buckets.userFiles, 'projects/');
      scannedKeys = s3Keys.length;

      logger.info({ count: scannedKeys }, 'Found S3 objects to check');

      if (s3Keys.length === 0) {
        return { deleted: 0, errors: [], scannedKeys: 0, orphanKeys: 0 };
      }

      // Get all valid s3_keys from database
      const dbFiles = await prisma.projectFile.findMany({
        where: { s3Key: { not: null } },
        select: { s3Key: true },
      });

      const validKeys = new Set(dbFiles.map((f) => f.s3Key).filter(Boolean) as string[]);

      // Also check file_versions table
      const fileVersions = await prisma.fileVersion.findMany({
        where: { s3Key: { not: null } },
        select: { s3Key: true },
      });

      fileVersions.forEach((fv) => {
        if (fv.s3Key) validKeys.add(fv.s3Key);
      });

      logger.info({ validKeysCount: validKeys.size }, 'Found valid DB keys');

      // Calculate cutoff time (safety margin)
      const cutoffTime = new Date(Date.now() - SAFETY_MARGIN_HOURS * 60 * 60 * 1000);

      // Find orphans (keys in S3 but not in DB)
      const orphans: string[] = [];

      for (const key of s3Keys) {
        if (!validKeys.has(key)) {
          orphans.push(key);
        }
      }

      orphanKeys = orphans.length;
      logger.info({ orphanCount: orphanKeys }, 'Found orphaned objects');

      // Delete orphans (with safety margin)
      for (const key of orphans) {
        try {
          // Check object creation time against safety margin
          try {
            const meta = await S3Service.getMetadata(config.s3.buckets.userFiles, key);
            const lastModified = meta.lastModified;
            if (lastModified && lastModified > cutoffTime) {
              logger.debug({ key, lastModified }, 'Skipping orphan - within safety margin');
              continue;
            }
          } catch {
            // If we can't get metadata, skip this key for safety
            logger.warn({ key }, 'Could not get metadata for orphan, skipping');
            continue;
          }

          await S3Service.delete(config.s3.buckets.userFiles, key);
          deleted++;
          logger.debug({ key }, 'Deleted orphaned object');
        } catch (error: any) {
          errors.push(`Failed to delete ${key}: ${error.message}`);
        }
      }

      // Log cleanup result to audit log
      await prisma.auditLog.create({
        data: {
          action: 'storage.orphan_cleanup',
          metadata: {
            scannedKeys,
            orphanKeys,
            deleted,
            errors: errors.length,
          },
        },
      });

      logger.info({ deleted, errors: errors.length }, 'Orphan cleanup completed');

      return { deleted, errors, scannedKeys, orphanKeys };
    } catch (error: any) {
      logger.error({ error }, 'Orphan cleanup failed');
      errors.push(`Cleanup failed: ${error.message}`);
      return { deleted, errors, scannedKeys, orphanKeys };
    }
  },

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    const buckets: Record<string, { count: number; sizeBytes: number }> = {};
    let totalBytes = 0;

    const bucketNames = Object.values(config.s3.buckets);

    for (const bucket of bucketNames) {
      try {
        const keys = await S3Service.listKeys(bucket, '');
        let bucketSize = 0;

        // Get size for each object (limited to prevent timeout)
        const sampleSize = Math.min(keys.length, 100);
        for (let i = 0; i < sampleSize; i++) {
          try {
            const meta = await S3Service.getMetadata(bucket, keys[i]);
            bucketSize += meta.size;
          } catch {
            // Skip if can't get metadata
          }
        }

        // Extrapolate total size
        const avgSize = sampleSize > 0 ? bucketSize / sampleSize : 0;
        const estimatedTotal = keys.length * avgSize;

        buckets[bucket] = {
          count: keys.length,
          sizeBytes: estimatedTotal,
        };

        totalBytes += estimatedTotal;
      } catch (error) {
        logger.warn({ bucket, error }, 'Failed to get bucket stats');
        buckets[bucket] = { count: 0, sizeBytes: 0 };
      }
    }

    // Estimate orphan count
    let orphanCount = 0;
    try {
      const s3Keys = await S3Service.listKeys(config.s3.buckets.userFiles, 'projects/');
      const dbFiles = await prisma.projectFile.findMany({
        where: { s3Key: { not: null } },
        select: { s3Key: true },
      });
      const validKeys = new Set(dbFiles.map((f) => f.s3Key).filter(Boolean) as string[]);

      // Also include fileVersion table keys
      const fileVersions = await prisma.fileVersion.findMany({
        where: { s3Key: { not: null } },
        select: { s3Key: true },
      });
      fileVersions.forEach((fv) => {
        if (fv.s3Key) validKeys.add(fv.s3Key);
      });

      orphanCount = s3Keys.filter((k) => !validKeys.has(k)).length;
    } catch (error) {
      logger.warn({ error }, 'Failed to count orphans');
    }

    return {
      totalGb: totalBytes / (1024 * 1024 * 1024),
      buckets,
      orphanCount,
    };
  },

  /**
   * Clean up all files for a deleted project
   */
  async cleanupProjectFiles(projectId: string): Promise<{ deleted: number; errors: string[] }> {
    logger.info({ projectId }, 'Cleaning up project files');

    const errors: string[] = [];
    let deleted = 0;

    try {
      // Get all files for this project
      const files = await prisma.projectFile.findMany({
        where: { projectId, s3Key: { not: null } },
        select: { s3Key: true },
      });

      // Also get file versions
      const fileIds = await prisma.projectFile.findMany({
        where: { projectId },
        select: { id: true },
      });

      const versions = await prisma.fileVersion.findMany({
        where: {
          fileId: { in: fileIds.map((f) => f.id) },
          s3Key: { not: null },
        },
        select: { s3Key: true },
      });

      // Combine all keys
      const allKeys = [
        ...files.map((f) => f.s3Key),
        ...versions.map((v) => v.s3Key),
      ].filter(Boolean) as string[];

      // Delete from S3
      for (const key of allKeys) {
        try {
          await S3Service.delete(config.s3.buckets.userFiles, key);
          deleted++;
        } catch (error: any) {
          errors.push(`Failed to delete ${key}: ${error.message}`);
        }
      }

      logger.info({ projectId, deleted, errors: errors.length }, 'Project files cleaned up');

      return { deleted, errors };
    } catch (error: any) {
      logger.error({ error, projectId }, 'Failed to cleanup project files');
      errors.push(`Cleanup failed: ${error.message}`);
      return { deleted, errors };
    }
  },
};

export default OrphanCleaner;
