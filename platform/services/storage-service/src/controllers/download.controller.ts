import { FastifyRequest, FastifyReply } from 'fastify';
import { PresignedUrlService } from '../services/presigned-url.service';
import { logger } from '../lib/logger';
import { z } from 'zod';

// Validation schema
const PresignDownloadSchema = z.object({
  bucket: z.enum(['user-files', 'snapshots', 'build-logs', 'artifacts', 'avatars']),
  key: z.string().min(1).max(1024),
});

export const DownloadController = {
  /**
   * POST /api/v1/storage/presign/download
   * Generate a pre-signed URL for downloading a file
   */
  async getPresignedDownloadUrl(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const data = PresignDownloadSchema.parse(request.body);
      const userId = request.user?.id;

      if (!userId) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
        return;
      }

      const result = await PresignedUrlService.generateDownloadUrl(
        userId,
        data.bucket,
        data.key
      );

      reply.status(200).send({
        success: true,
        url: result.url,
        expires_in: result.expiresIn,
      });
    } catch (error: any) {
      logger.error({ error }, 'Download presign error');

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

      if (error.message.includes('not found')) {
        reply.status(404).send({
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
   * GET /api/v1/storage/download/:key
   * Direct download (redirects to pre-signed URL)
   */
  async downloadFile(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { key } = request.params as { key: string };
      const { bucket = 'user-files' } = request.query as { bucket?: string };
      const userId = request.user?.id;

      if (!userId) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
        return;
      }

      // Decode the key (it may be URL-encoded)
      const decodedKey = decodeURIComponent(key);

      const result = await PresignedUrlService.generateDownloadUrl(
        userId,
        bucket,
        decodedKey
      );

      // Redirect to the pre-signed URL
      reply.redirect(result.url);
    } catch (error: any) {
      logger.error({ error }, 'Download error');

      if (error.message.includes('Access denied')) {
        reply.status(403).send({
          success: false,
          error: error.message,
        });
        return;
      }

      if (error.message.includes('not found')) {
        reply.status(404).send({
          success: false,
          error: 'File not found',
        });
        return;
      }

      reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  },
};

export default DownloadController;
