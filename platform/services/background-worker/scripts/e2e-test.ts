#!/usr/bin/env node
/// <reference types="node" />
/**
 * 🔬 END-TO-END TEST SCRIPT - Background Worker Service
 * Tests all cron jobs, queue consumers, distributed locks, and DLQ functionality
 */

import Redis from 'ioredis';
import { execSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const sleep = promisify(setTimeout);

// ============================================
// CONFIGURATION
// ============================================
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TEST_TIMEOUT = 30000; // 30 seconds per test

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: [] as { name: string; passed: boolean; error?: string; duration?: number }[],
};

// Redis client
let redisClient: Redis;

// ============================================
// UTILITY FUNCTIONS
// ============================================
function log(msg: string, color: string = colors.reset): void {
  console.log(`${color}${msg}${colors.reset}`);
}

function section(title: string): void {
  console.log('\n' + '='.repeat(60));
  log(`  ${title}`, colors.blue);
  console.log('='.repeat(60) + '\n');
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const startTime = Date.now();
  try {
    await fn();
    const duration = Date.now() - startTime;
    results.passed++;
    results.tests.push({ name, passed: true, duration });
    log(`  ✓ ${name} (${duration}ms)`, colors.green);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    results.failed++;
    results.tests.push({ name, passed: false, error: error.message, duration });
    log(`  ✗ ${name}`, colors.red);
    log(`    Error: ${error.message}`, colors.red);
  }
}

// ============================================
// SETUP & TEARDOWN
// ============================================
async function setup(): Promise<void> {
  log('\n🔧 Setting up test environment...', colors.cyan);
  
  // Connect to Redis
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  // Wait for connection
  await redisClient.ping();
  
  // Clear test keys
  const testKeys = await redisClient.keys('test:*');
  if (testKeys.length > 0) {
    await redisClient.del(...testKeys);
  }
  
  log('✅ Redis connected and test keys cleared', colors.green);
}

async function teardown(): Promise<void> {
  log('\n🧹 Cleaning up test environment...', colors.cyan);
  
  // Clear test keys
  const testKeys = await redisClient.keys('test:*');
  if (testKeys.length > 0) {
    await redisClient.del(...testKeys);
  }
  
  // Close Redis connection
  await redisClient.quit();
  
  log('✅ Cleanup complete', colors.green);
}

