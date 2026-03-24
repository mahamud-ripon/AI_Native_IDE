import { env } from '@workspace/config';

export const config = {
  port: parseInt(process.env.PORT || '8005'),
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  kafkaBrokers: (env.KAFKA_BROKERS || 'localhost:9092').split(','),
  kafkaGroupId: process.env.KAFKA_GROUP_ID || 'collab-service',
  kafkaUsername: env.KAFKA_USERNAME,
  kafkaPassword: env.KAFKA_PASSWORD,
  kafkaSaslMechanism: env.KAFKA_SASL_MECHANISM || 'scram-sha-256',
  wsGatewayUrl: process.env.WS_GATEWAY_URL || 'ws://localhost:8012',
  internalApiKey: process.env.INTERNAL_API_KEY || 'dev-internal-key',
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret',
  // Yjs settings
  maxCachedDocs: parseInt(process.env.MAX_CACHED_DOCS || '100'),
  awarenessTtl: 15000, // 15 seconds
  syncInterval: 5 * 60 * 1000, // 5 minutes
  docTtl: 86400, // 24 hours in Redis
};
