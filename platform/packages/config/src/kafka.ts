import { Kafka, KafkaConfig, logLevel, SASLOptions } from 'kafkajs';
import { env } from './env.js';

/**
 * Creates a Kafka client configured for Redpanda Cloud or local development.
 * Automatically handles SASL authentication when credentials are provided.
 */

export interface KafkaClientOptions {
  clientId: string;
  groupId?: string;
}

function getLogLevel(envStr?: string): logLevel {
  switch(envStr) {
    case 'NOTHING': return logLevel.NOTHING;
    case 'ERROR': return logLevel.ERROR;
    case 'WARN': return logLevel.WARN;
    case 'INFO': return logLevel.INFO;
    case 'DEBUG': return logLevel.DEBUG;
    default: return env.NODE_ENV === 'development' ? logLevel.DEBUG : logLevel.ERROR;
  }
}

export function createKafkaClient(options: KafkaClientOptions): Kafka {
  const { clientId } = options;

  // Debug log for Kafka configuration
  console.log(`[KafkaConfig] Creating client for ${clientId}`);
  console.log(`[KafkaConfig] KAFKA_BROKERS: ${env.KAFKA_BROKERS}`);
  console.log(`[KafkaConfig] KAFKA_USERNAME set: ${!!env.KAFKA_USERNAME}`);
  console.log(`[KafkaConfig] KAFKA_PASSWORD set: ${!!env.KAFKA_PASSWORD}`);
  console.log(`[KafkaConfig] KAFKA_SASL_MECHANISM: ${env.KAFKA_SASL_MECHANISM}`);
  
  const parsedLogLevel = getLogLevel(env.KAFKA_LOG_LEVEL);
  console.log(`[KafkaConfig] KAFKA_LOG_LEVEL: ${env.KAFKA_LOG_LEVEL} -> ${parsedLogLevel}`);

  // Base configuration
  const kafkaConfig: KafkaConfig = {
    clientId,
    brokers: env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
    logLevel: parsedLogLevel,
    retry: {
      initialRetryTime: 100,
      retries: 8,
      maxRetryTime: 30000,
    },
    // Connection timeout settings for Redpanda Cloud
    connectionTimeout: 10000,
    // Request timeout
    requestTimeout: 60000,
  };

  // Add SASL authentication for Redpanda Cloud
  if (env.KAFKA_USERNAME && env.KAFKA_PASSWORD) {
    const mechanism = env.KAFKA_SASL_MECHANISM || 'scram-sha-256';
    
    console.log(`[KafkaConfig] Enabling SASL/SSL for ${clientId}`);
    
    kafkaConfig.sasl = {
      mechanism: mechanism as SASLOptions['mechanism'],
      username: env.KAFKA_USERNAME,
      password: env.KAFKA_PASSWORD,
    } as SASLOptions;
    
    kafkaConfig.ssl = true; // Required for SASL
  } else {
    console.warn(`[KafkaConfig] No SASL credentials - SASL will be disabled for ${clientId}`);
  }

  return new Kafka(kafkaConfig);
}

/**
 * Common Kafka topics used across services
 */
export const KafkaTopics = {
  // Project events
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_DELETED: 'project.deleted',
  
  // File events
  FILE_CREATED: 'file.created',
  FILE_MODIFIED: 'file.modified',
  FILE_DELETED: 'file.deleted',
  FILE_EVENTS: 'project.files.events',
  
  // Secret events
  SECRET_CREATED: 'secret.created',
  SECRET_UPDATED: 'secret.updated',
  SECRET_DELETED: 'secret.deleted',
  
  // Collaboration events
  COLLABORATOR_INVITED: 'collaborator.invited',
  COLLABORATOR_REMOVED: 'collaborator.removed',
  
  // Execution events
  EXECUTION_STARTED: 'execution.started',
  EXECUTION_COMPLETED: 'execution.completed',
  EXECUTION_FAILED: 'execution.failed',
  EXECUTION_GIT_CLONE: 'execution.git_clone',
  
  // Billing events
  BILLING_USAGE: 'billing.usage',
  BILLING_SUBSCRIPTION: 'billing.subscription',
  
  // AI events
  AI_LLM_REQUEST: 'ai.llm.request',
  AI_LLM_RESPONSE: 'ai.llm.response',
  
  // Notification events
  NOTIFICATION_SEND: 'notification.send',
  NOTIFICATION_PUSH: 'notification.push',
  
  // Deployment events
  DEPLOYMENT_STARTED: 'deployment.started',
  DEPLOYMENT_COMPLETED: 'deployment.completed',
  DEPLOYMENT_FAILED: 'deployment.failed',
} as const;

export type KafkaTopic = typeof KafkaTopics[keyof typeof KafkaTopics];
