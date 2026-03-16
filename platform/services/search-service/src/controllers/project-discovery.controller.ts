import { FastifyRequest, FastifyReply } from 'fastify';
import { esClient } from '../services/elasticsearch.service.js';
import { QueryBuilder } from '../services/query-builder.service.js';
import { logger } from '../lib/logger.js';

interface ProjectSearchResult {
  projectId: string;
  name: string;
  description: string | null;
  template: string | null;
  language: string | null;
  framework: string | null;
  forkCount: number;
  starCount: number;
  lastOpenedAt: string | null;
  createdAt: string;
}

export async function discoverProjects(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as {
    q?: string;
    template?: string;
    language?: string;
    sort?: 'lastOpenedAt' | 'starCount' | 'forkCount';
    page_token?: string;
  };
  const { q, template, language, sort, page_token } = query;

  try {
    const { indexName, body } = QueryBuilder.buildProjectSearchQuery(q || '', {
      template,
      language,
      sortBy: sort,
      pageToken: page_token,
    });

    const result = await esClient.search({
      index: indexName as any,
      body: body as any,
    });

    const hits = result.hits.hits;
    const projects: ProjectSearchResult[] = hits.map((hit: any) => {
      const source = hit._source;
      return {
        projectId: source.projectId,
        name: source.name,
        description: source.description,
        template: source.template,
        language: source.language,
        framework: source.framework,
        forkCount: source.forkCount || 0,
        starCount: source.starCount || 0,
        lastOpenedAt: source.lastOpenedAt,
        createdAt: source.createdAt,
      };
    });

    // Generate next page token
    let nextToken: string | undefined;
    if (hits.length === 50 && hits[49].sort) {
      nextToken = Buffer.from(JSON.stringify(hits[49].sort)).toString('base64');
    }

    logger.info({ query: q, results: projects.length }, 'Project discovery completed');

    return reply.send({
      success: true,
      data: {
        projects,
        total_hits: (result.hits.total as any)?.value || 0,
        next_page_token: nextToken,
      },
    });
  } catch (error: any) {
    logger.error({ error, query: q }, 'Project discovery failed');
    return reply.status(500).send({
      success: false,
      error: error.message || 'Search failed',
    });
  }
}

export default { discoverProjects };
