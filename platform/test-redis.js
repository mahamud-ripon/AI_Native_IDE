const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'rediss://default:qvyvl5eQ8npmBP5NhnTQg1UFPYljfy9KTVuPHmwx3pYR81wYZNV2hVabphfKHHBe@hntcud18n5iatt2p0k6lwv11:6380/0';

console.log('Testing Redis connection...');
console.log('URL:', redisUrl.replace(/:([^@]+)@/, ':***@'));

const redis = new Redis(redisUrl, {
  tls: { rejectUnauthorized: false },
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  connectTimeout: 10000,
});

redis.on('connect', () => {
  console.log('✓ Connected to Redis');
});

redis.on('ready', () => {
  console.log('✓ Redis ready');
});

redis.on('error', (err) => {
  console.error('✗ Redis error:', err.message);
});

async function testRedis() {
  try {
    // Test write
    await redis.set('test:key', 'Hello from Redis!');
    console.log('✓ Write test passed');

    // Test read
    const value = await redis.get('test:key');
    console.log('✓ Read test passed - Value:', value);

    // Test delete
    await redis.del('test:key');
    console.log('✓ Delete test passed');

    // Test queue operation
    await redis.lpush('test:queue', 'item1', 'item2');
    const queueLen = await redis.llen('test:queue');
    console.log('✓ Queue test passed - Length:', queueLen);

    await redis.del('test:queue');

    console.log('\n✅ All Redis tests passed!');
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Test failed:', err.message);
    process.exit(1);
  }
}

// Run test after a short delay to allow connection
setTimeout(() => {
  testRedis();
}, 2000);