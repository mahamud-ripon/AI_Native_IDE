import { env } from '@workspace/config';

export const config = {
  port: parseInt(process.env.PORT || '8002', 10),
  nodeEnv: env.NODE_ENV,

  database: {
    url: env.DATABASE_URL,
  },

  redis: {
    url: env.REDIS_URL,
  },

  kafka: {
    brokers: (env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'project-service',
    enabled: process.env.KAFKA_ENABLED !== 'false',
  },

  s3: {
    bucket: process.env.S3_BUCKET || 'project-files',
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    endpoint: process.env.S3_ENDPOINT || undefined,
  },

  vault: {
    addr: process.env.VAULT_ADDR || 'http://localhost:8200',
    token: process.env.VAULT_TOKEN || '',
    enabled: process.env.VAULT_ENABLED === 'true',
  },

  jwt: {
    secret: process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env var is required'); })(),
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  internalApiKey: process.env.INTERNAL_API_KEY || (() => { throw new Error('INTERNAL_API_KEY env var is required'); })(),
  
  storage: {
    // Always use S3 - no inline storage per DEVELOPMENT_LOGIC.md Priority 1.1
    alwaysUseS3: true,
  },
};

