import { FastifyRequest, FastifyReply } from 'fastify';
import { esClient } from '../services/elasticsearch.service.js';
import { QueryBuilder } from '../services/query-builder.service.js';
import { PermissionService } from '../services/permission.service.js';
import { logger } from '../lib/logger.js';

interface SearchMatch {
  line_number: number;
  content: string;
  highlight: string;
}

interface CodeSearchResult {
  fileId: string;
  filePath: string;
  language: string;
  matches: SearchMatch[];
}

export async function searchCode(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as {
    q: string;
    projectId: string;
    language?: string;
    page_token?: string;
  };
  const { q, projectId, language, page_token } = query;
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
      logger.warn({ userId, projectId }, 'Access denied to project search');
      return reply.status(403).send({
        success: false,
        error: 'Access denied',
      });
    }

    const { indexName, body } = QueryBuilder.buildCodeSearchQuery(projectId, q, {
      language,
      pageToken: page_token,
    });

    const result = await esClient.search({
      index: indexName as any,
      body: body as any,
    });

    const hits = result.hits.hits;
    const results: CodeSearchResult[] = hits.map((hit: any) => {
      const source = hit._source;
      const highlights = hit.highlight?.content || [];

      return {
        fileId: source.fileId,
        filePath: source.filePath,
        language: source.language,
        matches: highlights.map((content: string, i: number) => ({
          line_number: i + 1,
          content: content.replace(/<mark>|<\/mark>/g, ''),
          highlight: content,
        })),
      };
    });

    // Generate next page token for cursor-based pagination
    let nextToken: string | undefined;
    if (hits.length === 50 && hits[49].sort) {
      nextToken = Buffer.from(JSON.stringify(hits[49].sort)).toString('base64');
    }

    logger.info({ projectId, query: q, results: results.length }, 'Code search completed');

    return reply.send({
      success: true,
      data: {
        results,
        total_hits: (result.hits.total as any)?.value || 0,
        next_page_token: nextToken,
      },
    });
  } catch (error: any) {
    logger.error({ error, projectId, query: q }, 'Code search failed');
    return reply.status(500).send({
      success: false,
      error: error.message || 'Search failed',
    });
  }
}

export default { searchCode };
