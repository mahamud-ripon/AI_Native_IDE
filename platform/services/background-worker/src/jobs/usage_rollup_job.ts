import { redisClient } from '../lib/redis';
import { prisma } from '@workspace/database';

const logger = {
  info: (msg: string) => console.log(`[Usage Rollup] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[Usage Rollup] ${msg}`, err),
  warn: (msg: string) => console.warn(`[Usage Rollup] ${msg}`),
};

interface UsageRecord {
  userId: string;
  date: string;
  type: string;
  value: number;
}

export async function runUsageRollupJob(): Promise<void> {
  logger.info('📊 Starting usage rollup job...');

  const processedCount = { total: 0, users: 0, errors: 0 };

  try {
    // Scan all usage:* keys in Redis
    // Pattern: usage:{user_id}:{date}:{type}
    const pattern = 'usage:*';
    let cursor = '0';
    const keys: string[] = [];

    // Use SCAN to avoid blocking Redis
    do {
      const result = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');

    logger.info(`Found ${keys.length} usage keys to process`);

    if (keys.length === 0) {
      logger.info('No usage data to rollup');
      return;
    }

    // Group by user and date
    const usageMap = new Map<string, UsageRecord>();

    for (const key of keys) {
      try {
        // Parse key: usage:{user_id}:{date}:{type}
        const parts = key.split(':');
        if (parts.length < 4) {
          logger.warn(`Invalid key format: ${key}`);
          continue;
        }

        const [, userId, date, type] = parts;

        // Get value from Redis
        const valueStr = await redisClient.get(key);
        if (!valueStr) continue;

        const value = parseInt(valueStr, 10);
        if (isNaN(value) || value === 0) {
          // Skip zero values and delete the key
          await redisClient.del(key);
          continue;
        }

        const mapKey = `${userId}:${date}:${type}`;
        const existing = usageMap.get(mapKey);

        if (existing) {
          existing.value += value;
        } else {
          usageMap.set(mapKey, { userId, date, type, value });
        }

      } catch (keyError: any) {
        logger.error(`Error processing key ${key}:`, keyError.message);
        processedCount.errors++;
      }
    }

    // Batch update PostgreSQL
    const records = Array.from(usageMap.values());
    
    if (records.length === 0) {
      logger.info('No valid usage records to sync');
      return;
    }

    logger.info(`Syncing ${records.length} usage records to PostgreSQL`);

    // Process in batches of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      try {
        // Use transaction for batch update
        await prisma.$transaction(async (tx: any) => {
          for (const record of batch) {
            // Map metric type to the correct counter field
            const updateData: any = {
              updatedAt: new Date(),
            };
            
            // UsageDaily has specific counter fields, not a generic metric_type
            switch (record.type) {
              case 'ai_request':
                updateData.aiRequestsCount = { increment: record.value };
                break;
              case 'ai_tokens':
                updateData.aiTokensUsed = { increment: record.value };
                break;
              case 'compute_seconds':
                updateData.computeSeconds = { increment: record.value };
                break;
              case 'storage_bytes':
                updateData.storageBytes = { increment: record.value };
                break;
              case 'deploys':
                updateData.deploysCount = { increment: record.value };
                break;
              default:
                logger.warn(`Unknown metric type: ${record.type}`);
            }

            // Upsert usageDaily record (camelCase model name per Prisma convention)
            await tx.usageDaily.upsert({
              where: {
                // UsageDaily has a unique constraint on userId + date
                userId_date: {
                  userId: record.userId,
                  date: new Date(record.date),
                },
              },
              update: updateData,
              create: {
                userId: record.userId,
                date: new Date(record.date),
                aiRequestsCount: record.type === 'ai_request' ? record.value : 0,
                aiTokensUsed: record.type === 'ai_tokens' ? record.value : 0,
                computeSeconds: record.type === 'compute_seconds' ? record.value : 0,
                storageBytes: record.type === 'storage_bytes' ? record.value : 0,
                deploysCount: record.type === 'deploys' ? record.value : 0,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });

            processedCount.total++;
          }
        });

        // Delete processed Redis keys only after successful DB update (idempotency)
        for (const record of batch) {
          const redisKey = `usage:${record.userId}:${record.date}:${record.type}`;
          // Subtract the value we just synced
          const remaining = await redisClient.decrby(redisKey, record.value);
          
          if (remaining <= 0) {
            // Fully processed, delete the key
            await redisClient.del(redisKey);
          }
          // If remaining > 0, new usage came in during processing, keep the key
        }

      } catch (batchError: any) {
        logger.error(`Batch update failed:`, batchError.message);
        processedCount.errors += batch.length;
        // Don't delete Redis keys on failure - ensures idempotency
      }
    }

    processedCount.users = new Set(records.map(r => r.userId)).size;
    
    logger.info(`✅ Usage rollup complete: ${processedCount.total} records, ${processedCount.users} users, ${processedCount.errors} errors`);

  } catch (error: any) {
    logger.error('Usage rollup job failed:', error.message);
    throw error;
  }
}
