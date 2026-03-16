import { Client } from '@elastic/elasticsearch';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

// Singleton Elasticsearch client with connection pooling
export const esClient = new Client({
  node: config.elasticsearch.node,
  auth: config.elasticsearch.username
    ? {
        username: config.elasticsearch.username,
        password: config.elasticsearch.password,
      }
    : undefined,
  tls: {
    rejectUnauthorized: config.nodeEnv === 'production',
  },
  maxRetries: config.elasticsearch.maxRetries,
  requestTimeout: config.elasticsearch.requestTimeout,
});

// Index manager for creating and managing Elasticsearch indices
export const IndexManager = {
  // Create code index for a specific project (one index per project for isolation)
  async ensureCodeIndex(projectId: string): Promise<void> {
    const indexName = `code_${projectId.replace(/-/g, '_')}`;

    const exists = await esClient.indices.exists({ index: indexName });
    if (exists) return;

    await esClient.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 1,
          analysis: {
            analyzer: {
              code_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'camel_case', 'underscore_split'],
              },
            },
            filter: {
              camel_case: {
                type: 'word_delimiter_graph',
                preserve_original: true,
              },
              underscore_split: {
                type: 'word_delimiter_graph',
                preserve_original: true,
              },
            },
          },
        },
        mappings: {
          properties: {
            fileId: { type: 'keyword' },
            filePath: { type: 'text', analyzer: 'standard' },
            content: { type: 'text', analyzer: 'code_analyzer' },
            language: { type: 'keyword' },
            projectId: { type: 'keyword' },
            sizeBytes: { type: 'integer' },
            updatedAt: { type: 'date' },
          },
        },
      },
    });

    logger.info({ indexName, projectId }, 'Created code index');
  },

  // Create global project index for public project discovery
  async ensureProjectIndex(): Promise<void> {
    const indexName = 'projects_global';

    const exists = await esClient.indices.exists({ index: indexName });
    if (exists) return;

    await esClient.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 1,
        },
        mappings: {
          properties: {
            projectId: { type: 'keyword' },
            name: { type: 'text', analyzer: 'standard' },
            description: { type: 'text' },
            template: { type: 'keyword' },
            ownerId: { type: 'keyword' },
            visibility: { type: 'keyword' },
            language: { type: 'keyword' },
            framework: { type: 'keyword' },
            forkCount: { type: 'integer' },
            starCount: { type: 'integer' },
            lastOpenedAt: { type: 'date' },
            createdAt: { type: 'date' },
          },
        },
      },
    });

    logger.info({ indexName }, 'Created project index');
  },

  // Delete code index when project is deleted
  async deleteCodeIndex(projectId: string): Promise<void> {
    const indexName = `code_${projectId.replace(/-/g, '_')}`;
    try {
      await esClient.indices.delete({ index: indexName });
      logger.info({ indexName, projectId }, 'Deleted code index');
    } catch (error) {
      logger.warn({ indexName, projectId }, 'Code index not found or already deleted');
    }
  },

  // Check Elasticsearch health
  async healthCheck(): Promise<{ status: string; cluster_name?: string }> {
    try {
      const health = await esClient.cluster.health();
      return {
        status: health.status,
        cluster_name: health.cluster_name,
      };
    } catch (error) {
      logger.error({ error }, 'Elasticsearch health check failed');
      return { status: 'unavailable' };
    }
  },
};

export default esClient;
