import { config } from '../config/index.js';

const { maxResults, maxQueryTime, maxDocs, queryMaxLength } = config.search;

// Sanitize query to prevent ReDoS attacks
function sanitizeQuery(query: string): string {
  return query
    .replace(/[+\-><()~*?\\^$!{}[\]|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, queryMaxLength);
}

export const QueryBuilder = {
  // Build full-text code search query with highlighting
  buildCodeSearchQuery(
    projectId: string,
    query: string,
    options?: {
      language?: string;
      pageToken?: string;
    }
  ): Record<string, unknown> {
    const sanitizedQuery = sanitizeQuery(query);
    const indexName = `code_${projectId.replace(/-/g, '_')}`;

    const must: Record<string, unknown>[] = [
      { term: { projectId } },
      {
        multi_match: {
          query: sanitizedQuery,
          fields: ['content^2', 'filePath'],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      },
    ];

    if (options?.language) {
      must.push({ term: { language: options.language } });
    }

    const body: Record<string, unknown> = {
      query: {
        bool: { must },
      },
      highlight: {
        fields: {
          content: {
            fragment_size: 100,
            number_of_fragments: 3,
            pre_tags: ['<mark>'],
            post_tags: ['</mark>'],
          },
        },
      },
      size: maxResults,
      timeout: maxQueryTime,
      terminate_after: maxDocs,
      sort: ['_score', { updatedAt: { order: 'desc' } }],
    };

    if (options?.pageToken) {
      try {
        body.search_after = JSON.parse(Buffer.from(options.pageToken, 'base64').toString());
      } catch {
        // Invalid token, ignore
      }
    }

    return { indexName, body };
  },

  // Build file name search query
  buildFileSearchQuery(
    projectId: string,
    query: string
  ): Record<string, unknown> {
    const sanitizedQuery = sanitizeQuery(query);
    const indexName = `code_${projectId.replace(/-/g, '_')}`;

    return {
      indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId } },
              {
                wildcard: {
                  filePath: {
                    value: `*${sanitizedQuery.toLowerCase()}*`,
                    case_insensitive: true,
                  },
                },
              },
            ],
          },
        },
        size: 20,
        timeout: maxQueryTime,
        _source: ['fileId', 'filePath', 'language', 'updatedAt'],
      },
    };
  },

  // Build public project discovery query
  buildProjectSearchQuery(
    query: string,
    options?: {
      template?: string;
      language?: string;
      sortBy?: 'lastOpenedAt' | 'starCount' | 'forkCount';
      pageToken?: string;
    }
  ): Record<string, unknown> {
    const sanitizedQuery = query ? sanitizeQuery(query) : '';
    const sortBy = options?.sortBy || 'lastOpenedAt';

    const must: Record<string, unknown>[] = [
      { term: { visibility: 'public' } }, // SECURITY: Only public projects
    ];

    if (sanitizedQuery) {
      must.push({
        multi_match: {
          query: sanitizedQuery,
          fields: ['name^3', 'description'],
        },
      });
    }

    if (options?.template) {
      must.push({ term: { template: options.template } });
    }

    if (options?.language) {
      must.push({ term: { language: options.language } });
    }

    const sort: Record<string, unknown> = {};
    sort[sortBy] = { order: 'desc' };

    const body: Record<string, unknown> = {
      query: { bool: { must } },
      sort: [sort],
      size: maxResults,
      timeout: maxQueryTime,
    };

    if (options?.pageToken) {
      try {
        body.search_after = JSON.parse(Buffer.from(options.pageToken, 'base64').toString());
      } catch {
        // Invalid token, ignore
      }
    }

    return { indexName: 'projects_global', body };
  },
};

export default QueryBuilder;
