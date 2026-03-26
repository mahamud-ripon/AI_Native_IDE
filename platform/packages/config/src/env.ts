import { z } from 'zod';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Try multiple locations for .env file - prioritize platform root
const envPaths = [
  resolve(__dirname, '../../../.env'), // packages/config -> platform root (MOST LIKELY CORRECT)
  resolve(__dirname, '../../.env'), // packages/config -> platform (alternative)
  resolve(process.cwd(), '.env'), // Current working directory
  resolve(process.cwd(), '../../.env'), // Up two directories (service -> platform)
];

let loadedEnvPath: string | null = null;
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    loadedEnvPath = envPath;
    break;
  }
}

/**
 * Environment variable schema with Zod validation.
 * Validates at startup - fails fast if required vars are missing/invalid.
 */

const envSchema = z.object({
  // Database - Neon requires sslmode=require
  DATABASE_URL: z.string()
    .url()
    .refine((url) => url.includes('sslmode=require'), {
      message: 'DATABASE_URL must include ?sslmode=require for Neon',
    }),

  // JWT Authentication
  JWT_SECRET: z.string().min(10, 'JWT_SECRET must be at least 10 characters'),

  // Node Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Redis - Upstash (standard ioredis URL)
  REDIS_URL: z.string().optional(),

  // Upstash REST API (optional, for serverless/edge)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Kafka - Redpanda Cloud
  KAFKA_BROKERS: z.string().optional(),
  KAFKA_USERNAME: z.string().optional(),
  KAFKA_PASSWORD: z.string().optional(),
  KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
  KAFKA_LOG_LEVEL: z.enum(['NOTHING', 'ERROR', 'WARN', 'INFO', 'DEBUG']).optional(),

  // Storage - MinIO / S3
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  S3_BUCKET_USER_FILES: z.string().default('ai-native-user-files'),
  S3_BUCKET_SNAPSHOTS: z.string().default('ai-native-snapshots'),
  S3_BUCKET_BUILD_LOGS: z.string().default('ai-native-build-logs'),
  S3_BUCKET_ARTIFACTS: z.string().default('ai-native-artifacts'),
  S3_BUCKET_AVATARS: z.string().default('ai-native-avatars'),

  // Search - Elasticsearch (supports both API Key and Username/Password)
  ELASTICSEARCH_NODE: z.string().optional(),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
  ELASTICSEARCH_API_KEY: z.string().optional(),

  // Inter-Service Communication
  AUTH_SERVICE_URL: z.string().default('http://localhost:8001'),
  PROJECT_SERVICE_URL: z.string().default('http://localhost:8002'),
  AI_SERVICE_URL: z.string().default('http://localhost:8003'),
  EXECUTION_SERVICE_URL: z.string().default('http://localhost:8004'),
  COLLAB_SERVICE_URL: z.string().default('http://localhost:8005'),
  BILLING_SERVICE_URL: z.string().default('http://localhost:8006'),
  NOTIFICATION_SERVICE_URL: z.string().default('http://localhost:8007'),
  SEARCH_SERVICE_URL: z.string().default('http://localhost:8008'),
  STORAGE_SERVICE_URL: z.string().default('http://localhost:8009'),
  DEPLOYMENT_SERVICE_URL: z.string().default('http://localhost:8010'),
  ANALYTICS_SERVICE_URL: z.string().default('http://localhost:8011'),
  WEBSOCKET_GATEWAY_URL: z.string().default('http://localhost:8012'),
  PYTHON_AGENTS_URL: z.string().default('http://localhost:9000'),
  APP_URL: z.string().default('http://localhost:5173'),

  // JWT Keys (optional - will generate ephemeral in dev)
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),

  // API Keys (optional)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  // App
  PORT: z.coerce.number().default(8000),
  API_URL: z.string().url().optional(),
  WS_URL: z.string().url().optional(),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Internal
  INTERNAL_API_KEY: z.string().optional(),
});

// Parse and validate - throws on failure
export const env = envSchema.parse(process.env);

// Type export for consumers
export type Env = z.infer<typeof envSchema>;

// Convenience exports
export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
