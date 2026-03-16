import { env } from '@workspace/config';

export const config = {
  port: parseInt(process.env.PORT || '8007'),
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  kafkaBrokers: env.KAFKA_BROKERS,
  kafkaGroupId: process.env.KAFKA_GROUP_ID || 'analytics-service',
  featureFlagTTL: parseInt(process.env.FEATURE_FLAG_TTL || '300'),
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  adminApiKey: process.env.ADMIN_API_KEY || '',
};
