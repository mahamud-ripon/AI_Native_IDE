/**
 * Workflow Worker
 * 
 * Kafka consumer that executes workflows asynchronously.
 * Handles start, resume, and cancel commands.
 */

import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import Redis from 'ioredis';
import { config } from '../../config.js';
import { getWorkflowEngine } from '../engine/workflow_engine.js';
import { getWorkflowRegistry } from '../registry.js';
import { prisma } from '@workspace/database';

// Kafka configuration
const kafka = new Kafka({
  clientId: 'ai-service-workflow-worker',
  brokers: config.kafkaBrokers.split(','),
});

// Redis for distributed locking
const redis = new Redis(config.redisUrl);

// Lock configuration
const LOCK_TTL_SECONDS = 60;
const LOCK_PREFIX = 'workflow:lock:';

// Topics
const TOPICS = {
  WORKFLOW_START: 'workflow.start',
  WORKFLOW_RESUME: 'workflow.resume',
  WORKFLOW_CANCEL: 'workflow.cancel',
} as const;

// Message types
interface WorkflowStartMessage {
  workflowRunId: string;
  workflowName: string;
  projectId: string;
  userId?: string;
  initialContext?: Record<string, unknown>;
}

interface WorkflowResumeMessage {
  workflowRunId: string;
  fromStep?: number;
  skipCompleted?: boolean;
  retryFailed?: boolean;
}

interface WorkflowCancelMessage {
  workflowRunId: string;
  reason?: string;
}

let consumer: Consumer | null = null;
let isRunning = false;

/**
 * Acquire distributed lock for workflow execution
 */
async function acquireLock(workflowRunId: string): Promise<boolean> {
  const lockKey = `${LOCK_PREFIX}${workflowRunId}`;
  const result = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
  return result === 'OK';
}

/**
 * Release distributed lock
 */
async function releaseLock(workflowRunId: string): Promise<void> {
  const lockKey = `${LOCK_PREFIX}${workflowRunId}`;
  await redis.del(lockKey);
}

/**
 * Extend lock TTL (call during long-running steps)
 */
async function extendLock(workflowRunId: string): Promise<void> {
  const lockKey = `${LOCK_PREFIX}${workflowRunId}`;
  await redis.expire(lockKey, LOCK_TTL_SECONDS);
}

/**
 * Execute workflow to completion
 */
