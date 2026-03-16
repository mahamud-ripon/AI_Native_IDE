/**
 * Execution Event Producer
 *
 * Publishes execution events to Kafka topics with proper partitioning.
 * Uses taskId as partition key to guarantee ordering within a task.
 *
 * Architecture:
 *   Execution Worker → ExecutionEventProducer → Kafka Topics
 *
 * Topics:
 *   - ai.execution.lifecycle  → Critical state changes
 *   - ai.execution.progress   → Frequent progress updates
 *   - ai.execution.patches    → File modification details
 *
 * Ordering Guarantee:
 *   All events for same taskId → same partition → ordered consumption
 */

import { Kafka, Producer, Message } from 'kafkajs';
import { config } from '../config.js';
import {
  ExecutionEvent,
  KafkaExecutionMessage,
  EXECUTION_KAFKA_TOPICS,
  getTopicForEvent,
  isTerminalEvent,
} from './execution_event_types.js';

// ========================================
// PRODUCER INSTANCE
// ========================================

let producer: Producer | null = null;
let sequenceCounter = new Map<string, number>();

/**
 * Initialize the execution event producer
 */
export async function initExecutionEventProducer(): Promise<void> {
  if (producer) {
    return;
  }

  const kafka = new Kafka({
    clientId: 'ai-service-execution-producer',
    brokers: config.kafkaBrokers.split(','),
  });

  producer = kafka.producer({
    // Enable idempotent producer for exactly-once semantics
    maxInFlightRequests: 5,
    idempotent: true,
    // Batch settings for throughput
    allowAutoTopicCreation: true,
    transactionTimeout: 30000,
  });

  await producer.connect();
  console.log('[ExecutionEventProducer] Connected to Kafka');
}

/**
 * Shutdown the execution event producer
 */
export async function shutdownExecutionEventProducer(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
    sequenceCounter.clear();
    console.log('[ExecutionEventProducer] Disconnected from Kafka');
  }
}

/**
 * Get producer status
 */
export function getProducerStatus(): { isConnected: boolean; activeTasks: number } {
  return {
    isConnected: producer !== null,
    activeTasks: sequenceCounter.size,
  };
}

// ========================================
// SEQUENCE NUMBER MANAGEMENT
// ========================================

/**
 * Get next sequence number for a task
 */
function getNextSequence(taskId: string): number {
  const current = sequenceCounter.get(taskId) ?? 0;
  const next = current + 1;
  sequenceCounter.set(taskId, next);
  return next;
}

/**
 * Clear sequence counter for a completed task
 */
function clearSequence(taskId: string): void {
  sequenceCounter.delete(taskId);
}

// ========================================
// EVENT EMISSION
// ========================================

/**
 * Emit a single execution event
 *
 * @param event - The event to emit (without timestamp and sequence)
 * @returns The full event with timestamp and sequence populated
 */
export async function emitEvent(
  event: Omit<ExecutionEvent, 'timestamp' | 'sequence'>
): Promise<ExecutionEvent> {
  if (!producer) {
    throw new Error('ExecutionEventProducer not initialized');
  }

  const taskId = event.taskId;

  // Add timestamp and sequence
  const fullEvent: ExecutionEvent = {
    ...event,
    timestamp: Date.now(),
    sequence: getNextSequence(taskId),
  } as ExecutionEvent;

  // Determine topic
  const topic = getTopicForEvent(fullEvent);

  // Create Kafka message with partition key
  const message: Message = {
    key: taskId, // Partition key for ordering
    value: JSON.stringify(fullEvent),
    timestamp: fullEvent.timestamp.toString(),
    headers: {
      'event-type': fullEvent.type,
      'task-id': taskId,
      'project-id': event.projectId,
    },
  };

  // Send to Kafka
  await producer.send({
    topic,
    messages: [message],
  });

  // Clean up sequence counter for terminal events
  if (isTerminalEvent(fullEvent)) {
    clearSequence(taskId);
  }

  return fullEvent;
}

/**
 * Emit multiple events in a batch
 * More efficient for high-frequency events
 */
export async function emitEventBatch(
  events: Array<Omit<ExecutionEvent, 'timestamp' | 'sequence'>>
): Promise<ExecutionEvent[]> {
  if (!producer) {
    throw new Error('ExecutionEventProducer not initialized');
  }

  if (events.length === 0) {
    return [];
  }

  // Group events by topic
  const eventsByTopic = new Map<string, Array<{ event: ExecutionEvent; taskId: string }>>();

  for (const event of events) {
    const taskId = event.taskId;

    const fullEvent: ExecutionEvent = {
      ...event,
      timestamp: Date.now(),
      sequence: getNextSequence(taskId),
    } as ExecutionEvent;

    const topic = getTopicForEvent(fullEvent);

    if (!eventsByTopic.has(topic)) {
      eventsByTopic.set(topic, []);
    }
    eventsByTopic.get(topic)!.push({ event: fullEvent, taskId });
  }

  // Send to each topic
  const sendPromises = Array.from(eventsByTopic.entries()).map(async ([topic, items]) => {
    const messages: Message[] = items.map(({ event, taskId }) => ({
      key: taskId,
      value: JSON.stringify(event),
      timestamp: event.timestamp.toString(),
      headers: {
        'event-type': event.type,
        'task-id': taskId,
        'project-id': event.projectId,
      },
    }));

    await producer!.send({
      topic,
      messages,
    });
  });

  await Promise.all(sendPromises);

  // Clean up terminal events
  const fullEvents = Array.from(eventsByTopic.values()).flatMap(items =>
    items.map(item => item.event)
  );

  for (const event of fullEvents) {
    if (isTerminalEvent(event)) {
      clearSequence(event.taskId);
    }
  }

  return fullEvents;
}

