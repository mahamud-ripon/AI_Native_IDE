import { env } from '@workspace/config';

export const config = {
  port: parseInt(process.env.PORT || '8011'),
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  kafkaBrokers: env.KAFKA_BROKERS,
  elasticsearchUrl: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
};
