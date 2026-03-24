import dotenv from 'dotenv';
dotenv.config();

interface KafkaConfig {
  brokers: string[];
  groupId: string;
  enabled: boolean;
  username?: string;
  password?: string;
  saslMechanism: string;
}

const kafkaConfig: KafkaConfig = {
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  groupId: process.env.KAFKA_GROUP_ID || 'project-service',
  enabled: process.env.KAFKA_ENABLED !== 'false',
  username: process.env.KAFKA_USERNAME,
  password: process.env.KAFKA_PASSWORD,
  saslMechanism: process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256',
};

export const config = {
  port: parseInt(process.env.PORT || '8002', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL!,
  },

  kafka: kafkaConfig,

  s3: {
    bucket: process.env.S3_BUCKET || 'project-files',
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    endpoint: process.env.S3_ENDPOINT || undefined, // For MinIO/localstack
  },

  vault: {
    addr: process.env.VAULT_ADDR || 'http://localhost:8200',
    token: process.env.VAULT_TOKEN || '',
    enabled: process.env.VAULT_ENABLED === 'true',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  internalApiKey: process.env.INTERNAL_API_KEY || 'internal-api-key',

  storage: {
    // Always use S3 - no inline storage per DEVELOPMENT_LOGIC.md Priority 1.1
    alwaysUseS3: true,
  },
};

export type Config = typeof config;
