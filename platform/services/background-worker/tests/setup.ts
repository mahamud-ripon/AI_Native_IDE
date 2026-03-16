// Test environment setup
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set default test environment
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/ai_ide_test';

// Increase test timeout
jest.setTimeout(30000);

// Global test utilities
declare global {
  var testRedis: any;
  var testPrisma: any;
}

// Setup before all tests
beforeAll(async () => {
  console.log('🧪 Test environment initialized');
});

// Cleanup after all tests
afterAll(async () => {
  console.log('🧹 Test environment cleaned up');
});
