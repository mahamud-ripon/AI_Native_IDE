import { redisClient } from '../lib/redis';
import { prisma } from '@workspace/database';

const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[Telemetry] ${msg}`, ...args),
  error: (msg: string, err?: any) => console.error(`[Telemetry] ${msg}`, err),
  warn: (msg: string, ...args: any[]) => console.warn(`[Telemetry] ${msg}`, ...args),
};

interface SystemMetrics {
  timestamp: Date;
  queues: {
    [queueName: string]: {
      pending: number;
      processing: number;
      failed: number;
    };
  };
  database: {
    activeConnections: number;
    slowQueries: number;
  };
  jobs: {
    [jobName: string]: {
      lastRun: Date;
      duration: number;
      success: boolean;
    };
  };
  vms: {
    active: number;
    hibernated: number;
    total: number;
  };
}

export async function runTelemetryJob(): Promise<void> {
  logger.info('📈 Collecting system telemetry...');

  const metrics: Partial<SystemMetrics> = {
    timestamp: new Date(),
    queues: {},
    database: { activeConnections: 0, slowQueries: 0 },
    jobs: {},
    vms: { active: 0, hibernated: 0, total: 0 },
  };

  try {
    // 1. Queue metrics from Redis
    const queueNames = ['ai', 'email', 'cleanup', 'embedding', 'usage'];
    
    for (const queueName of queueNames) {
      try {
        // BullMQ queue metrics (stored in Redis)
        const pending = await redisClient.llen(`bull:${queueName}:wait`);
        const active = await redisClient.llen(`bull:${queueName}:active`);
        const failed = await redisClient.llen(`bull:${queueName}:failed`);

        metrics.queues![queueName] = {
          pending: pending || 0,
          processing: active || 0,
          failed: failed || 0,
        };
      } catch (e: any) {
        metrics.queues![queueName] = { pending: 0, processing: 0, failed: 0 };
      }
    }

    // 2. Database metrics
    try {
      // Get active connections (if supported by Prisma/PostgreSQL)
      const connectionResult = await prisma.$queryRaw`
        SELECT count(*) as count FROM pg_stat_activity WHERE state = 'active'
      `;
      metrics.database!.activeConnections = Number((connectionResult as any)[0]?.count) || 0;

      // Count slow queries (taking > 1 second)
      const slowQueryResult = await prisma.$queryRaw`
        SELECT count(*) as count FROM pg_stat_activity 
        WHERE state = 'active' AND now() - query_start > interval '1 second'
      `;
      metrics.database!.slowQueries = Number((slowQueryResult as any)[0]?.count) || 0;
    } catch (e: any) {
      logger.warn('Failed to collect DB metrics:', e.message);
    }

    // 3. Job execution metrics from Redis
    const jobNames = ['vm_hibernation', 'usage_rollup', 'garbage_collector', 'telemetry'];
    
    for (const jobName of jobNames) {
      try {
        const lastRunKey = `telemetry:job:${jobName}`;
        const lastRunData = await redisClient.get(lastRunKey);
        
        if (lastRunData) {
          const parsed = JSON.parse(lastRunData);
          metrics.jobs![jobName] = {
            lastRun: new Date(parsed.timestamp),
            duration: parsed.duration || 0,
            success: parsed.success || false,
          };
        }
      } catch (e: any) {
        // No previous data
      }
    }

    // 4. VM metrics from Redis
    try {
      const vmKeys = await redisClient.keys('vm_last_active:*');
      const hibernatedKeys = await redisClient.keys('vm_status:*');
      
      let activeCount = 0;
      let hibernatedCount = 0;

      for (const key of hibernatedKeys) {
        const status = await redisClient.get(key);
        if (status === 'hibernated') {
          hibernatedCount++;
        } else {
          activeCount++;
        }
      }

      metrics.vms = {
        active: activeCount,
        hibernated: hibernatedCount,
        total: vmKeys.length,
      };
    } catch (e: any) {
      logger.warn('Failed to collect VM metrics:', e.message);
    }

    // 5. Store metrics in Redis for Admin Dashboard
    const metricsKey = `telemetry:${Date.now()}`;
    await redisClient.setex(metricsKey, 86400, JSON.stringify(metrics)); // Keep for 24 hours

    // 6. Keep only last 100 telemetry entries (LRU)
    const allKeys = await redisClient.keys('telemetry:*');
    if (allKeys.length > 100) {
      // Sort and delete oldest
      const sortedKeys = allKeys.sort();
      const toDelete = sortedKeys.slice(0, allKeys.length - 100);
      await redisClient.del(...toDelete);
    }

    // 7. Store current metrics for quick access
    await redisClient.setex('telemetry:current', 900, JSON.stringify(metrics)); // 15 min TTL

    // 8. Update job tracking for next run
    const jobKey = 'telemetry:job:telemetry';
    await redisClient.set(jobKey, JSON.stringify({
      timestamp: Date.now(),
      duration: 0,
      success: true,
    }));

    logger.info('✅ Telemetry collected successfully');
    logger.info(`   Queues: ${JSON.stringify(metrics.queues)}`);
    logger.info(`   VMs: ${JSON.stringify(metrics.vms)}`);

  } catch (error: any) {
    logger.error('Telemetry job failed:', error.message);
    throw error;
  }
}
