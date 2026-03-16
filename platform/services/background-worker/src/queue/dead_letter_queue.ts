import { Job } from 'bullmq';
import { redisClient } from '../lib/redis';

const logger = {
  info: (msg: string) => console.log(`[DLQ] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[DLQ] ${msg}`, err),
  warn: (msg: string) => console.warn(`[DLQ] ${msg}`),
};

interface DLQEntry {
  jobId: string;
  queueName: string;
  jobName: string;
  data: any;
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
  failedAt: number;
  attempts: number;
}

/**
 * Handle jobs that have failed max retries
 * Stores them in Redis Dead Letter Queue for manual review
 */
export async function handleDeadLetterQueue(
  queueName: string,
  job: Job,
  error: Error
): Promise<void> {
  const dlqKey = `dlq:${queueName}`;

  const entry: DLQEntry = {
    jobId: job.id || 'unknown',
    queueName,
    jobName: job.name,
    data: job.data,
    error: {
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
    },
    failedAt: Date.now(),
    attempts: job.attemptsMade,
  };

  try {
    // Push to Redis list (DLQ)
    await redisClient.lpush(dlqKey, JSON.stringify(entry));

    // Trim to keep only last 1000 entries per queue
    await redisClient.ltrim(dlqKey, 0, 999);

    logger.error(`📦 Job ${job.id} moved to DLQ: ${dlqKey}`);

    // Critical job alerting
    if (isCriticalJob(queueName, job.name)) {
      await sendCriticalAlert(entry);
    }

  } catch (dlqError: any) {
    logger.error(`Failed to write to DLQ:`, dlqError.message);
    // Log to console as fallback
    console.error('DLQ_ENTRY:', JSON.stringify(entry, null, 2));
  }
}

/**
 * Check if this is a critical job requiring immediate alerting
 */
function isCriticalJob(queueName: string, jobName: string): boolean {
  // Critical: AI jobs and email verification
  if (queueName === 'ai') return true;
  if (jobName === 'email.send_verification') return true;
  if (jobName === 'email.send_invitation') return true;
  return false;
}

/**
 * Send critical alert (PagerDuty/Slack simulation)
 */
async function sendCriticalAlert(entry: DLQEntry): Promise<void> {
  logger.error(`🚨 CRITICAL ALERT: Job ${entry.jobId} failed permanently!`);
  logger.error(`   Queue: ${entry.queueName}`);
  logger.error(`   Job: ${entry.jobName}`);
  logger.error(`   Error: ${entry.error.message}`);

  // In production, integrate with:
  // - PagerDuty for critical alerts
  // - Slack for notifications
  // - Email for admin alerts

  // Store alert in Redis for Admin Dashboard
  const alertKey = `alerts:critical:${Date.now()}`;
  await redisClient.setex(alertKey, 86400, JSON.stringify({
    type: 'dlq_critical',
    entry,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Get all DLQ entries for a queue
 */
export async function getDLQEntries(queueName: string): Promise<DLQEntry[]> {
  const dlqKey = `dlq:${queueName}`;
  
  try {
    const entries = await redisClient.lrange(dlqKey, 0, -1);
    return entries.map((entry: string) => JSON.parse(entry));
  } catch (e: any) {
    logger.error(`Failed to get DLQ entries:`, e.message);
    return [];
  }
}

/**
 * Retry a specific DLQ entry
 */
export async function retryDLQEntry(
  queueName: string,
  jobId: string
): Promise<boolean> {
  const dlqKey = `dlq:${queueName}`;

  try {
    // Find the entry
    const entries = await redisClient.lrange(dlqKey, 0, -1);
    
    for (let i = 0; i < entries.length; i++) {
      const entry: DLQEntry = JSON.parse(entries[i]);
      
      if (entry.jobId === jobId) {
        // Remove from DLQ
        await redisClient.lrem(dlqKey, 0, entries[i]);

        // Re-queue the job
        const { Queue } = await import('bullmq');
        const queue = new Queue(queueName, { connection: redisClient });
        
        await queue.add(entry.jobName, entry.data, {
          jobId: `${jobId}-retry-${Date.now()}`,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 60000,
          },
        });

        await queue.close();

        logger.info(`🔄 Retried job ${jobId} from DLQ`);
        return true;
      }
    }

    logger.warn(`Job ${jobId} not found in DLQ`);
    return false;

  } catch (e: any) {
    logger.error(`Failed to retry DLQ entry:`, e.message);
    return false;
  }
}

/**
 * Dismiss (delete) a DLQ entry
 */
export async function dismissDLQEntry(
  queueName: string,
  jobId: string
): Promise<boolean> {
  const dlqKey = `dlq:${queueName}`;

  try {
    const entries = await redisClient.lrange(dlqKey, 0, -1);
    
    for (const entryStr of entries) {
      const entry: DLQEntry = JSON.parse(entryStr);
      
      if (entry.jobId === jobId) {
        await redisClient.lrem(dlqKey, 0, entryStr);
        logger.info(`🗑️ Dismissed job ${jobId} from DLQ`);
        return true;
      }
    }

    return false;

  } catch (e: any) {
    logger.error(`Failed to dismiss DLQ entry:`, e.message);
    return false;
  }
}

/**
 * Get DLQ statistics
 */
export async function getDLQStats(): Promise<{
  total: number;
  byQueue: Record<string, number>;
}> {
  const stats = {
    total: 0,
    byQueue: {} as Record<string, number>,
  };

  try {
    const dlqKeys = await redisClient.keys('dlq:*');

    for (const key of dlqKeys) {
      const count = await redisClient.llen(key);
      const queueName = key.replace('dlq:', '');
      stats.byQueue[queueName] = count;
      stats.total += count;
    }

  } catch (e: any) {
    logger.error(`Failed to get DLQ stats:`, e.message);
  }

  return stats;
}
