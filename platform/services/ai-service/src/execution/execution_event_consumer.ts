/**
 * Execution Event Consumer
 *
 * Consumes execution events from Kafka topics and bridges them to:
 *   1. Redis Streams (for buffering/replay)
 *   2. Redis Pub/Sub (for real-time WebSocket delivery)
 *
 * Architecture:
 *   Kafka Topics → ExecutionEventConsumer → Redis Stream Buffer
 *                                        → Redis Pub/Sub → WebSocket Gateway
 *
 * Topics consumed:
 *   - ai.execution.lifecycle
 *   - ai.execution.progress
 *   - ai.execution.patches
 *
 * Redis Keys:
 *   - execution:events:{taskId}  → Stream buffer for replay
 *   - execution:task:{taskId}   → Pub/Sub channel
 *   - execution:workspace:{workspaceId}
 *   - execution:project:{projectId}
 *   - execution:user:{userId}
 */

import { Consumer, EachMessagePayload } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import Redis from 'ioredis';
import { config } from '../config.js';
import {
  ExecutionEvent,
  EXECUTION_KAFKA_TOPICS,
  EXECUTION_STREAM_KEYS,
  EXECUTION_CHANNELS,
  isTerminalEvent,
} from './execution_event_types.js';

// ========================================
// CONSUMER INSTANCES
// ========================================

let consumer: Consumer | null = null;
let redis: Redis | null = null;

// Consumer group ID
const CONSUMER_GROUP_ID = 'execution-events-consumer-group';

// Stream retention (events kept for 1 hour for replay)
const STREAM_RETENTION_MS = 60 * 60 * 1000;

// Maximum events per stream (prevents unbounded growth)
const MAX_STREAM_LENGTH = 1000;

// ========================================
// INITIALIZATION
// ========================================

/**
 * Initialize the execution event consumer
 */
export async function initExecutionEventConsumer(): Promise<void> {
  if (consumer && redis) {
    return;
  }

  // Initialize Redis
  redis = new Redis(config.redisUrl);
  console.log('[ExecutionEventConsumer] Connected to Redis');

  // Initialize Kafka consumer
  const kafka = createKafkaClient({ clientId: 'ai-service-execution-consumer', groupId: CONSUMER_GROUP_ID });

  consumer = kafka.consumer({
    groupId: CONSUMER_GROUP_ID,
    // Enable auto-commit for simplicity
    allowAutoTopicCreation: true,
  });

  await consumer.connect();
  console.log('[ExecutionEventConsumer] Connected to Kafka');

  // Subscribe to all execution event topics
  await consumer.subscribe({
    topic: EXECUTION_KAFKA_TOPICS.LIFECYCLE,
    fromBeginning: false,
  });

  await consumer.subscribe({
    topic: EXECUTION_KAFKA_TOPICS.PROGRESS,
    fromBeginning: false,
  });

  await consumer.subscribe({
    topic: EXECUTION_KAFKA_TOPICS.PATCHES,
    fromBeginning: false,
  });

  console.log('[ExecutionEventConsumer] Subscribed to topics:', [
    EXECUTION_KAFKA_TOPICS.LIFECYCLE,
    EXECUTION_KAFKA_TOPICS.PROGRESS,
    EXECUTION_KAFKA_TOPICS.PATCHES,
  ]);

  // Start processing messages
  await consumer.run({
    eachMessage: handleKafkaMessage,
  });

  console.log('[ExecutionEventConsumer] Started processing messages');
}

/**
 * Shutdown the execution event consumer
 */
export async function shutdownExecutionEventConsumer(): Promise<void> {
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
    console.log('[ExecutionEventConsumer] Disconnected from Kafka');
  }

  if (redis) {
    await redis.quit();
    redis = null;
    console.log('[ExecutionEventConsumer] Disconnected from Redis');
  }
}

/**
 * Get consumer status
 */
export function getConsumerStatus(): {
  isConnected: boolean;
  groupId: string;
  topics: string[];
} {
  return {
    isConnected: consumer !== null && redis !== null,
    groupId: CONSUMER_GROUP_ID,
    topics: [
      EXECUTION_KAFKA_TOPICS.LIFECYCLE,
      EXECUTION_KAFKA_TOPICS.PROGRESS,
      EXECUTION_KAFKA_TOPICS.PATCHES,
    ],
  };
}

// ========================================
// MESSAGE HANDLING
// ========================================

/**
 * Handle incoming Kafka message
 */
async function handleKafkaMessage(payload: EachMessagePayload): Promise<void> {
  const { topic, message } = payload;

  if (!message.value) {
    return;
  }

  try {
    // Parse event
    const event = JSON.parse(message.value.toString()) as ExecutionEvent;

    // Validate required fields
    if (!event.taskId || !event.type) {
      console.warn('[ExecutionEventConsumer] Invalid event, missing taskId or type');
      return;
    }

    // Process event
    await processEvent(event, topic);

  } catch (error) {
    console.error('[ExecutionEventConsumer] Error processing message:', error);
  }
}

