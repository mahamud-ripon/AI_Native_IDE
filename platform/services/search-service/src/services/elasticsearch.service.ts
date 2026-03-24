import { Client, errors } from '@elastic/elasticsearch';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

/**
 * Authentication Types
 */
type ApiKeyAuth = { apiKey: string };
type BasicAuth = { username: string; password: string };
type NoAuth = undefined;
type AuthConfig = ApiKeyAuth | BasicAuth | NoAuth;

/**
 * Authentication Detection Result
 */
interface AuthDetectionResult {
  auth: AuthConfig;
  method: 'api_key' | 'basic' | 'none';
  description: string;
}

/**
 * Detects and returns the appropriate Elasticsearch authentication configuration.
 * 
 * Priority Order:
 * 1. API Key (ELASTICSEARCH_API_KEY) - For Elasticsearch Cloud/Serverless
 * 2. Basic Auth (ELASTICSEARCH_USERNAME + ELASTICSEARCH_PASSWORD) - For self-hosted
 * 3. No Auth - For local development only
 */
function detectAuthConfiguration(): AuthDetectionResult {
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  const username = process.env.ELASTICSEARCH_USERNAME;
  const password = process.env.ELASTICSEARCH_PASSWORD;

  // Priority 1: API Key Authentication (Cloud/Serverless)
  if (apiKey && apiKey.trim() !== '') {
    return {
      auth: { apiKey: apiKey.trim() },
      method: 'api_key',
      description: 'API Key (Elasticsearch Cloud/Serverless)',
    };
  }

  // Priority 2: Basic Authentication (Self-hosted)
  if (username && password && username.trim() !== '' && password.trim() !== '') {
    return {
      auth: { username: username.trim(), password: password.trim() },
      method: 'basic',
      description: 'Basic Auth (Username/Password)',
    };
  }

  // Priority 3: No Authentication (Development only)
  logger.warn(
    'No Elasticsearch authentication configured. Using no auth (development mode only).'
  );
  return {
    auth: undefined,
    method: 'none',
    description: 'No Authentication (Development)',
  };
}

/**
 * Validates Elasticsearch connection and authentication.
 * Tests the connection immediately after client creation.
 */
async function validateConnection(
  client: Client,
  authInfo: AuthDetectionResult
): Promise<{ success: boolean; error?: string }> {
  try {
    const info = await client.info();
    logger.info({
      node: config.elasticsearch.node,
      version: info.version?.number,
      clusterName: info.cluster_name,
      authMethod: authInfo.method,
      authDescription: authInfo.description,
    }, 'Elasticsearch connection validated successfully');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Authentication-specific error handling
    if (error instanceof errors.AuthenticationException) {
      return {
        success: false,
        error: 'Authentication failed (' + authInfo.description + '): Invalid credentials or expired API key',
      };
    }
    
    if (error instanceof errors.ConnectionError) {
      return {
        success: false,
        error: 'Connection failed: Cannot reach Elasticsearch at ' + config.elasticsearch.node,
      };
    }

    if (error instanceof errors.TimeoutError) {
      return {
        success: false,
        error: 'Connection timeout: Elasticsearch at ' + config.elasticsearch.node + ' did not respond within ' + config.elasticsearch.requestTimeout + 'ms',
      };
    }

    return {
      success: false,
      error: 'Elasticsearch connection failed: ' + errorMessage,
    };
  }
}

/**
 * Creates and configures the Elasticsearch client with dynamic authentication.
 */
function createElasticsearchClient(): { client: Client; authInfo: AuthDetectionResult } {
  const authInfo = detectAuthConfiguration();
  
  const clientConfig = {
    node: config.elasticsearch.node,
    auth: authInfo.auth,
    tls: {
      rejectUnauthorized: config.nodeEnv === 'production',
    },
    maxRetries: config.elasticsearch.maxRetries,
    requestTimeout: config.elasticsearch.requestTimeout,
  };

  logger.info({
    node: config.elasticsearch.node,
    authMethod: authInfo.method,
    authDescription: authInfo.description,
    tls: config.nodeEnv === 'production' ? 'enabled' : 'disabled',
    maxRetries: config.elasticsearch.maxRetries,
    requestTimeout: config.elasticsearch.requestTimeout,
  }, 'Initializing Elasticsearch client');

  const client = new Client(clientConfig);
  
  return { client, authInfo };
}

// Initialize the Elasticsearch client
const { client: esClient, authInfo: initialAuthInfo } = createElasticsearchClient();

// Async validation (non-blocking)
validateConnection(esClient, initialAuthInfo)
  .then((result) => {
    if (!result.success) {
      logger.error({ error: result.error }, 'Elasticsearch connection validation failed');
      logger.warn('Search functionality may be degraded. Please check your Elasticsearch configuration.');
    }
  })
  .catch((error) => {
    logger.error({ error }, 'Unexpected error during Elasticsearch connection validation');
  });

