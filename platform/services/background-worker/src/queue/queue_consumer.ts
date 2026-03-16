import { Queue, Worker, Job } from 'bullmq';
import { redisClient } from '../lib/redis';
import { handleDeadLetterQueue } from './dead_letter_queue';
import { orchestrateAIGeneration, handleFallbackProvider } from '../jobs/ai_orchestrator.js';
import { scanGeneratedCode, scanProjectFiles } from '../jobs/ai_code_scanner.js';
import { sendVerificationEmail, sendInvitationEmail, sendDeployStatusEmail, sendUsageAlertEmail } from '../jobs/email_sender.js';
import { updateFileEmbedding, fullProjectReindex, removeFileEmbedding } from '../jobs/embedding_processor.js';
import { syncStripeUsage } from '../jobs/stripe_sync.js';

const logger = {
  info: (msg: string) => console.log(`[Queue Consumer] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[Queue Consumer] ${msg}`, err),
  warn: (msg: string) => console.warn(`[Queue Consumer] ${msg}`),
};

// Queue names as per DEVELOPMENT_LOGIC.md
const QUEUE_NAMES = ['ai', 'email', 'cleanup', 'embedding', 'usage'];

// Worker instances
const workers: Worker[] = [];
const queues: Map<string, Queue> = new Map();

// Queue configuration with concurrency limits
const QUEUE_CONFIG: Record<string, { concurrency: number; priority: number }> = {
  ai: { concurrency: 2, priority: 1 },        // HIGH priority
  email: { concurrency: 10, priority: 1 },    // HIGH priority
  cleanup: { concurrency: 5, priority: 3 },   // LOW priority
  embedding: { concurrency: 3, priority: 2 }, // MEDIUM priority
  usage: { concurrency: 2, priority: 2 },     // MEDIUM priority
};

export function initializeQueues(): void {
  logger.info('🎯 Initializing BullMQ queues...');

  for (const queueName of QUEUE_NAMES) {
    // Create queue
    const queue = new Queue(queueName, {
      connection: redisClient,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000, // 60 seconds base delay
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
          count: 500,
        },
      },
    });

    queues.set(queueName, queue);
    logger.info(`📬 Queue registered: ${queueName}`);
  }
}

export function startQueueConsumers(): void {
  logger.info('🚀 Starting queue consumers...');

  for (const queueName of QUEUE_NAMES) {
    const config = QUEUE_CONFIG[queueName];

    const worker = new Worker(
      queueName,
      async (job: Job) => {
        logger.info(`📥 Processing job ${job.id} from ${queueName}: ${job.name}`);

        const startTime = Date.now();

        try {
          // Route to appropriate processor
          await processJob(queueName, job);

          const duration = Date.now() - startTime;
          logger.info(`✅ Job ${job.id} completed in ${duration}ms`);

          // Update telemetry
          await recordJobTelemetry(queueName, job.name, duration, true);

        } catch (error: any) {
          logger.error(`❌ Job ${job.id} failed:`, error.message);
          
          // Update telemetry
          await recordJobTelemetry(queueName, job.name, Date.now() - startTime, false);
          
          // Throw to trigger BullMQ retry
          throw error;
        }
      },
      {
        connection: redisClient,
        concurrency: config.concurrency,
        lockDuration: 30000, // 30 seconds
        stalledInterval: 30000,
        maxStalledCount: 2,
      }
    );

    // Handle completed jobs
    worker.on('completed', (job: Job) => {
      logger.info(`🎉 Job ${job.id} completed successfully`);
    });

    // Handle failed jobs
    worker.on('failed', async (job: Job | undefined, err: Error) => {
      if (job) {
        logger.error(`💥 Job ${job.id} failed permanently:`, err.message);
        
        // Check if max retries exceeded
        if (job.attemptsMade >= (job.opts.attempts || 3)) {
          logger.warn(`📤 Sending job ${job.id} to DLQ`);
          await handleDeadLetterQueue(queueName, job, err);
        }
      }
    });

    // Handle stalled jobs
    worker.on('stalled', (jobId: string) => {
      logger.warn(`🐌 Job ${jobId} stalled`);
    });

    workers.push(worker);
    logger.info(`👷 Worker started for ${queueName} (concurrency: ${config.concurrency})`);
  }

  // Start DLQ monitor
  startDLQMonitor();
}

