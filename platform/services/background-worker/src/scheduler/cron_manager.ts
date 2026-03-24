import cron from 'node-cron';
import { redisClient, acquireLock, releaseLock } from '../lib/redis';
import { runVMHibernationJob } from '../jobs/vm_hibernation_job';
import { runUsageRollupJob } from '../jobs/usage_rollup_job';
import { runGarbageCollector } from '../jobs/garbage_collector';
import { runTelemetryJob } from '../jobs/telemetry_job';

// Logger
const logger = {
  info: (msg: string) => console.log(`[${new Date().toISOString()}] INFO: ${msg}`),
  error: (msg: string, err?: any) => console.error(`[${new Date().toISOString()}] ERROR: ${msg}`, err),
  warn: (msg: string) => console.warn(`[${new Date().toISOString()}] WARN: ${msg}`),
};

// Job registry with schedules
interface JobConfig {
  name: string;
  schedule: string;
  task: () => Promise<void>;
  lockKey: string;
  lockTtl: number;
}

const jobs: JobConfig[] = [
  {
    name: 'VM Hibernation',
    schedule: '*/1 * * * *', // Every 60 seconds
    task: runVMHibernationJob,
    lockKey: 'lock:cron:vm_hibernation',
    lockTtl: 120, // 2 minutes
  },
  {
    name: 'Usage Rollup',
    schedule: '*/5 * * * *', // Every 5 minutes
    task: runUsageRollupJob,
    lockKey: 'lock:cron:usage_rollup',
    lockTtl: 300, // 5 minutes
  },
  {
    name: 'Garbage Collector',
    schedule: '0 3 * * *', // Daily at 03:00 AM
    task: runGarbageCollector,
    lockKey: 'lock:cron:garbage_collector',
    lockTtl: 3600, // 1 hour
  },
  {
    name: 'Telemetry Aggregation',
    schedule: '*/15 * * * *', // Every 15 minutes
    task: runTelemetryJob,
    lockKey: 'lock:cron:telemetry',
    lockTtl: 900, // 15 minutes
  },
];

// Store cron tasks for cleanup
const cronTasks: cron.ScheduledTask[] = [];

export function startCronManager(): void {
  logger.info('🕐 Starting Cron Manager...');

  jobs.forEach((job) => {
    logger.info(`📅 Registering job: ${job.name} (${job.schedule})`);

    const task = cron.schedule(job.schedule, async () => {
      const startTime = Date.now();
      logger.info(`🔔 Job ${job.name} triggered`);

      let lockAcquired = false;

      try {
        // Acquire distributed lock
        lockAcquired = await acquireLock(job.lockKey, job.lockTtl);
        
        if (!lockAcquired) {
          logger.info(`⏭️ Job ${job.name} skipped - another instance is running`);
          return;
        }

        logger.info(`🔒 Lock acquired for ${job.name}`);

        // Execute the job
        await job.task();

        const duration = Date.now() - startTime;
        logger.info(`✅ Job ${job.name} completed in ${duration}ms`);

      } catch (error) {
        logger.error(`❌ Job ${job.name} failed:`, error);
      } finally {
        // Only release lock if we acquired it
        if (lockAcquired) {
          await releaseLock(job.lockKey);
          logger.info(`🔓 Lock released for ${job.name}`);
        }
      }
    }, {
      scheduled: true,
      timezone: 'UTC',
    });

    cronTasks.push(task);
  });

  logger.info('✅ Cron Manager started');
}

export function stopCronManager(): void {
  logger.info('🛑 Stopping Cron Manager...');
  cronTasks.forEach((task) => task.stop());
  logger.info('✅ Cron Manager stopped');
}

export function getJobStatus(): { name: string; schedule: string; running: boolean }[] {
  return jobs.map((job) => ({
    name: job.name,
    schedule: job.schedule,
    running: true, // Cron is running if manager is active
  }));
}
