import { redisClient, acquireLock } from '../lib/redis';
import { prisma } from '@workspace/database';
import axios from 'axios';

const logger = {
  info: (msg: string) => console.log(`[VM Hibernation] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[VM Hibernation] ${msg}`, err),
};

const EXECUTION_SERVICE_URL = process.env.EXECUTION_SERVICE_URL || 'http://localhost:3005';
const IDLE_THRESHOLD_MINUTES = 10;

export async function runVMHibernationJob(): Promise<void> {
  logger.info('🔍 Scanning for idle VMs...');

  try {
    // Get all active VMs from Redis
    const vmKeys = await redisClient.keys('vm_last_active:*');
    logger.info(`Found ${vmKeys.length} VMs to check`);

    const now = Date.now();
    let hibernatedCount = 0;

    for (const key of vmKeys) {
      const vmId = key.replace('vm_last_active:', '');
      
      try {
        // Get last active timestamp
        const lastActiveStr = await redisClient.get(key);
        if (!lastActiveStr) continue;

        const lastActive = parseInt(lastActiveStr, 10);
        const idleMinutes = (now - lastActive) / (1000 * 60);

        // Check if VM is idle
        if (idleMinutes <= IDLE_THRESHOLD_MINUTES) {
          logger.info(`VM ${vmId} is active (${Math.round(idleMinutes)}m idle)`);
          continue;
        }

        logger.info(`VM ${vmId} is idle (${Math.round(idleMinutes)}m), checking lock...`);

        // Acquire exclusive lock for hibernation
        const lockKey = `lock:hibernate:${vmId}`;
        const lockAcquired = await acquireLock(lockKey, 300); // 5 minute lock

        if (!lockAcquired) {
          logger.info(`VM ${vmId} hibernation already in progress by another worker`);
          continue;
        }

        // Trigger hibernation via execution-service
        logger.info(`🦀 Triggering hibernation for VM ${vmId}`);
        
        try {
          await axios.post(`${EXECUTION_SERVICE_URL}/vms/${vmId}/hibernate`, {
            reason: 'idle_timeout',
            idleMinutes: Math.round(idleMinutes),
          });

          // Update status in database (if execution-service doesn't)
          await prisma.projectSnapshot.updateMany({
            where: { vmId: vmId },
            data: { status: 'hibernated' },
          }).catch(() => {
            // Table might not exist, ignore
          });

          hibernatedCount++;
          logger.info(`✅ VM ${vmId} hibernated successfully`);

        } catch (apiError: any) {
          logger.error(`❌ Failed to hibernate VM ${vmId}:`, apiError.message);
        }

        // Lock will expire automatically (300s TTL)

      } catch (vmError: any) {
        logger.error(`Error processing VM ${vmId}:`, vmError.message);
      }
    }

    logger.info(`🎉 VM Hibernation job complete. Hibernated ${hibernatedCount} VMs`);

  } catch (error: any) {
    logger.error('VM Hibernation job failed:', error.message);
    throw error;
  }
}
