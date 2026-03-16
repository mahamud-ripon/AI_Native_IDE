import { env } from '@workspace/config';

export const config = {
  port: parseInt(process.env.PORT || '8009'),
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  kafkaBrokers: env.KAFKA_BROKERS,
};