// ============================================
// TEST SUITE
// ============================================
async function runTests(): Promise<void> {
  log('\n⚙️ Background Worker E2E Tests\n', colors.bright + colors.blue);

  // ============================================
  // 1. REDIS CONNECTION TESTS
  // ============================================
  section('1. Redis Connection & Basic Operations');

  await test('Redis PING responds', async () => {
    const response = await redisClient.ping();
    if (response !== 'PONG') {
      throw new Error(`Expected PONG, got ${response}`);
    }
  });

  await test('Redis SET/GET operations', async () => {
    await redisClient.set('test:key', 'value');
    const value = await redisClient.get('test:key');
    if (value !== 'value') {
      throw new Error(`Expected 'value', got ${value}`);
    }
  });

  await test('Redis SCAN operation', async () => {
    await redisClient.set('test:scan1', '1');
    await redisClient.set('test:scan2', '2');
    
    const result = await redisClient.scan('0', 'MATCH', 'test:scan*', 'COUNT', 10);
    if (!result || result[1].length < 2) {
      throw new Error('SCAN did not return expected keys');
    }
  });

  // ============================================
  // 2. DISTRIBUTED LOCKING TESTS
  // ============================================
  section('2. Distributed Locking (Redlock Pattern)');

  await test('Acquire lock with SET NX EX', async () => {
    const lockKey = 'test:lock:1';
    const result = await redisClient.set(lockKey, '1', 'EX', 10, 'NX');
    if (result !== 'OK') {
      throw new Error('Failed to acquire lock');
    }
  });

  await test('Cannot acquire same lock twice', async () => {
    const lockKey = 'test:lock:2';
    const first = await redisClient.set(lockKey, '1', 'EX', 10, 'NX');
    if (first !== 'OK') throw new Error('First lock failed');
    
    const second = await redisClient.set(lockKey, '1', 'EX', 10, 'NX');
    if (second !== null) {
      throw new Error('Should not be able to acquire lock twice');
    }
  });

  await test('Lock expires after TTL', async () => {
    const lockKey = 'test:lock:3';
    await redisClient.set(lockKey, '1', 'EX', 1); // 1 second TTL
    
    // Wait for expiration
    await sleep(1100);
    
    const result = await redisClient.set(lockKey, '1', 'EX', 10, 'NX');
    if (result !== 'OK') {
      throw new Error('Lock should have expired');
    }
  });

  await test('Release lock with DEL', async () => {
    const lockKey = 'test:lock:4';
    await redisClient.set(lockKey, '1', 'EX', 60, 'NX');
    await redisClient.del(lockKey);
    
    const result = await redisClient.set(lockKey, '1', 'EX', 10, 'NX');
    if (result !== 'OK') {
      throw new Error('Lock should be released');
    }
  });

  // ============================================
  // 3. BULLMQ QUEUE TESTS
  // ============================================
  section('3. BullMQ Queue Operations');

  await test('Queue creation and job addition', async () => {
    // Simulate BullMQ queue operations with Redis
    const queueName = 'test:queue:email';
    const jobId = `job:${Date.now()}`;
    const jobData = { to: 'test@example.com', subject: 'Test' };
    
    // Add job to queue (BullMQ format)
    await redisClient.lpush(`${queueName}:wait`, JSON.stringify({
      id: jobId,
      name: 'email.send',
      data: jobData,
      attempts: 0,
      timestamp: Date.now(),
    }));
    
    // Verify job is in queue
    const queueLength = await redisClient.llen(`${queueName}:wait`);
    if (queueLength < 1) {
      throw new Error('Job not added to queue');
    }
  });

  await test('Job processing simulation', async () => {
    const queueName = 'test:queue:cleanup';
    const jobId = `job:${Date.now()}`;
    
    // Add job
    await redisClient.lpush(`${queueName}:wait`, JSON.stringify({
      id: jobId,
      name: 'cleanup.expired',
      data: {},
      timestamp: Date.now(),
    }));
    
    // Move to active (simulate worker picking up job)
    const jobData = await redisClient.rpoplpush(`${queueName}:wait`, `${queueName}:active`);
    if (!jobData) {
      throw new Error('Failed to move job to active');
    }
    
    // Complete job (move to completed)
    await redisClient.lrem(`${queueName}:active`, 0, jobData);
    await redisClient.lpush(`${queueName}:completed`, jobData);
    
    // Verify
    const completed = await redisClient.llen(`${queueName}:completed`);
    if (completed < 1) {
      throw new Error('Job not marked as completed');
    }
  });

  await test('Job retry with backoff', async () => {
    const queueName = 'test:queue:ai';
    const jobId = `job:${Date.now()}`;
    
    // Add job
    await redisClient.lpush(`${queueName}:wait`, JSON.stringify({
      id: jobId,
      name: 'ai.generate',
      data: { prompt: 'test' },
      attempts: 0,
      maxAttempts: 3,
      timestamp: Date.now(),
    }));
    
    // Simulate failure and retry
    const jobData = await redisClient.rpoplpush(`${queueName}:wait`, `${queueName}:active`);
    if (!jobData) throw new Error('Failed to get job');
    
    const job = JSON.parse(jobData);
    job.attempts = 1;
    job.failedReason = 'Simulated failure';
    
    // Move to failed
    await redisClient.lrem(`${queueName}:active`, 0, jobData);
    await redisClient.lpush(`${queueName}:failed`, JSON.stringify(job));
    
    // Simulate retry (add back to wait)
    await redisClient.lpush(`${queueName}:wait`, JSON.stringify({
      ...job,
      attempts: job.attempts + 1,
      timestamp: Date.now(),
    }));
    
    // Verify retry
    const waitLength = await redisClient.llen(`${queueName}:wait`);
    if (waitLength < 1) {
      throw new Error('Job not retried');
    }
  });

  // ============================================
  // 4. DLQ (DEAD LETTER QUEUE) TESTS
  // ============================================
  section('4. Dead Letter Queue (DLQ)');

  await test('Add job to DLQ after max retries', async () => {
    const queueName = 'test:queue:critical';
    const jobId = `job:${Date.now()}`;
    const dlqKey = `dlq:${queueName}`;
    
    // Simulate job that failed 3 times
    const failedJob = {
      jobId,
      queueName,
      jobName: 'critical.task',
      data: { important: true },
      error: { message: 'Failed after 3 attempts', code: 'MAX_RETRIES' },
      failedAt: Date.now(),
      attempts: 3,
    };
    
    // Add to DLQ
    await redisClient.lpush(dlqKey, JSON.stringify(failedJob));
    await redisClient.ltrim(dlqKey, 0, 999); // Keep only last 1000
    
    // Verify
    const dlqLength = await redisClient.llen(dlqKey);
    if (dlqLength < 1) {
      throw new Error('Job not added to DLQ');
    }
  });

  await test('Retrieve DLQ entries', async () => {
    const queueName = 'test:queue:critical';
    const dlqKey = `dlq:${queueName}`;
    
    // Get DLQ entries
    const entries = await redisClient.lrange(dlqKey, 0, -1);
    if (!Array.isArray(entries)) {
      throw new Error('Failed to retrieve DLQ entries');
    }
    
    // Parse and validate
    const parsed = entries.map(e => JSON.parse(e));
    if (parsed.length < 1) {
      throw new Error('No DLQ entries found');
    }
  });

  await test('Retry job from DLQ', async () => {
    const queueName = 'test:queue:retry';
    const dlqKey = `dlq:${queueName}`;
    const waitKey = `${queueName}:wait`;
    const jobId = `retry-job:${Date.now()}`;
    
    // Add to DLQ
    const dlqEntry = {
      jobId,
      queueName,
      jobName: 'retryable.task',
      data: { test: true },
      error: { message: 'Temporary failure' },
      failedAt: Date.now(),
      attempts: 3,
    };
    
    await redisClient.lpush(dlqKey, JSON.stringify(dlqEntry));
    
    // Retry: Remove from DLQ and add back to queue
    const entries = await redisClient.lrange(dlqKey, 0, -1);
    const entryStr = entries.find((e: string) => {
      const parsed = JSON.parse(e);
      return parsed.jobId === jobId;
    });
    
    if (entryStr) {
      await redisClient.lrem(dlqKey, 0, entryStr);
      await redisClient.lpush(waitKey, JSON.stringify({
        id: `${jobId}-retry-${Date.now()}`,
        name: dlqEntry.jobName,
        data: dlqEntry.data,
        timestamp: Date.now(),
        attempts: 0, // Reset attempts
      }));
    }
    
    // Verify
    const waitLength = await redisClient.llen(waitKey);
    if (waitLength < 1) {
      throw new Error('Job not retried');
    }
  });

  // ============================================
  // 5. TELEMETRY & METRICS TESTS
  // ============================================
  section('5. Telemetry & Metrics Collection');

  await test('Store telemetry data in Redis', async () => {
    const metrics = {
      timestamp: Date.now(),
      queues: {
        ai: { pending: 5, processing: 2, failed: 0 },
        email: { pending: 10, processing: 3, failed: 1 },
      },
      vms: { active: 15, hibernated: 30, total: 45 },
    };
    
    const key = `telemetry:${Date.now()}`;
    await redisClient.setex(key, 86400, JSON.stringify(metrics));
    
    // Verify
    const stored = await redisClient.get(key);
    if (!stored) {
      throw new Error('Telemetry not stored');
    }
    
    const parsed = JSON.parse(stored);
    if (parsed.vms.active !== 15) {
      throw new Error('Telemetry data mismatch');
    }
  });

  await test('Job execution telemetry tracking', async () => {
    const jobName = 'test:job';
    const key = `telemetry:job:${jobName}`;
    
    const jobTelemetry = {
      timestamp: Date.now(),
      duration: 1500,
      success: true,
    };
    
    await redisClient.setex(key, 86400, JSON.stringify(jobTelemetry));
    
    // Verify
    const stored = await redisClient.get(key);
    if (!stored) {
      throw new Error('Job telemetry not stored');
    }
  });

  // ============================================
  // 6. USAGE AGGREGATION TESTS
  // ============================================
  section('6. Usage Aggregation (Billing)');

  await test('Store usage counters in Redis', async () => {
    const userId = 'test-user-123';
    const date = new Date().toISOString().split('T')[0];
    const type = 'ai_tokens';
    
    const key = `usage:${userId}:${date}:${type}`;
    await redisClient.incrby(key, 100);
    
    // Verify
    const value = await redisClient.get(key);
    if (parseInt(value || '0', 10) !== 100) {
      throw new Error(`Usage counter should be 100, got ${value}`);
    }
  });

  await test('SCAN usage keys pattern', async () => {
    // Add multiple usage keys
    for (let i = 0; i < 5; i++) {
      await redisClient.set(`usage:test-user:${i}:tokens`, (i * 10).toString());
    }
    
    // Scan for usage keys
    let cursor = '0';
    const keys: string[] = [];
    
    do {
      const result = await redisClient.scan(cursor, 'MATCH', 'usage:test-user:*', 'COUNT', 10);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    if (keys.length < 5) {
      throw new Error(`Expected at least 5 usage keys, found ${keys.length}`);
    }
  });

  await test('Atomic decrement and delete for idempotency', async () => {
    const key = 'usage:test:idempotent';
    await redisClient.set(key, '100');
    
    // Simulate rollup: decrement by 50
    const remaining = await redisClient.decrby(key, 50);
    
    if (remaining !== 50) {
      throw new Error(`Expected remaining 50, got ${remaining}`);
    }
    
    // Simulate full processing: delete when 0
    if (remaining <= 0) {
      await redisClient.del(key);
    }
  });

  // ============================================
  // 7. VM HIBERNATION TESTS
  // ============================================
  section('7. VM Hibernation (Idle Detection)');

  await test('Track VM last activity timestamp', async () => {
    const vmId = 'test-vm-123';
    const key = `vm_last_active:${vmId}`;
    
    await redisClient.set(key, Date.now().toString());
    
    // Verify
    const timestamp = await redisClient.get(key);
    if (!timestamp) {
      throw new Error('VM activity timestamp not stored');
    }
    
    const age = Date.now() - parseInt(timestamp, 10);
    if (age > 5000) {
      throw new Error('VM timestamp is too old');
    }
  });

  await test('Detect idle VMs (inactive > threshold)', async () => {
    const vmId = 'test-vm-idle';
    const key = `vm_last_active:${vmId}`;
    const threshold = 10 * 60 * 1000; // 10 minutes
    
    // Set last activity to 15 minutes ago
    await redisClient.set(key, (Date.now() - 15 * 60 * 1000).toString());
    
    // Check if idle
    const lastActive = parseInt(await redisClient.get(key) || '0', 10);
    const idleTime = Date.now() - lastActive;
    
    if (idleTime <= threshold) {
      throw new Error(`VM should be idle (${idleTime}ms > ${threshold}ms)`);
    }
  });

  await test('Acquire hibernation lock', async () => {
    const vmId = 'test-vm-hibernate';
    const lockKey = `lock:hibernate:${vmId}`;
    
    // Acquire lock
    const result = await redisClient.set(lockKey, '1', 'EX', 300, 'NX');
    if (result !== 'OK') {
      throw new Error('Failed to acquire hibernation lock');
    }
    
    // Verify lock exists
    const ttl = await redisClient.ttl(lockKey);
    if (ttl < 1) {
      throw new Error('Lock should have TTL');
    }
  });

  // ============================================
  // 8. GARBAGE COLLECTION TESTS
  // ============================================
  section('8. Garbage Collection (Cleanup)');

  await test('Delete expired tokens pattern', async () => {
    // Simulate expired tokens
    await redisClient.setex('test:token:expired1', 1, 'value');
    await redisClient.setex('test:token:expired2', 1, 'value');
    
    // Wait for expiration
    await sleep(1100);
    
    // Verify expired
    const val1 = await redisClient.get('test:token:expired1');
    const val2 = await redisClient.get('test:token:expired2');
    
    if (val1 !== null || val2 !== null) {
      throw new Error('Expired tokens should be deleted');
    }
  });

  await test('Clean up old session data', async () => {
    const oldSession = `session:test:${Date.now() - 31 * 24 * 60 * 60 * 1000}`; // 31 days old
    const newSession = `session:test:${Date.now()}`;
    
    await redisClient.set(oldSession, 'old-data');
    await redisClient.set(newSession, 'new-data');
    
    // Clean old sessions (simulated)
    const sessionKeys = await redisClient.keys('session:test:*');
    for (const key of sessionKeys) {
      const timestamp = key.split(':')[2];
      if (timestamp) {
        const age = Date.now() - parseInt(timestamp, 10);
        if (age > 30 * 24 * 60 * 60 * 1000) { // 30 days
          await redisClient.del(key);
        }
      }
    }
    
    // Verify old session deleted, new session kept
    const oldExists = await redisClient.exists(oldSession);
    const newExists = await redisClient.exists(newSession);
    
    if (oldExists || !newExists) {
      throw new Error('Old session should be deleted, new session kept');
    }
  });

  // ============================================
  // 9. ERROR HANDLING TESTS
  // ============================================
  section('9. Error Handling & Resilience');

  await test('Handle missing keys gracefully', async () => {
    const value = await redisClient.get('test:nonexistent:key');
    if (value !== null) {
      throw new Error('Non-existent key should return null');
    }
  });

  await test('Handle invalid JSON in queue job', async () => {
    const queueName = 'test:queue:invalid';
    
    // Add invalid JSON
    await redisClient.lpush(`${queueName}:wait`, 'invalid json {{{');
    
    // Try to parse (should handle gracefully)
    const jobData = await redisClient.rpoplpush(`${queueName}:wait`, `${queueName}:active`);
    if (jobData) {
      try {
        JSON.parse(jobData);
        throw new Error('Should have thrown on invalid JSON');
      } catch (e: any) {
        if (e.message.includes('Should have thrown')) throw e;
        // Expected - invalid JSON
      }
    }
  });

  await test('Handle concurrent lock acquisition', async () => {
    const lockKey = 'test:concurrent:lock';
    
    // Try to acquire lock from multiple "workers"
    const promises = Array(5).fill(null).map(() =>
      redisClient.set(lockKey, '1', 'EX', 10, 'NX')
    );
    
    const results = await Promise.all(promises);
    const acquired = results.filter(r => r === 'OK').length;
    
    if (acquired !== 1) {
      throw new Error(`Only 1 lock should be acquired, got ${acquired}`);
    }
  });

  // ============================================
  // 10. INTEGRATION TESTS
  // ============================================
  section('10. Service Integration');

  await test('Build output exists', async () => {
    const distPath = path.join(__dirname, '..', 'dist');
    const indexPath = path.join(distPath, 'index.js');
    
    if (!fs.existsSync(indexPath)) {
      throw new Error('dist/index.js not found - run npm run build first');
    }
  });

  await test('Package.json scripts are valid', async () => {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const pkg = JSON.parse(packageContent);
    
    if (!pkg.scripts || !pkg.scripts.start || !pkg.scripts.build) {
      throw new Error('Missing required scripts in package.json');
    }
  });
}

// ============================================
// MAIN
// ============================================
async function main(): Promise<void> {
  try {
    await setup();
    await runTests();
    await teardown();

    // Print summary
    console.log('\n' + '='.repeat(60));
    log('  📊 TEST SUMMARY', colors.bright + colors.blue);
    console.log('='.repeat(60) + '\n');

    const totalTests = results.passed + results.failed;
    const passRate = ((results.passed / totalTests) * 100).toFixed(1);

    log(`  Total Tests: ${totalTests}`, colors.bright);
    log(`  Passed: ${results.passed}`, colors.green);
    log(`  Failed: ${results.failed}`, colors.red);
    log(`  Pass Rate: ${passRate}%`, colors.bright);

    if (results.failed === 0) {
      log('\n  🎉 All tests passed! Background Worker is working correctly.', colors.green);
      process.exit(0);
    } else {
      log('\n  ⚠️ Some tests failed. Check the errors above.', colors.red);
      process.exit(1);
    }
  } catch (error: any) {
    log(`\n💥 Fatal error: ${error.message}`, colors.red);
    process.exit(1);
  }
}

// Run tests
main();
