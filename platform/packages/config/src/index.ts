import { z } from 'zod';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().default('postgresql://ainative:ainative_pass@localhost:5432/ainative_ide'),
  
  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  
  // Kafka
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_USERNAME: z.string().optional(),
  KAFKA_PASSWORD: z.string().optional(),
  KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
  
  // Auth
  JWT_PRIVATE_KEY: z.string().default('development-private-key'),
  JWT_PUBLIC_KEY: z.string().default('development-public-key'),
  JWT_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
  
  // API Keys
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8000),
  API_URL: z.string().url().default('http://localhost:8000'),
  WS_URL: z.string().url().default('ws://localhost:8001'),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);

export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
