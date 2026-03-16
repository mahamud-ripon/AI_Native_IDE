import { FastifyRequest, FastifyReply } from 'fastify';
import { S3Service } from '../services/s3.service';
import { OrphanCleaner } from '../services/orphan-cleaner.service';
import { PermissionService } from '../services/permission.service';
import { config } from '../config/index';
import { logger } from '../lib/logger';
import { z } from 'zod';

// Validation schemas
const DeleteObjectsSchema = z.object({
  bucket: z.enum(['user-files', 'snapshots', 'build-logs', 'artifacts', 'avatars']),
  keys: z.array(z.string().min(1).max(1024)).min(1).max(100),
});

const CleanupSchema = z.object({
  dry_run: z.boolean().optional().default(false),
});

export const AdminController = {
  /**
   * DELETE /api/v1/storage/objects
   * Delete multiple objects from S3
   */
  async deleteObjects(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const data = DeleteObjectsSchema.parse(request.body);
      const userId = request.user?.id;

      if (!userId) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
        return;
      }

      // Validate access for each key
      const projectIds = new Set<string>();
      for (const key of data.keys) {
        const pathParts = key.split('/');
        if (pathParts[0] === 'projects' && pathParts[1]) {
          projectIds.add(pathParts[1]);
        }
      }

      // Check access to all projects
      for (const projectId of projectIds) {
        const hasAccess = await PermissionService.checkAccess(userId, projectId, 'editor');
        if (!hasAccess) {
          reply.status(403).send({
            success: false,
            error: `Access denied to project ${projectId}`,
          });
          return;
        }
      }

      // Get bucket name
      const bucket = S3Service.getBucketName(data.bucket);

      // Delete objects
      const result = await S3Service.deleteObjects(bucket, data.keys);

      logger.info({ userId, bucket, deleted: result.deleted.length, errors: result.errors.length }, 'Objects deleted');

      reply.status(200).send({
        success: true,
        deleted: result.deleted.length,
        errors: result.errors,
      });
    } catch (error: any) {
      logger.error({ error }, 'Delete objects error');

      if (error.name === 'ZodError') {
        reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * GET /api/v1/storage/stats
   * Get storage statistics
   */
  async getStats(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const userId = request.user?.id;

      if (!userId) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
        return;
      }

      const stats = await OrphanCleaner.getStorageStats();

      reply.status(200).send({
        success: true,
        ...stats,
      });
    } catch (error: any) {
      logger.error({ error }, 'Get stats error');

      reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * POST /api/v1/storage/cleanup
   * Run orphan cleanup
   */
  async runCleanup(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const userId = request.user?.id;

      if (!userId) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
        return;
      }

      // Only allow internal service or admin
      if (request.user?.role !== 'service' && request.user?.role !== 'admin') {
        reply.status(403).send({
          success: false,
          error: 'Forbidden: Admin access required',
        });
        return;
      }

      const result = await OrphanCleaner.cleanup();

      logger.info({ userId, ...result }, 'Cleanup completed');

      reply.status(200).send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      logger.error({ error }, 'Cleanup error');

      reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * GET /api/v1/storage/health
   * Health check for storage service
   */
  async healthCheck(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      // Check S3 connectivity
      let s3Healthy = false;
      try {
        await S3Service.listKeys(config.s3.buckets.userFiles, '');
        s3Healthy = true;
      } catch {
        s3Healthy = false;
      }

      reply.status(200).send({
        status: s3Healthy ? 'healthy' : 'degraded',
        service: 'storage-service',
        s3: s3Healthy ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error({ error }, 'Health check error');

      reply.status(500).send({
        status: 'unhealthy',
        service: 'storage-service',
        error: error.message,
      });
    }
  },
};

export default AdminController;
