import { env } from '@workspace/config';

export const config = {
  port: parseInt(process.env.PORT || '8003'),
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  kafkaBrokers: env.KAFKA_BROKERS,
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  openaiApiKey: env.OPENAI_API_KEY,
  groqApiKey: env.GROQ_API_KEY,
  aiAgentsApiKey: process.env.AI_AGENTS_API_KEY || '',
  aiAgentsUrl: process.env.AI_AGENTS_URL || 'http://localhost:9000',
  projectServiceUrl: process.env.PROJECT_SERVICE_URL || 'http://localhost:8002',
  internalApiKey: process.env.INTERNAL_API_KEY || (() => { throw new Error('INTERNAL_API_KEY env var is required'); })(),
};
