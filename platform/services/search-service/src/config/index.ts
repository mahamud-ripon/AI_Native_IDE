import dotenv from 'dotenv';
dotenv.config();

/**
 * Authentication configuration type for Elasticsearch
 * Supports both API Key (for Cloud/Serverless) and Username/Password (for self-hosted)
 */
export type ElasticsearchAuthConfig = 
  | { type: 'api_key'; apiKey: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'none' };

/**
 * Determines the authentication method based on available environment variables.
 * Priority: API Key > Username/Password > None
 */
function getElasticsearchAuth(): ElasticsearchAuthConfig {
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  const username = process.env.ELASTICSEARCH_USERNAME;
  const password = process.env.ELASTICSEARCH_PASSWORD;

  // API Key authentication (preferred for Elasticsearch Cloud/Serverless)
  if (apiKey && apiKey.trim() !== '') {
    return { type: 'api_key', apiKey: apiKey.trim() };
  }

  // Basic authentication (for self-hosted Elasticsearch)
  if (username && password && username.trim() !== '' && password.trim() !== '') {
    return { type: 'basic', username: username.trim(), password: password.trim() };
  }

  // No authentication (development/local only)
  return { type: 'none' };
}

export const config = {
  port: parseInt(process.env.PORT || '8008', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  elasticsearch: {
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    auth: getElasticsearchAuth(),
    maxRetries: 3,
    requestTimeout: 30000,
    // Legacy fields for backward compatibility
    username: process.env.ELASTICSEARCH_USERNAME || '',
    password: process.env.ELASTICSEARCH_PASSWORD || '',
    apiKey: process.env.ELASTICSEARCH_API_KEY || '',
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'search-service',
    enabled: process.env.KAFKA_ENABLED !== 'false',
  },

  database: {
    url: process.env.DATABASE_URL!,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-key-change-in-production',
    publicKey: process.env.JWT_PUBLIC_KEY || '',
  },

  internalApiKey: process.env.INTERNAL_API_KEY || 'internal-api-key',

  search: {
    maxResults: 50,
    maxQueryTime: '5s',
    maxDocs: 10000,
    queryMaxLength: 200,
  },
} as const;

export type Config = typeof config;
