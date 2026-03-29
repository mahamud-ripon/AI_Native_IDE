import dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '8012', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  jwt: {
    secret: requireEnv('JWT_SECRET'),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  kafkaBrokers: process.env.KAFKA_BROKERS || 'localhost:9092',

  services: {
    collab: process.env.COLLAB_SERVICE_URL || 'http://localhost:8005',
    execution: process.env.EXECUTION_SERVICE_URL || 'http://localhost:8004',
    ai: process.env.AI_SERVICE_URL || 'http://localhost:8003',
  },

  rateLimit: {
    perSecond: parseInt(process.env.RATE_LIMIT_PER_SECOND || '500', 10),
  },

  heartbeat: {
    pingInterval: parseInt(process.env.PING_INTERVAL_MS || '30000', 10),
    pingTimeout: parseInt(process.env.PING_TIMEOUT_MS || '120000', 10),
  },

  internalApiKey: requireEnv('INTERNAL_API_KEY'),
} as const;

export type Config = typeof config;
