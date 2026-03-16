import { Queue, Worker, Job, QueueOptions, WorkerOptions } from 'bullmq';
import { config } from '../config/index.js';
import { EmailService } from '../services/email_service.js';

const connectionOpts = {
  host: config.redis.url.replace('redis://', '').split(':')[0] || 'localhost',
  port: parseInt(config.redis.url.split(':').pop() || '6379', 10)
};

const queueOpts: QueueOptions = { connection: connectionOpts };
const workerOpts: WorkerOptions = { connection: connectionOpts };

const emailQueue = new Queue('email', queueOpts);

interface EmailJob {
  type: 'verify' | 'reset' | 'invite' | 'payment_failed';
  to: string;
  data: Record<string, string>;
  idempotencyKey: string;
}

export const EmailWorker = {
  async addJob(job: EmailJob): Promise<void> {
    await emailQueue.add('send', job, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    });
  },

  start(): void {
    const worker = new Worker('email', async (job: Job) => {
      const { type, to, data } = job.data as EmailJob;

      console.log(`[EmailWorker] Processing ${type} email to ${to}`);

      let success = false;

      switch (type) {
        case 'verify':
          success = await EmailService.sendVerifyEmail(to, data.token);
          break;
        case 'reset':
          success = await EmailService.sendPasswordReset(to, data.token);
          break;
        case 'invite':
          success = await EmailService.sendProjectInvite(to, data.projectName, data.inviterName);
          break;
        case 'payment_failed':
          success = await EmailService.sendPaymentFailed(to, data.projectName);
          break;
      }

      if (!success) {
        throw new Error(`Failed to send ${type} email`);
      }

      return { success: true };
    }, {
      connection: connectionOpts,
      concurrency: 10
    });

    worker.on('completed', (job) => {
      console.log(`[EmailWorker] Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
      console.log(`[EmailWorker] Job ${job?.id} failed:`, err.message);

      // After 3 failed attempts, the job is moved to DLQ automatically by BullMQ
      if (job?.attemptsMade === 3) {
        console.error(`[EmailWorker] Max retries reached for job ${job.id}, moving to DLQ`);
      }
    });

    console.log('[EmailWorker] Started');
  }
};