/**
 * Detects if running on Elasticsearch Serverless by checking the node info.
 * Serverless doesn't support index settings like number_of_shards/number_of_replicas.
 */
let isServerless: boolean | null = null;

async function detectServerlessMode(): Promise<boolean> {
  if (isServerless !== null) return isServerless;
  
  try {
    const info = await esClient.info();
    // Elasticsearch Serverless typically has "serverless" in the build flavor or specific markers
    const buildFlavor = (info as any).version?.build_flavor;
    isServerless = buildFlavor === 'serverless' || 
                   config.elasticsearch.node.includes('serverless') ||
                   config.elasticsearch.node.includes('elastic.cloud');
    logger.info({ 
      node: config.elasticsearch.node, 
      buildFlavor: buildFlavor,
      isServerless 
    }, 'Elasticsearch mode detection');
    return isServerless;
  } catch (error) {
    // Assume serverless if we can't determine (safer default for cloud endpoints)
    const isLikelyServerless = config.elasticsearch.node.includes('elastic.cloud');
    logger.warn({ error, isServerless: isLikelyServerless }, 'Could not detect Elasticsearch mode, assuming based on URL');
    return isLikelyServerless;
  }
}

/**
 * Gets index settings based on Elasticsearch deployment type.
 * Serverless mode doesn't support number_of_shards/number_of_replicas.
 */
async function getIndexSettings(): Promise<any> {
  const serverless = await detectServerlessMode();
  
  if (serverless) {
    // Serverless: Only include analysis settings (no shards/replicas)
    return {
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
    };
  }
  
  // Self-hosted: Include shards/replicas settings
  return {
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
  };
}

// Index manager for creating and managing Elasticsearch indices
export const IndexManager = {
  /**
   * Create code index for a specific project (one index per project for isolation)
   */
  async ensureCodeIndex(projectId: string): Promise<void> {
    const indexName = 'code_' + projectId.replace(/-/g, '_');

    try {
      const exists = await esClient.indices.exists({ index: indexName });
      if (exists) return;

      const settings = await getIndexSettings();

      await esClient.indices.create({
        index: indexName,
        body: {
          settings: settings,
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
    } catch (error) {
      logger.error({ error, indexName, projectId }, 'Failed to ensure code index');
      throw error;
    }
  },

  /**
   * Create global project index for public project discovery
   */
  async ensureProjectIndex(): Promise<void> {
    const indexName = 'projects_global';

    try {
      const exists = await esClient.indices.exists({ index: indexName });
      if (exists) return;

      const serverless = await detectServerlessMode();
      const settings = serverless ? {} : { number_of_shards: 1, number_of_replicas: 1 };

      await esClient.indices.create({
        index: indexName,
        body: {
          settings: settings,
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

      logger.info({ indexName, serverless }, 'Created project index');
    } catch (error) {
      logger.error({ error, indexName }, 'Failed to ensure project index');
      throw error;
    }
  },

  /**
   * Delete code index when project is deleted
   */
  async deleteCodeIndex(projectId: string): Promise<void> {
    const indexName = 'code_' + projectId.replace(/-/g, '_');
    try {
      await esClient.indices.delete({ index: indexName });
      logger.info({ indexName, projectId }, 'Deleted code index');
    } catch (error: any) {
      if (error.meta?.statusCode === 404) {
        logger.debug({ indexName, projectId }, 'Code index not found, already deleted');
      } else {
        logger.warn({ error, indexName, projectId }, 'Failed to delete code index');
      }
    }
  },

  /**
   * Check Elasticsearch health with detailed authentication status
   */
  async healthCheck(): Promise<{
    status: string;
    cluster_name?: string;
    auth_method?: string;
    version?: string;
  }> {
    try {
      const [health, info] = await Promise.all([
        esClient.cluster.health(),
        esClient.info(),
      ]);
      
      const authInfo = detectAuthConfiguration();
      
      return {
        status: health.status,
        cluster_name: health.cluster_name,
        auth_method: authInfo.method,
        version: info.version?.number,
      };
    } catch (error: any) {
      const authInfo = detectAuthConfiguration();
      logger.error({ 
        error, 
        authMethod: authInfo.method,
        node: config.elasticsearch.node 
      }, 'Elasticsearch health check failed');
      
      // Return detailed error status
      return {
        status: 'unavailable',
        auth_method: authInfo.method,
      };
    }
  },

  /**
   * Verify authentication is working correctly
   */
  async verifyAuthentication(): Promise<{
    valid: boolean;
    method: string;
    error?: string;
  }> {
    const authInfo = detectAuthConfiguration();
    const result = await validateConnection(esClient, authInfo);
    
    return {
      valid: result.success,
      method: authInfo.method,
      error: result.error,
    };
  },
};

export default esClient;