import { FastifyRequest, FastifyReply } from 'fastify';
import { PresignedUrlService } from '../services/presigned-url.service';
import { logger } from '../lib/logger';
import { z } from 'zod';

// Validation schemas
const PresignUploadSchema = z.object({
  bucket: z.enum(['user-files', 'snapshots', 'build-logs', 'artifacts', 'avatars']),
  key: z.string().min(1).max(1024),
  content_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
});

const PresignDownloadSchema = z.object({
  bucket: z.enum(['user-files', 'snapshots', 'build-logs', 'artifacts', 'avatars']),
  key: z.string().min(1).max(1024),
});

const AvatarUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.enum(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']),
  size_bytes: z.number().int().positive().max(5 * 1024 * 1024), // 5MB max
});

export const UploadController = {
  /**
   * POST /api/v1/storage/presign/upload
   * Generate a pre-signed URL for uploading a file
   */
  async getPresignedUploadUrl(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const data = PresignUploadSchema.parse(request.body);
      const userId = request.user?.id;

      if (!userId) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
        return;
      }

      const result = await PresignedUrlService.generateUploadUrl(
        userId,
        data.bucket,
        data.key,
        data.content_type,
        data.size_bytes
      );

      reply.status(200).send({
        success: true,
        url: result.url,
        key: result.key,
        expires_in: result.expiresIn,
      });
    } catch (error: any) {
      logger.error({ error }, 'Upload presign error');

      if (error.name === 'ZodError') {
        reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      if (error.message.includes('Access denied')) {
        reply.status(403).send({
          success: false,
          error: error.message,
        });
        return;
      }

      reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * POST /api/v1/storage/presign/avatar
   * Generate a pre-signed URL for avatar upload
   */
  async getPresignedAvatarUrl(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const data = AvatarUploadSchema.parse(request.body);
      const userId = request.user?.id;

      if (!userId) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
        return;
      }

      const result = await PresignedUrlService.generateAvatarUploadUrl(
        userId,
        data.filename,
        data.content_type,
        data.size_bytes
      );

      reply.status(200).send({
        success: true,
        url: result.url,
        key: result.key,
        expires_in: result.expiresIn,
      });
    } catch (error: any) {
      logger.error({ error }, 'Avatar presign error');

      reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  },
};

export default UploadController;
