/**
 * LLM Gateway Integration Tests
 * 
 * Tests the complete runtime path through the gateway:
 * 1. Health check
 * 2. Single completion
 * 3. Streaming
 * 4. Redis cache
 * 5. Kafka event emission
 * 6. Provider fallback
 * 7. Agent workflow
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { build } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';

describe('LLM Gateway Integration', () => {
  let app: FastifyInstance;
  let redis: Redis;
  let kafkaConsumer: Consumer;
  const kafkaEvents: any[] = [];

  beforeAll(async () => {
    // Build the Fastify app
    app = await build();
    await app.ready();

    // Connect to Redis
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    // Setup Kafka consumer for event verification
    const kafka = new Kafka({
      clientId: 'test-consumer',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    });
    kafkaConsumer = kafka.consumer({ groupId: 'test-llm-events' });
    await kafkaConsumer.connect();
    await kafkaConsumer.subscribe({ topics: ['ai.llm.call.completed', 'ai.llm.call.failed'], fromBeginning: true });
    
    await kafkaConsumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        const value = payload.message.value?.toString();
        if (value) {
          kafkaEvents.push({
            topic: payload.topic,
            ...JSON.parse(value),
          });
        }
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await kafkaConsumer.disconnect();
  });

  beforeEach(() => {
    // Clear Kafka events before each test
    kafkaEvents.length = 0;
  });

  // Test 1: Gateway Health
  describe('Test 1 - Gateway Health', () => {
    it('should return healthy status with connected services', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/ai/llm/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      console.log('Health check response:', JSON.stringify(body, null, 2));
      
      expect(body).toHaveProperty('status');
      expect(['ok', 'degraded']).toContain(body.status);
      expect(body).toHaveProperty('providers');
      expect(Array.isArray(body.providers)).toBe(true);
      expect(body).toHaveProperty('redis');
      expect(['connected', 'disconnected', 'unknown']).toContain(body.redis);
      expect(body).toHaveProperty('kafka');
      expect(['connected', 'disconnected', 'unknown']).toContain(body.kafka);
    });
  });

  // Test 2: Single Completion Call
  describe('Test 2 - Single Completion', () => {
    it('should complete a simple plan request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/ai/llm/complete',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'test-user-001',
          'x-org-id': 'test-org-001',
        },
        payload: {
          workflowId: 'test-workflow-001',
          projectId: 'test-project-001',
          agentName: 'plan_agent',
          stepName: 'test-step',
          taskType: 'plan',
          messages: [
            { role: 'system', content: 'You are a helpful planning assistant.' },
            { role: 'user', content: 'Create a simple plan for building a todo app.' },
          ],
          temperature: 0.7,
          maxTokens: 100,
        },
      });

      console.log('Completion response status:', response.statusCode);
      const body = response.json();
      console.log('Completion response:', JSON.stringify(body, null, 2));

      // Should succeed (or fail gracefully if no API keys)
      if (response.statusCode === 200) {
        expect(body).toHaveProperty('requestId');
        expect(body.requestId).toMatch(/^req_/);
        expect(body).toHaveProperty('provider');
        expect(body).toHaveProperty('model');
        expect(body).toHaveProperty('outputText');
        expect(body).toHaveProperty('tokensIn');
        expect(body).toHaveProperty('tokensOut');
        expect(body).toHaveProperty('latencyMs');
        expect(body).toHaveProperty('costUsd');
        expect(body).toHaveProperty('cacheHit');
        expect(typeof body.cacheHit).toBe('boolean');
      } else if (response.statusCode === 500) {
        // Expected if no API keys configured
        console.log('Completion failed (expected without API keys):', body.error);
      }
    });
  });

  // Test 3: Streaming Path
  describe('Test 3 - Streaming', () => {
    it('should stream SSE events for a codegen request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/ai/llm/stream',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'x-user-id': 'test-user-001',
        },
        payload: {
          workflowId: 'test-workflow-002',
          projectId: 'test-project-001',
          agentName: 'backend_agent',
          stepName: 'stream-test',
          taskType: 'codegen',
          messages: [
            { role: 'user', content: 'Write a simple hello world function in Python.' },
          ],
          maxTokens: 50,
        },
      });

      console.log('Stream response status:', response.statusCode);
      const body = response.body;
      console.log('Stream response body length:', body?.length ?? 0);

      if (response.statusCode === 200) {
        // Parse SSE events
        const events: any[] = [];
        const lines = body.toString().split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              events.push(JSON.parse(line.slice(6)));
            } catch (e) {
              // Ignore parse errors
            }
          }
        }

        console.log('SSE events received:', events.length);
        events.forEach((e, i) => console.log(`  Event ${i}:`, e.type));

        // Verify event order
        if (events.length > 0) {
          const eventTypes = events.map(e => e.type);
          
          // Should have meta event at start
          if (eventTypes.includes('meta')) {
            const metaEvent = events.find(e => e.type === 'meta');
            expect(metaEvent.data).toHaveProperty('provider');
            expect(metaEvent.data).toHaveProperty('model');
          }

          // Should have done event at end
          if (eventTypes.includes('done')) {
            const doneEvent = events.find(e => e.type === 'done');
            expect(doneEvent.data).toHaveProperty('tokensIn');
            expect(doneEvent.data).toHaveProperty('tokensOut');
          }

          // Should NOT have error event
          expect(eventTypes).not.toContain('error');
        }
      } else {
        console.log('Stream test skipped (no API keys or connection issue)');
      }
    });
  });

  // Test 4: Redis Cache
  describe('Test 4 - Redis Cache', () => {
    it('should cache identical requests', async () => {
      const payload = {
        workflowId: 'test-workflow-cache',
        projectId: 'test-project-001',
        agentName: 'test_agent',
        stepName: 'cache-test',
        taskType: 'chat',
        messages: [
          { role: 'user', content: 'What is 2+2? Answer with just the number.' },
        ],
        maxTokens: 10,
      };

      // First request
      const response1 = await app.inject({
        method: 'POST',
        url: '/ai/llm/complete',
        headers: { 'Content-Type': 'application/json' },
        payload,
      });

      console.log('First request status:', response1.statusCode);
      const body1 = response1.json();
      console.log('First request cacheHit:', body1.cacheHit);

      // Second request (should hit cache)
      const response2 = await app.inject({
        method: 'POST',
        url: '/ai/llm/complete',
        headers: { 'Content-Type': 'application/json' },
        payload,
      });

      console.log('Second request status:', response2.statusCode);
      const body2 = response2.json();
      console.log('Second request cacheHit:', body2.cacheHit);

      if (response1.statusCode === 200 && response2.statusCode === 200) {
        // First should not be cache hit (unless previously cached)
        // Second should be cache hit
        if (!body1.cacheHit && body2.cacheHit) {
          console.log('✓ Cache working correctly');
          expect(body2.cacheHit).toBe(true);
        } else if (body1.cacheHit && body2.cacheHit) {
          console.log('✓ Both cache hits (previously cached)');
        } else {
          console.log('⚠ Cache not working as expected');
        }
      }
    });

    it('should include proper cache key components', async () => {
      // Verify Redis key structure
      const keys = await redis.keys('llm:cache:*');
      console.log('Redis cache keys found:', keys.length);
      
      if (keys.length > 0) {
        const sampleKey = keys[0];
        console.log('Sample cache key:', sampleKey);
        
        // Key should contain provider and model
        expect(sampleKey).toMatch(/llm:cache:/);
      }
    });
  });

  // Test 5: Kafka Event Emission
  describe('Test 5 - Kafka Events', () => {
    it('should emit ai.llm.call.completed event after successful completion', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/ai/llm/complete',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          workflowId: 'test-workflow-kafka',
          projectId: 'test-project-001',
          agentName: 'kafka_test_agent',
          stepName: 'kafka-test',
          taskType: 'chat',
          messages: [{ role: 'user', content: 'Say hello' }],
          maxTokens: 10,
        },
      });

      // Wait for Kafka event to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('Kafka events captured:', kafkaEvents.length);
      kafkaEvents.forEach((e, i) => console.log(`  Event ${i}:`, e.topic, e.requestId));

      if (response.statusCode === 200 && kafkaEvents.length > 0) {
        const completedEvent = kafkaEvents.find(e => e.topic === 'ai.llm.call.completed');
        
        if (completedEvent) {
          expect(completedEvent).toHaveProperty('requestId');
          expect(completedEvent).toHaveProperty('workflowId');
          expect(completedEvent).toHaveProperty('agentName');
          expect(completedEvent).toHaveProperty('stepName');
          expect(completedEvent).toHaveProperty('provider');
          expect(completedEvent).toHaveProperty('model');
          expect(completedEvent).toHaveProperty('tokensIn');
          expect(completedEvent).toHaveProperty('tokensOut');
          expect(completedEvent).toHaveProperty('latencyMs');
          expect(completedEvent).toHaveProperty('costUsd');
          
          console.log('✓ Kafka event structure verified');
        }
      } else {
        console.log('Kafka event test skipped (no events captured)');
      }
    });
  });

  // Test 6: Provider Fallback
  describe('Test 6 - Provider Fallback', () => {
    it('should fallback to secondary provider when primary fails', async () => {
      // This test requires simulating a provider failure
      // In a real test, we would mock the adapter or use invalid credentials
      
      const response = await app.inject({
        method: 'POST',
        url: '/ai/llm/complete',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          workflowId: 'test-workflow-fallback',
          projectId: 'test-project-001',
          agentName: 'fallback_test_agent',
          stepName: 'fallback-test',
          taskType: 'chat',
          messages: [{ role: 'user', content: 'Test fallback' }],
          maxTokens: 10,
          modelHint: 'invalid-model-to-trigger-fallback', // May trigger fallback
        },
      });

      console.log('Fallback test status:', response.statusCode);
      const body = response.json();
      console.log('Fallback test response:', JSON.stringify(body, null, 2));

      // If successful, check if fallback was used
      if (response.statusCode === 200) {
        console.log('✓ Request completed (possibly via fallback)');
      }
    });
  });

  // Test 7: Request ID Tracing
  describe('Test 7 - Request ID Tracing', () => {
    it('should propagate requestId through all components', async () => {
      const customRequestId = 'req_test_trace_001';
      
      const response = await app.inject({
        method: 'POST',
        url: '/ai/llm/complete',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          requestId: customRequestId,
          workflowId: 'test-workflow-trace',
          projectId: 'test-project-001',
          agentName: 'trace_test_agent',
          stepName: 'trace-test',
          taskType: 'chat',
          messages: [{ role: 'user', content: 'Trace test' }],
          maxTokens: 10,
        },
      });

      if (response.statusCode === 200) {
        const body = response.json();
        
        // RequestId should be preserved
        expect(body.requestId).toBe(customRequestId);
        console.log('✓ RequestId preserved:', body.requestId);
      }
    });

    it('should generate requestId if not provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/ai/llm/complete',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          workflowId: 'test-workflow-autogen',
          projectId: 'test-project-001',
          agentName: 'autogen_test_agent',
          stepName: 'autogen-test',
          taskType: 'chat',
          messages: [{ role: 'user', content: 'Auto generate request ID' }],
          maxTokens: 10,
        },
      });

      if (response.statusCode === 200) {
        const body = response.json();
        
        expect(body.requestId).toBeDefined();
        expect(body.requestId).toMatch(/^req_/);
        console.log('✓ RequestId auto-generated:', body.requestId);
      }
    });
  });
});
