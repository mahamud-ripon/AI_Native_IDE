import { esClient, IndexManager } from '../services/elasticsearch.service.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export const FileIndexer = {
  // Index a single file in Elasticsearch
  async indexFile(
    projectId: string,
    fileId: string,
    content: string,
    filePath: string,
    language: string,
    sizeBytes?: number
  ): Promise<void> {
    try {
      await IndexManager.ensureCodeIndex(projectId);

      const indexName = `code_${projectId.replace(/-/g, '_')}`;

      await esClient.index({
        index: indexName,
        id: fileId,
        document: {
          fileId,
          filePath,
          content,
          language,
          projectId,
          sizeBytes: sizeBytes || content.length,
          updatedAt: new Date().toISOString(),
        },
      });

      logger.info({ fileId, projectId, filePath }, 'File indexed');
    } catch (error) {
      logger.error({ error, fileId, projectId }, 'Failed to index file');
      throw error;
    }
  },

  // Delete a file from Elasticsearch index
  async deleteFile(projectId: string, fileId: string): Promise<void> {
    try {
      const indexName = `code_${projectId.replace(/-/g, '_')}`;

      await esClient.delete({
        index: indexName,
        id: fileId,
      });

      logger.info({ fileId, projectId }, 'File deleted from index');
    } catch (error: any) {
      if (error.meta?.statusCode !== 404) {
        logger.error({ error, fileId, projectId }, 'Failed to delete file from index');
        throw error;
      }
    }
  },

  // Bulk reindex all files in a project
  async bulkReindex(projectId: string): Promise<{ indexed: number; errors: number }> {
    try {
      const files = await prisma.projectFile.findMany({
        where: { projectId, isDirectory: false },
        select: {
          id: true,
          path: true,
          inlineContent: true,
          language: true,
          sizeBytes: true,
          updatedAt: true,
        },
      });

      await IndexManager.ensureCodeIndex(projectId);
      const indexName = `code_${projectId.replace(/-/g, '_')}`;

      let indexed = 0;
      let errors = 0;

      const operations = files.flatMap((file) => {
        const content = file.inlineContent?.toString() || '';
        if (!content) {
          errors++;
          return [];
        }
        indexed++;
        return [
          { index: { _index: indexName, _id: file.id } },
          {
            fileId: file.id,
            filePath: file.path,
            content,
            language: file.language || 'text',
            projectId,
            sizeBytes: file.sizeBytes || content.length,
            updatedAt: file.updatedAt,
          },
        ];
      });

      if (operations.length > 0) {
        await esClient.bulk({ operations: operations.flat() as any });
      }

      logger.info({ projectId, indexed, errors }, 'Bulk reindex completed');
      return { indexed, errors };
    } catch (error) {
      logger.error({ error, projectId }, 'Bulk reindex failed');
      throw error;
    }
  },
};

export default FileIndexer;