/**
 * Process a single event
 */
async function processEvent(event: ExecutionEvent, topic: string): Promise<void> {
  if (!redis) {
    console.warn('[ExecutionEventConsumer] Redis not connected, skipping event');
    return;
  }

  const { taskId, projectId, workspaceId, userId } = event;

  // 1. Add to Redis Stream for buffering/replay
  const streamKey = EXECUTION_STREAM_KEYS.taskEvents(taskId);
  await addToStream(streamKey, event);

  // 2. Publish to Redis Pub/Sub channels
  const channels = [
    EXECUTION_CHANNELS.task(taskId),
    EXECUTION_CHANNELS.workspace(workspaceId),
    EXECUTION_CHANNELS.project(projectId),
    EXECUTION_CHANNELS.user(userId),
  ];

  const eventJson = JSON.stringify(event);

  for (const channel of channels) {
    await redis.publish(channel, eventJson);
  }

  // 3. Log for debugging
  console.log(`[ExecutionEventConsumer] Processed ${event.type} for task ${taskId}`);

  // 4. Handle terminal events (cleanup)
  if (isTerminalEvent(event)) {
    await handleTerminalEvent(event);
  }
}

/**
 * Add event to Redis Stream for buffering
 */
async function addToStream(streamKey: string, event: ExecutionEvent): Promise<void> {
  if (!redis) return;

  // Add event to stream
  const eventId = await redis.xadd(
    streamKey,
    'MAXLEN',
    '~',
    MAX_STREAM_LENGTH.toString(),
    '*',
    'data',
    JSON.stringify(event)
  );

  // Set expiry on stream
  await redis.pexpire(streamKey, STREAM_RETENTION_MS);
}

/**
 * Handle terminal event (task completed/failed)
 */
async function handleTerminalEvent(event: ExecutionEvent): Promise<void> {
  if (!redis) return;

  const { taskId } = event;

  // Keep stream for a while longer for replay, then it will expire
  // Optionally, we could schedule cleanup here

  console.log(`[ExecutionEventConsumer] Task ${taskId} reached terminal state: ${event.type}`);
}

// ========================================
// STREAM REPLAY (for reconnection)
// ========================================

/**
 * Get events for a task since a given sequence number
 * Used when frontend reconnects to replay missed events
 */
export async function getEventsSince(
  taskId: string,
  sinceSequence: number
): Promise<ExecutionEvent[]> {
  if (!redis) {
    throw new Error('ExecutionEventConsumer not initialized');
  }

  const streamKey = EXECUTION_STREAM_KEYS.taskEvents(taskId);

  // Read all events from stream
  const entries = await redis.xrange(streamKey, '-', '+');

  if (!entries || entries.length === 0) {
    return [];
  }

  // Parse and filter by sequence
  const events: ExecutionEvent[] = [];

  for (const [id, fields] of entries) {
    const dataIndex = fields.indexOf('data');
    if (dataIndex === -1) continue;

    const eventJson = fields[dataIndex + 1];
    if (!eventJson) continue;

    try {
      const event = JSON.parse(eventJson) as ExecutionEvent;
      if (event.sequence > sinceSequence) {
        events.push(event);
      }
    } catch {
      // Skip invalid events
    }
  }

  // Sort by sequence
  events.sort((a, b) => a.sequence - b.sequence);

  return events;
}

/**
 * Get all events for a task
 */
export async function getAllEvents(taskId: string): Promise<ExecutionEvent[]> {
  return getEventsSince(taskId, -1);
}

/**
 * Get latest event for a task
 */
export async function getLatestEvent(taskId: string): Promise<ExecutionEvent | null> {
  if (!redis) {
    throw new Error('ExecutionEventConsumer not initialized');
  }

  const streamKey = EXECUTION_STREAM_KEYS.taskEvents(taskId);

  // Get latest entry from stream using raw command
  const entries = await redis.sendCommand(
    new (require('ioredis').Command)(
      'XREVRANGE',
      [streamKey, '+', '-', 'COUNT', 1]
    )
  ) as Array<[string, string[]]>;

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  const [id, fields] = entries[0];
  const dataIndex = fields.indexOf('data');
  if (dataIndex === -1) return null;

  const eventJson = fields[dataIndex + 1];
  if (!eventJson) return null;

  try {
    return JSON.parse(eventJson) as ExecutionEvent;
  } catch {
    return null;
  }
}

// ========================================
// HEALTH CHECK
// ========================================

/**
 * Check if consumer is healthy
 */
export async function healthCheck(): Promise<{
  kafka: boolean;
  redis: boolean;
  canConsume: boolean;
}> {
  const kafka = consumer !== null;
  const redisOk = redis !== null && redis.status === 'ready';

  return {
    kafka,
    redis: redisOk,
    canConsume: kafka && redisOk,
  };
}
