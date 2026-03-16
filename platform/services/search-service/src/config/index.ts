import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8008', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  elasticsearch: {
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    username: process.env.ELASTICSEARCH_USERNAME || '',
    password: process.env.ELASTICSEARCH_PASSWORD || '',
    maxRetries: 3,
    requestTimeout: 30000,
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
