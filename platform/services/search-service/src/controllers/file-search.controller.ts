import { FastifyRequest, FastifyReply } from 'fastify';
import { esClient } from '../services/elasticsearch.service.js';
import { QueryBuilder } from '../services/query-builder.service.js';
import { PermissionService } from '../services/permission.service.js';
import { logger } from '../lib/logger.js';

interface FileSearchResult {
  fileId: string;
  filePath: string;
  language: string;
  updatedAt?: string;
}

export async function searchFiles(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as { q: string; projectId: string };
  const { q, projectId } = query;
  const userId = request.headers['x-user-id'] as string | undefined;

  if (!q || !projectId) {
    return reply.status(400).send({
      success: false,
      error: 'Missing required params: q, projectId',
    });
  }

  try {
    // SECURITY: Verify user has access to this project
    const hasAccess = await PermissionService.canSearchProject(userId, projectId);
    if (!hasAccess) {
      logger.warn({ userId, projectId }, 'Access denied to file search');
      return reply.status(403).send({
        success: false,
        error: 'Access denied',
      });
    }

    const { indexName, body } = QueryBuilder.buildFileSearchQuery(projectId, q);

    const result = await esClient.search({
      index: indexName as any,
      body: body as any,
    });

    const hits = result.hits.hits;
    const files: FileSearchResult[] = hits.map((hit: any) => ({
      fileId: hit._source.fileId,
      filePath: hit._source.filePath,
      language: hit._source.language,
      updatedAt: hit._source.updatedAt,
    }));

    logger.info({ projectId, query: q, results: files.length }, 'File search completed');

    return reply.send({
      success: true,
      data: files,
    });
  } catch (error: any) {
    logger.error({ error, projectId, query: q }, 'File search failed');
    return reply.status(500).send({
      success: false,
      error: error.message || 'Search failed',
    });
  }
}

export default { searchFiles };
