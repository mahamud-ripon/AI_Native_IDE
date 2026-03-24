import { prisma } from '@workspace/database';
import { redisClient } from '../lib/redis.js';

const logger = {
  info: (msg: string) => console.log(`[Embedding Processor] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[Embedding Processor] ${msg}`, err),
  warn: (msg: string) => console.warn(`[Embedding Processor] ${msg}`),
};

const SEARCH_SERVICE_URL = process.env.SEARCH_SERVICE_URL || 'http://localhost:8008';
const BATCH_SIZE = 50; // OOM-safe batch processing

interface EmbeddingTask {
  fileId: string;
  projectId: string;
  path?: string;
}

export async function updateFileEmbedding(data: EmbeddingTask): Promise<void> {
  const { fileId, projectId } = data;

  logger.info(`Updating embedding for file ${fileId}`);

  try {
    // Get file content
    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
      select: { inlineContent: true, path: true, language: true },
    });

    if (!file?.inlineContent) {
      logger.warn(`File ${fileId} has no content, skipping embedding`);
      return;
    }

    const content = file.inlineContent.toString('utf-8');

    // Call search service to generate embedding
    const response = await fetch(`${SEARCH_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': process.env.INTERNAL_API_KEY || '',
      },
      body: JSON.stringify({
        fileId,
        projectId,
        content,
        path: file.path,
        language: file.language,
      }),
    });

    if (!response.ok) {
      throw new Error(`Search service returned ${response.status}`);
    }

    // Mark file as embedded
    await redisClient.set(`embedding:file:${fileId}`, Date.now().toString());

    logger.info(`Embedding updated for file ${fileId}`);

  } catch (error: any) {
    logger.error(`Failed to update embedding for ${fileId}:`, error.message);
    throw error;
  }
}

export async function fullProjectReindex(data: { projectId: string }): Promise<void> {
  const { projectId } = data;

  logger.info(`Starting full reindex for project ${projectId}`);

  try {
    // Get checkpoint from Redis for resumable reindexing (stores last file ID)
    const checkpointKey = `embedding:reindex:${projectId}`;
    const checkpoint = await redisClient.get(checkpointKey);
    let lastFileId = checkpoint || '';
    let processed = 0;
    let hasMore = true;

    while (hasMore) {
      // Fetch batch of files using cursor-based pagination (avoids N² offset issue)
      const files = await prisma.projectFile.findMany({
        where: { 
          projectId,
          deletedAt: null, // ❌ Critical: Exclude soft-deleted files
          isDirectory: false, // Only process actual files, not directories
          ...(lastFileId ? { id: { gt: lastFileId } } : {}), // Cursor-based: get files after lastFileId
        },
        select: { id: true, inlineContent: true, path: true, language: true },
        take: BATCH_SIZE,
        orderBy: { id: 'asc' }, // Consistent ordering for cursor pagination
      });

      if (files.length === 0) {
        hasMore = false;
        break;
      }

      // Process batch
      for (const file of files) {
        if (file.inlineContent) {
          try {
            await updateFileEmbedding({
              fileId: file.id,
              projectId,
              path: file.path,
            });
            processed++;
          } catch (error: any) {
            logger.error(`Failed to embed file ${file.id}:`, error.message);
          }
        }
        lastFileId = file.id; // Update cursor to current file ID
      }

      // Update checkpoint with last processed file ID
      await redisClient.set(checkpointKey, lastFileId);

      logger.info(`Reindex progress: ${processed} files processed, last ID: ${lastFileId}`);

      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Clear checkpoint on completion
    await redisClient.del(checkpointKey);

    logger.info(`Full reindex completed for project ${projectId}: ${processed} files`);

  } catch (error: any) {
    logger.error(`Full reindex failed for ${projectId}:`, error.message);
    throw error;
  }
}

export async function removeFileEmbedding(data: { fileId: string; projectId: string }): Promise<void> {
  const { fileId, projectId } = data;

  logger.info(`Removing embedding for file ${fileId}`);

  try {
    // Call search service to remove embedding
    const response = await fetch(`${SEARCH_SERVICE_URL}/embed/${fileId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': process.env.INTERNAL_API_KEY || '',
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Search service returned ${response.status}`);
    }

    // Remove from Redis tracking
    await redisClient.del(`embedding:file:${fileId}`);

    logger.info(`Embedding removed for file ${fileId}`);

  } catch (error: any) {
    logger.error(`Failed to remove embedding for ${fileId}:`, error.message);
    throw error;
  }
}
