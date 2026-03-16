import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const queues = {
  ai: new Queue('ai', { connection: redis }),
  email: new Queue('email', { connection: redis }),
  cleanup: new Queue('cleanup', { connection: redis }),
  embedding: new Queue('embedding', { connection: redis }),
  usage: new Queue('usage', { connection: redis }),
};

async function testQueueJobs() {
  console.log('🧪 Testing Queue Job Processing...\n');

  // Test AI jobs
  console.log('1. Testing AI Queue...');
  const aiJob = await queues.ai.add('ai.generate_orchestrate', {
    conversationId: 'test-conv-123',
    userId: 'test-user-123',
    projectId: 'test-project-123',
    prompt: 'Create a simple hello world function',
  });
  console.log(`   ✅ AI job added: ${aiJob.id}\n`);

  // Test Email jobs
  console.log('2. Testing Email Queue...');
  const emailJob = await queues.email.add('email.send_verification', {
    to: 'test@example.com',
    userId: 'test-user-123',
    name: 'Test User',
  });
  console.log(`   ✅ Email job added: ${emailJob.id}\n`);

  // Test Embedding jobs
  console.log('3. Testing Embedding Queue...');
  const embedJob = await queues.embedding.add('embedding.update_file', {
    fileId: 'test-file-123',
    projectId: 'test-project-123',
    path: '/src/test.ts',
  });
  console.log(`   ✅ Embedding job added: ${embedJob.id}\n`);

  // Test Usage jobs
  console.log('4. Testing Usage Queue...');
  const usageJob = await queues.usage.add('usage.sync_stripe_usage', {
    userId: 'test-user-123',
  });
  console.log(`   ✅ Usage job added: ${usageJob.id}\n`);

  // Check queue status
  console.log('5. Checking Queue Status...');
  for (const [name, queue] of Object.entries(queues)) {
    const waiting = await queue.getWaitingCount();
    const active = await queue.getActiveCount();
    const completed = await queue.getCompletedCount();
    const failed = await queue.getFailedCount();
    console.log(`   ${name}: waiting=${waiting}, active=${active}, completed=${completed}, failed=${failed}`);
  }

  console.log('\n✅ Queue tests completed!');
  console.log('   Run the background-worker to process these jobs.\n');

  await redis.quit();
  process.exit(0);
}

testQueueJobs().catch(console.error);
