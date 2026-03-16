import { env } from '@workspace/config';

export const config = {
  port: parseInt(process.env.PORT || '8006'),
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  kafkaBrokers: (env.KAFKA_BROKERS || 'localhost:9092').split(','),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
};
