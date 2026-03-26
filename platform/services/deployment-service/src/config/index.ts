import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8011', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL!
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'deployment-service'
  },

  wsGatewayUrl: process.env.WS_GATEWAY_URL || 'ws://localhost:8012',

  vault: {
    addr: process.env.VAULT_ADDR || 'https://vault.platform.io',
    token: process.env.VAULT_TOKEN
  },

  s3: {
    bucket: process.env.S3_BUCKET || 'deployment-logs',
    region: process.env.AWS_REGION || 'us-east-1'
  },

  providers: {
    vercel: { token: process.env.VERCEL_TOKEN },
    railway: { token: process.env.RAILWAY_TOKEN },
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    gcp: { projectId: process.env.GCP_PROJECT_ID },
    azure: { subscriptionId: process.env.AZURE_SUBSCRIPTION_ID }
  },

  internalApiKey: process.env.INTERNAL_API_KEY || (() => { throw new Error('INTERNAL_API_KEY env var is required'); })(),

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  }
};
