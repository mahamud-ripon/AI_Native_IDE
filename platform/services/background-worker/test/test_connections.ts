import Redis from 'ioredis';
import { prisma } from '@workspace/database';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function testConnections() {
  console.log('🧪 Testing Background Worker Dependencies...\n');

  // Test Redis
  console.log('1. Testing Redis Connection...');
  try {
    const pong = await redis.ping();
    console.log(`   ✅ Redis: ${pong}\n`);
  } catch (error: any) {
    console.log(`   ❌ Redis failed: ${error.message}\n`);
  }

  // Test Database
  console.log('2. Testing Database Connection...');
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`   ✅ Database connected\n`);
  } catch (error: any) {
    console.log(`   ❌ Database failed: ${error.message}\n`);
  }

  // Test Redis Lock
  console.log('3. Testing Distributed Lock...');
  try {
    const lockKey = 'lock:test:connection';
    const acquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');
    if (acquired === 'OK') {
      console.log(`   ✅ Lock acquired\n`);
      await redis.del(lockKey);
    } else {
      console.log(`   ⚠️ Lock already held\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Lock failed: ${error.message}\n`);
  }

  // Test Redis Keys
  console.log('4. Checking Redis Keys...');
  try {
    const keys = await redis.keys('*');
    console.log(`   📊 Total keys: ${keys.length}`);
    const dlqKeys = keys.filter(k => k.startsWith('dlq:'));
    const emailKeys = keys.filter(k => k.startsWith('email:'));
    const usageKeys = keys.filter(k => k.startsWith('usage:'));
    console.log(`   - DLQ keys: ${dlqKeys.length}`);
    console.log(`   - Email keys: ${emailKeys.length}`);
    console.log(`   - Usage keys: ${usageKeys.length}\n`);
  } catch (error: any) {
    console.log(`   ❌ Keys check failed: ${error.message}\n`);
  }

  // Test Queue Status
  console.log('5. Checking BullMQ Queues...');
  try {
    const queues = ['ai', 'email', 'cleanup', 'embedding', 'usage'];
    for (const queueName of queues) {
      const waiting = await redis.llen(`bull:${queueName}:wait`);
      const active = await redis.llen(`bull:${queueName}:active`);
      console.log(`   ${queueName}: waiting=${waiting}, active=${active}`);
    }
    console.log();
  } catch (error: any) {
    console.log(`   ❌ Queue check failed: ${error.message}\n`);
  }

  console.log('✅ Connection tests completed!\n');

  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

testConnections().catch(console.error);
