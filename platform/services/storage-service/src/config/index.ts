import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8009', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  s3: {
    endpoint: process.env.S3_ENDPOINT || undefined, // undefined for AWS default
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    buckets: {
      userFiles: process.env.S3_BUCKET_USER_FILES || 'platform-user-files',
      snapshots: process.env.S3_BUCKET_SNAPSHOTS || 'platform-snapshots',
      buildLogs: process.env.S3_BUCKET_BUILD_LOGS || 'platform-build-logs',
      artifacts: process.env.S3_BUCKET_ARTIFACTS || 'platform-artifacts',
      avatars: process.env.S3_BUCKET_AVATARS || 'platform-avatars',
    },
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'storage-service',
    enabled: process.env.KAFKA_ENABLED !== 'false',
  },

  database: {
    url: process.env.DATABASE_URL!,
  },

  clamav: {
    host: process.env.CLAMAV_HOST || 'localhost',
    port: parseInt(process.env.CLAMAV_PORT || '3310', 10),
    enabled: process.env.CLAMAV_ENABLED === 'true',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-key-change-in-production',
    publicKey: process.env.JWT_PUBLIC_KEY || '',
  },

  internalApiKey: process.env.INTERNAL_API_KEY || 'internal-api-key',

  storage: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800', 10), // 50MB
    presignedUrlExpiry: {
      upload: parseInt(process.env.PRESIGNED_UPLOAD_EXPIRY || '900', 10), // 15 min
      download: parseInt(process.env.PRESIGNED_DOWNLOAD_EXPIRY || '3600', 10), // 1 hour
    },
    orphanCleanupSafetyHours: parseInt(process.env.ORPHAN_CLEANUP_SAFETY_HOURS || '24', 10),
  },
} as const;

export type Config = typeof config;