async function executeWorkflow(workflowRunId: string): Promise<void> {
  const engine = getWorkflowEngine();
  
  // Acquire lock
  if (!await acquireLock(workflowRunId)) {
    console.log(`[WorkflowWorker] Workflow ${workflowRunId} already being executed by another worker`);
    return;
  }

  try {
    console.log(`[WorkflowWorker] Starting execution loop for workflow ${workflowRunId}`);
    
    // Execute steps until complete
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;
    
    while (isRunning) {
      // Check workflow status
      const workflowRun = await prisma.workflowRun.findUnique({
        where: { id: workflowRunId },
        select: { status: true, currentStep: true, totalSteps: true },
      });

      if (!workflowRun) {
        console.log(`[WorkflowWorker] Workflow ${workflowRunId} not found`);
        break;
      }

      if (workflowRun.status === 'completed' ||
          workflowRun.status === 'failed' ||
          workflowRun.status === 'cancelled') {
        console.log(`[WorkflowWorker] Workflow ${workflowRunId} finished with status ${workflowRun.status}`);
        break;
      }

      if (workflowRun.status === 'paused') {
        console.log(`[WorkflowWorker] Workflow ${workflowRunId} paused`);
        break;
      }

      // Extend lock during execution
      await extendLock(workflowRunId);

      // Execute next step
      try {
        const result = await engine.executeNextStep(workflowRunId);
        
        if (!result) {
          // No more steps or workflow complete
          break;
        }

        consecutiveErrors = 0; // Reset error counter on success

        if (result.status === 'completed') {
          console.log(`[WorkflowWorker] Step completed: ${result.stepRunId}`);
        } else if (result.status === 'failed') {
          console.log(`[WorkflowWorker] Step failed: ${result.stepRunId} - ${result.error}`);
        }
      } catch (error) {
        consecutiveErrors++;
        console.error(`[WorkflowWorker] Step execution error (${consecutiveErrors}/${maxConsecutiveErrors}):`, error);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`[WorkflowWorker] Too many consecutive errors, stopping workflow ${workflowRunId}`);
          await prisma.workflowRun.update({
            where: { id: workflowRunId },
            data: {
              status: 'failed',
              errorMessage: 'Too many consecutive execution errors',
              completedAt: new Date(),
            },
          });
          break;
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } finally {
    // Release lock
    await releaseLock(workflowRunId);
    console.log(`[WorkflowWorker] Released lock for workflow ${workflowRunId}`);
  }
}

/**
 * Handle workflow.start message
 */
async function handleWorkflowStart(payload: EachMessagePayload): Promise<void> {
  const message: WorkflowStartMessage = JSON.parse(payload.message.value?.toString() || '{}');
  
  console.log(`[WorkflowWorker] Received workflow.start for ${message.workflowRunId}`);
  
  const engine = getWorkflowEngine();
  const registry = getWorkflowRegistry();
  
  // Register workflow definition if not already registered
  if (!registry.has(message.workflowName)) {
    console.warn(`[WorkflowWorker] Workflow ${message.workflowName} not registered, skipping`);
    return;
  }

  // Start workflow
  await engine.startWorkflow({
    projectId: message.projectId,
    workflowName: message.workflowName,
    userId: message.userId,
    initialContext: message.initialContext,
  });

  // Execute workflow
  await executeWorkflow(message.workflowRunId);
}

/**
 * Handle workflow.resume message
 */
async function handleWorkflowResume(payload: EachMessagePayload): Promise<void> {
  const message: WorkflowResumeMessage = JSON.parse(payload.message.value?.toString() || '{}');
  
  console.log(`[WorkflowWorker] Received workflow.resume for ${message.workflowRunId}`);
  
  const engine = getWorkflowEngine();
  
  // Resume workflow
  await engine.resumeWorkflow(message.workflowRunId, {
    fromStep: message.fromStep,
    skipCompleted: message.skipCompleted,
    retryFailed: message.retryFailed,
  });

  // Execute workflow
  await executeWorkflow(message.workflowRunId);
}

/**
 * Handle workflow.cancel message
 */
async function handleWorkflowCancel(payload: EachMessagePayload): Promise<void> {
  const message: WorkflowCancelMessage = JSON.parse(payload.message.value?.toString() || '{}');
  
  console.log(`[WorkflowWorker] Received workflow.cancel for ${message.workflowRunId}`);
  
  const engine = getWorkflowEngine();
  
  await engine.cancelWorkflow(message.workflowRunId, message.reason);
}

/**
 * Message handler router
 */
async function handleMessage(payload: EachMessagePayload): Promise<void> {
  const topic = payload.topic;

  switch (topic) {
    case TOPICS.WORKFLOW_START:
      await handleWorkflowStart(payload);
      break;
    case TOPICS.WORKFLOW_RESUME:
      await handleWorkflowResume(payload);
      break;
    case TOPICS.WORKFLOW_CANCEL:
      await handleWorkflowCancel(payload);
      break;
    default:
      console.warn(`[WorkflowWorker] Unknown topic: ${topic}`);
  }
}

/**
 * Start the workflow worker
 */
export async function startWorkflowWorker(): Promise<void> {
  if (consumer) {
    console.log('[WorkflowWorker] Already running');
    return;
  }

  console.log('[WorkflowWorker] Starting...');
  
  consumer = kafka.consumer({ groupId: 'workflow-worker' });
  
  await consumer.connect();
  console.log('[WorkflowWorker] Connected to Kafka');

  // Subscribe to topics
  await consumer.subscribe({ 
    topics: [
      TOPICS.WORKFLOW_START,
      TOPICS.WORKFLOW_RESUME,
      TOPICS.WORKFLOW_CANCEL,
    ],
    fromBeginning: false,
  });
  console.log('[WorkflowWorker] Subscribed to topics');

  isRunning = true;

  // Start consuming
  await consumer.run({
    eachMessage: async (payload) => {
      try {
        await handleMessage(payload);
      } catch (error) {
        console.error('[WorkflowWorker] Error handling message:', error);
      }
    },
  });

  console.log('[WorkflowWorker] Consumer running');
}

/**
 * Stop the workflow worker
 */
export async function stopWorkflowWorker(): Promise<void> {
  if (!consumer) {
    return;
  }

  console.log('[WorkflowWorker] Stopping...');
  
  isRunning = false;
  
  await consumer.disconnect();
  consumer = null;
  
  console.log('[WorkflowWorker] Stopped');
}

/**
 * Get worker status
 */
export function getWorkerStatus(): { isRunning: boolean } {
  return { isRunning };
}