// ========================================
// CONVENIENCE EMITTERS
// ========================================

/**
 * Emit task queued event
 */
export async function emitTaskQueued(
  taskId: string,
  projectId: string,
  workspaceId: string,
  userId: string,
  payload: TaskQueuedPayload,
  metadata?: Record<string, unknown>
): Promise<ExecutionEvent> {
  return emitEvent({
    taskId,
    projectId,
    workspaceId,
    userId,
    type: 'task.queued' as const,
    stage: 'queued' as const,
    progress: 0,
    payload,
    metadata: metadata ?? {},
  } as Omit<ExecutionEvent, 'timestamp' | 'sequence'>);
}

/**
 * Emit task started event
 */
export async function emitTaskStarted(
  taskId: string,
  projectId: string,
  workspaceId: string,
  userId: string,
  payload: TaskStartedPayload,
  metadata?: Record<string, unknown>
): Promise<ExecutionEvent> {
  return emitEvent({
    taskId,
    projectId,
    workspaceId,
    userId,
    type: 'task.started' as const,
    stage: 'planning' as const,
    progress: 5,
    payload,
    metadata: metadata ?? {},
  } as Omit<ExecutionEvent, 'timestamp' | 'sequence'>);
}

/**
 * Emit progress update event
 */
export async function emitProgressUpdate(
  taskId: string,
  projectId: string,
  workspaceId: string,
  userId: string,
  stage: string,
  progress: number,
  message: string,
  detail?: string,
  metadata?: Record<string, unknown>
): Promise<ExecutionEvent> {
  return emitEvent({
    taskId,
    projectId,
    workspaceId,
    userId,
    type: 'progress.update' as const,
    stage: stage as any,
    progress,
    payload: { message, detail },
    metadata: metadata ?? {},
  } as Omit<ExecutionEvent, 'timestamp' | 'sequence'>);
}

/**
 * Emit patch generated event
 */
export async function emitPatchGenerated(
  taskId: string,
  projectId: string,
  workspaceId: string,
  userId: string,
  payload: PatchGeneratedPayload,
  metadata?: Record<string, unknown>
): Promise<ExecutionEvent> {
  return emitEvent({
    taskId,
    projectId,
    workspaceId,
    userId,
    type: 'patch.generated' as const,
    stage: 'execution' as const,
    progress: payload.progress,
    payload: {
      file: payload.file,
      linesAdded: payload.linesAdded,
      linesRemoved: payload.linesRemoved,
      patchHash: payload.patchHash,
      preview: payload.preview?.slice(0, 200), // Truncate preview
    },
    metadata: metadata ?? {},
  } as Omit<ExecutionEvent, 'timestamp' | 'sequence'>);
}

/**
 * Emit file modified event
 */
export async function emitFileModified(
  taskId: string,
  projectId: string,
  workspaceId: string,
  userId: string,
  payload: FileModifiedPayload,
  metadata?: Record<string, unknown>
): Promise<ExecutionEvent> {
  return emitEvent({
    taskId,
    projectId,
    workspaceId,
    userId,
    type: 'file.modified' as const,
    stage: 'application' as const,
    progress: payload.progress,
    payload: {
      file: payload.file,
      linesAdded: payload.linesAdded,
      linesRemoved: payload.linesRemoved,
      contentHash: payload.contentHash,
      operation: payload.operation,
    },
    metadata: metadata ?? {},
  } as Omit<ExecutionEvent, 'timestamp' | 'sequence'>);
}

/**
 * Emit task completed event
 */
export async function emitTaskCompleted(
  taskId: string,
  projectId: string,
  workspaceId: string,
  userId: string,
  payload: TaskCompletedPayload,
  metadata?: Record<string, unknown>
): Promise<ExecutionEvent> {
  return emitEvent({
    taskId,
    projectId,
    workspaceId,
    userId,
    type: 'task.completed' as const,
    stage: 'completed' as const,
    progress: 100,
    payload,
    metadata: metadata ?? {},
  } as Omit<ExecutionEvent, 'timestamp' | 'sequence'>);
}

/**
 * Emit task failed event
 */
export async function emitTaskFailed(
  taskId: string,
  projectId: string,
  workspaceId: string,
  userId: string,
  payload: TaskFailedPayload,
  metadata?: Record<string, unknown>
): Promise<ExecutionEvent> {
  return emitEvent({
    taskId,
    projectId,
    workspaceId,
    userId,
    type: 'task.failed' as const,
    stage: 'failed' as const,
    progress: payload.progress ?? 0,
    payload,
    metadata: metadata ?? {},
  } as Omit<ExecutionEvent, 'timestamp' | 'sequence'>);
}

// ========================================
// PAYLOAD TYPES
// ========================================

interface TaskQueuedPayload {
  instruction: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  timeoutMs: number;
  branch?: string;
}

interface TaskStartedPayload {
  instruction: string;
  workerId: string;
  estimatedDurationMs?: number;
}

interface PatchGeneratedPayload {
  file: string;
  linesAdded: number;
  linesRemoved: number;
  patchHash: string;
  progress: number;
  preview?: string;
}

interface FileModifiedPayload {
  file: string;
  linesAdded: number;
  linesRemoved: number;
  contentHash: string;
  operation: 'created' | 'modified' | 'deleted';
  progress: number;
}

interface TaskCompletedPayload {
  filesModified: number;
  linesAdded: number;
  linesRemoved: number;
  durationMs: number;
  snapshotId?: string;
}

interface TaskFailedPayload {
  error: {
    code: string;
    message: string;
    stage: string;
    recoverable: boolean;
  };
  rollbackPerformed: boolean;
  retryCount: number;
  maxRetries: number;
  progress?: number;
}
