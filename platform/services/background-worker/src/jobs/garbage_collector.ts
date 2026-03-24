import { prisma } from '@workspace/database';
import { redisClient } from '../lib/redis';

const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[Garbage Collector] ${msg}`, ...args),
  error: (msg: string, err?: any) => console.error(`[Garbage Collector] ${msg}`, err),
  warn: (msg: string, ...args: any[]) => console.warn(`[Garbage Collector] ${msg}`, ...args),
};

interface CleanupResult {
  expiredTokens: number;
  expiredInvitations: number;
  orphanedFiles: number;
  staleSessions: number;
  staleEmbeddings: number;
}

export async function runGarbageCollector(): Promise<void> {
  logger.info('🗑️ Starting garbage collection...');

  const results: CleanupResult = {
    expiredTokens: 0,
    expiredInvitations: 0,
    orphanedFiles: 0,
    staleSessions: 0,
    staleEmbeddings: 0,
  };

  try {
    // 1. Delete expired refresh tokens
    try {
      const tokenResult = await prisma.refreshToken.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
      results.expiredTokens = tokenResult.count;
      logger.info(`🧹 Deleted ${results.expiredTokens} expired refresh tokens`);
    } catch (e: any) {
      logger.error('Failed to cleanup refresh tokens:', e.message);
    }

    // 2. Delete expired invitations
    try {
      const inviteResult = await prisma.invitation.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      }) || { count: 0 };
      results.expiredInvitations = inviteResult.count;
      logger.info(`🧹 Deleted ${results.expiredInvitations} expired invitations`);
    } catch (e: any) {
      // invitations table might not exist
      logger.warn('Invitations table not available:', e.message);
    }

    // 3. Find orphaned project_files (rows with NULL s3_key AND NULL inline_content, but NOT directories)
    try {
      const orphanedResult = await prisma.projectFile.deleteMany({
        where: {
          AND: [
            { s3Key: { equals: null } },
            { inlineContent: { equals: null } },
            { isDirectory: false }, // ❌ Critical: Exclude directories which legitimately have null content
          ],
        },
      }) || { count: 0 };
      results.orphanedFiles = orphanedResult.count;
      logger.info(`🧹 Deleted ${results.orphanedFiles} orphaned file records`);
    } catch (e: any) {
      // project_files table might not exist
      logger.warn('project_files table not available:', e.message);
    }

    // 4. Clean up stale Redis sessions
    try {
      const sessionKeys = await redisClient.keys('session:*');
      let deletedSessions = 0;

      for (const key of sessionKeys) {
        const ttl = await redisClient.ttl(key);
        // If TTL is -1 (no expiry) or key doesn't exist
        if (ttl === -1) {
          // Check if session is older than 30 days by parsing timestamp in key
          const timestamp = key.split(':')[2];
          if (timestamp) {
            const sessionDate = new Date(parseInt(timestamp, 10));
            const daysOld = (Date.now() - sessionDate.getTime()) / (1000 * 60 * 60 * 24);
            
            if (daysOld > 30) {
              await redisClient.del(key);
              deletedSessions++;
            }
          }
        }
      }
      results.staleSessions = deletedSessions;
      logger.info(`🧹 Deleted ${deletedSessions} stale Redis sessions`);
    } catch (e: any) {
      logger.error('Failed to cleanup Redis sessions:', e.message);
    }

    // 5. Clean up orphaned embeddings from pgvector
    try {
      // Get all file IDs that exist in project_files
      const existingFiles = await prisma.projectFile.findMany({
        select: { id: true },
      }) || [];

      const validFileIds = new Set(existingFiles.map((f: any) => f.id));

      // Scan for embedding keys in Redis that reference deleted files
      const embeddingKeys = await redisClient.keys('embedding:*');
      let deletedEmbeddings = 0;

      for (const key of embeddingKeys) {
        const fileId = key.replace('embedding:', '');
        if (!validFileIds.has(fileId)) {
          await redisClient.del(key);
          deletedEmbeddings++;
        }
      }

      results.staleEmbeddings = deletedEmbeddings;
      logger.info(`🧹 Deleted ${deletedEmbeddings} orphaned embeddings`);
    } catch (e: any) {
      logger.warn('Embedding cleanup failed:', e.message);
    }

    // 6. Clean up old audit logs (keep last 90 days)
    try {
      const auditCutoff = new Date();
      auditCutoff.setDate(auditCutoff.getDate() - 90);

      const auditResult = await prisma.auditLog.deleteMany({
        where: {
          createdAt: {
            lt: auditCutoff,
          },
        },
      }) || { count: 0 };
      logger.info(`🧹 Deleted ${auditResult.count} old audit logs (>90 days)`);
    } catch (e: any) {
      logger.warn('Audit log cleanup failed:', e.message);
    }

    // 7. Clean up old DLQ entries (dead letter queue)
    try {
      const dlqKeys = await redisClient.keys('dlq:*');
      let cleanedDlq = 0;

      for (const key of dlqKeys) {
        // Check age of DLQ entries
        const entries = await redisClient.lrange(key, 0, -1);
        const now = Date.now();

        for (let i = entries.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(entries[i]);
            const age = now - (entry.failed_at || 0);
            
            // Remove entries older than 30 days
            if (age > 30 * 24 * 60 * 60 * 1000) {
              await redisClient.lrem(key, 0, entries[i]);
              cleanedDlq++;
            }
          } catch (parseError) {
            // Invalid entry, remove it
            await redisClient.lrem(key, 0, entries[i]);
            cleanedDlq++;
          }
        }
      }
      logger.info(`🧹 Cleaned ${cleanedDlq} old DLQ entries`);
    } catch (e: any) {
      logger.warn('DLQ cleanup failed:', e.message);
    }

    logger.info('✅ Garbage collection complete', results);

  } catch (error: any) {
    logger.error('Garbage collection job failed:', error.message);
    throw error;
  }
}
