import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8007', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL!
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'notification-service'
  },

  wsGatewayUrl: process.env.WS_GATEWAY_URL || 'ws://localhost:8012',

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    sesFromEmail: process.env.SES_FROM_EMAIL || 'noreply@platform.io'
  },

  emailTemplates: {
    verifyEmail: process.env.VERIFY_EMAIL_TEMPLATE,
    passwordReset: process.env.PASSWORD_RESET_TEMPLATE,
    paymentFailed: process.env.PAYMENT_FAILED_TEMPLATE,
    projectInvite: process.env.PROJECT_INVITE_TEMPLATE
  },

  internalApiKey: process.env.INTERNAL_API_KEY || 'dev-internal-key'
};