async function processJob(queueName: string, job: Job): Promise<void> {
  const { name, data } = job;

  switch (queueName) {
    case 'ai':
      await processAIJob(name, data);
      break;
    case 'email':
      await processEmailJob(name, data);
      break;
    case 'cleanup':
      await processCleanupJob(name, data);
      break;
    case 'embedding':
      await processEmbeddingJob(name, data);
      break;
    case 'usage':
      await processUsageJob(name, data);
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
}

// AI Job Processors
async function processAIJob(jobName: string, data: any): Promise<void> {
  switch (jobName) {
    case 'ai.generate_orchestrate':
      await orchestrateAIGeneration(data);
      break;

    case 'ai.scan_generated_code':
      if (data.fileIds) {
        await scanProjectFiles({ projectId: data.projectId, fileIds: data.fileIds });
      } else {
        await scanGeneratedCode(data);
      }
      break;

    case 'ai.fallback_provider':
      await handleFallbackProvider(data);
      break;

    default:
      throw new Error(`Unknown AI job: ${jobName}`);
  }
}

// Email Job Processors
async function processEmailJob(jobName: string, data: any): Promise<void> {
  logger.info(`📧 Sending email: ${jobName} to ${data.to}`);
  
  switch (jobName) {
    case 'email.send_verification':
      await sendVerificationEmail(data);
      break;
    case 'email.send_invitation':
      await sendInvitationEmail(data);
      break;
    case 'email.send_deploy_status':
      await sendDeployStatusEmail(data);
      break;
    case 'email.send_usage_alert':
      await sendUsageAlertEmail(data);
      break;
    default:
      throw new Error(`Unknown email job: ${jobName}`);
  }
}

// Cleanup Job Processors
async function processCleanupJob(jobName: string, data: any): Promise<void> {
  logger.info(`🧹 Cleanup job: ${jobName}`);
  
  // Cleanup jobs are handled by the cron manager
  // This queue is for on-demand cleanup tasks
  
  switch (jobName) {
    case 'cleanup.idle_vms':
      // Triggered by schedule, handled by cron
      break;
    case 'cleanup.orphan_s3':
      // S3 orphan cleanup
      break;
    default:
      throw new Error(`Unknown cleanup job: ${jobName}`);
  }
}

// Embedding Job Processors
async function processEmbeddingJob(jobName: string, data: any): Promise<void> {
  logger.info(`🧠 Processing embedding job: ${jobName}`);
  
  switch (jobName) {
    case 'embedding.update_file':
      await updateFileEmbedding(data);
      break;

    case 'embedding.full_reindex':
      await fullProjectReindex(data);
      break;

    case 'embedding.remove_file':
      await removeFileEmbedding(data);
      break;

    default:
      throw new Error(`Unknown embedding job: ${jobName}`);
  }
}

// Usage Job Processors
async function processUsageJob(jobName: string, data: any): Promise<void> {
  logger.info(`📊 Processing usage job: ${jobName}`);
  
  switch (jobName) {
    case 'usage.aggregate_daily':
      // Handled by cron job - usage_rollup_job
      logger.info(`Usage aggregation triggered via queue`);
      break;

    case 'usage.sync_stripe_usage':
      await syncStripeUsage(data);
      break;

    default:
      throw new Error(`Unknown usage job: ${jobName}`);
  }
}

// Telemetry recording
async function recordJobTelemetry(
  queueName: string,
  jobName: string,
  duration: number,
  success: boolean
): Promise<void> {
  const key = `telemetry:job:${queueName}:${jobName}`;
  await redisClient.setex(key, 86400, JSON.stringify({
    timestamp: Date.now(),
    duration,
    success,
  }));
}

// DLQ Monitor
function startDLQMonitor(): void {
  // Monitor DLQ for critical alerts
  setInterval(async () => {
    try {
      const dlqKeys = await redisClient.keys('dlq:*');
      let totalFailed = 0;

      for (const key of dlqKeys) {
        const count = await redisClient.llen(key);
        totalFailed += count;

        // Alert if critical queue has failures
        if (count > 0 && (key.includes('ai') || key.includes('email.send_verification'))) {
          logger.error(`🚨 CRITICAL: ${key} has ${count} failed jobs!`);
          // In production, send PagerDuty/Slack alert here
        }
      }

      if (totalFailed > 0) {
        logger.warn(`📊 DLQ Status: ${totalFailed} total failed jobs across ${dlqKeys.length} queues`);
      }
    } catch (e: any) {
      logger.error('DLQ monitor error:', e.message);
    }
  }, 60000); // Check every minute
}

export function getQueue(name: string): Queue | undefined {
  return queues.get(name);
}

export function stopQueueConsumers(): void {
  logger.info('🛑 Stopping queue consumers...');
  
  workers.forEach((worker) => worker.close());
  queues.forEach((queue) => queue.close());
  
  logger.info('✅ Queue consumers stopped');
}

export function getQueueStatus(): { name: string; pending: number; active: number }[] {
  // Return current queue status (async, simplified for types)
  return QUEUE_NAMES.map((name) => ({
    name,
    pending: 0,
    active: 0,
  }));
}
