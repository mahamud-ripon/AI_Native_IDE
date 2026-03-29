/**
 * Execution Worker
 * 
 * Kafka consumer that executes coding tasks asynchronously.
 * Consumes from ai.execution.tasks and runs TaskOrchestrator.
 * 
 * Reliability features:
 * - Idempotent consumer guard (checks DB status before processing)
 * - Worker concurrency limit (semaphore)
 * - Distributed locking (Redis)
 */

import { Consumer, EachMessagePayload } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import Redis from 'ioredis';
import { config } from '../config.js';
import { getExecutionTaskService, ExecutionTaskService } from './execution_task_service.js';
import { getTaskOrchestrator, TaskOrchestrator } from '../coding/execution/task_orchestrator.js';
import { WorkspaceFS, RemoteWorkspaceFS, createRemoteWorkspace } from '../coding/workspace/index.js';
import { getDiffEngine } from '../coding/patch/index.js';
import { ExecutionTaskMessage, EXECUTION_STAGES, EXECUTION_KAFKA_TOPICS } from './execution_types.js';
import { ExecutionTaskStatus, ExecutionEventType } from '@prisma/client';

// Kafka configuration
const kafka = createKafkaClient({ clientId: 'ai-service-execution-worker', groupId: 'ai-execution-workers' });

// Redis for distributed locking and concurrency
const redis = new Redis(config.redisUrl);

// Lock configuration
const LOCK_TTL_SECONDS = 120; // Longer for execution tasks
const LOCK_PREFIX = 'execution:lock:';
const WORKSPACE_LOCK_PREFIX = 'execution:workspace:lock:';

// Worker configuration
const WORKER_ID = `execution-worker-${process.pid}-${Date.now().toString(36)}`;
const MAX_CONCURRENT_TASKS = 2; // Limit concurrent LLM calls

// Concurrency semaphore using Redis
const CONCURRENCY_KEY = 'execution:concurrency';
const CONCURRENCY_TTL_SECONDS = 300; // 5 minutes max for a task

let consumer: Consumer | null = null;
let isRunning = false;
let activeTaskCount = 0;

/**
 * Acquire distributed lock for task execution
 */
async function acquireLock(taskId: string): Promise<boolean> {
  const lockKey = `${LOCK_PREFIX}${taskId}`;
  const result = await redis.set(lockKey, WORKER_ID, 'EX', LOCK_TTL_SECONDS, 'NX');
  return result === 'OK';
}

/**
 * Release distributed lock
 */
async function releaseLock(taskId: string): Promise<void> {
  const lockKey = `${LOCK_PREFIX}${taskId}`;
  // Only release if we own the lock
  const value = await redis.get(lockKey);
  if (value === WORKER_ID) {
    await redis.del(lockKey);
  }
}

/**
 * Extend lock TTL (call during long-running tasks)
 */
async function extendLock(taskId: string): Promise<void> {
  const lockKey = `${LOCK_PREFIX}${taskId}`;
  const value = await redis.get(lockKey);
  if (value === WORKER_ID) {
    await redis.expire(lockKey, LOCK_TTL_SECONDS);
  }
}

/**
 * Acquire workspace lock (1 workspace → 1 execution at a time)
 * Prevents concurrent modification of the same workspace
 */
async function acquireWorkspaceLock(workspaceId: string): Promise<boolean> {
  const lockKey = `${WORKSPACE_LOCK_PREFIX}${workspaceId}`;
  const result = await redis.set(lockKey, WORKER_ID, 'PX', LOCK_TTL_SECONDS * 1000, 'NX');
  return result === 'OK';
}

/**
 * Release workspace lock
 */
async function releaseWorkspaceLock(workspaceId: string): Promise<void> {
  const lockKey = `${WORKSPACE_LOCK_PREFIX}${workspaceId}`;
  // Only release if we own the lock
  const value = await redis.get(lockKey);
  if (value === WORKER_ID) {
    await redis.del(lockKey);
  }
}

/**
 * Extend workspace lock TTL
 */
async function extendWorkspaceLock(workspaceId: string): Promise<void> {
  const lockKey = `${WORKSPACE_LOCK_PREFIX}${workspaceId}`;
  const value = await redis.get(lockKey);
  if (value === WORKER_ID) {
    await redis.pexpire(lockKey, LOCK_TTL_SECONDS * 1000);
  }
}

/**
 * Acquire concurrency slot (semaphore)
 */
async function acquireConcurrencySlot(): Promise<boolean> {
  const current = await redis.incr(CONCURRENCY_KEY);
  
  if (current > MAX_CONCURRENT_TASKS) {
    // Over limit, decrement back
    await redis.decr(CONCURRENCY_KEY);
    return false;
  }
  
  // Set TTL in case worker crashes
  await redis.expire(CONCURRENCY_KEY, CONCURRENCY_TTL_SECONDS);
  activeTaskCount = current;
  return true;
}

/**
 * Release concurrency slot
 */
async function releaseConcurrencySlot(): Promise<void> {
  await redis.decr(CONCURRENCY_KEY);
  activeTaskCount = Math.max(0, activeTaskCount - 1);
}

/**
 * Verify task is still in queued status (idempotent guard)
 */
async function verifyTaskIsQueued(
  taskService: ExecutionTaskService,
  taskId: string
): Promise<boolean> {
  const task = await taskService.getTask(taskId);
  
  if (!task) {
    console.log(`[ExecutionWorker] Task ${taskId} not found in database`);
    return false;
  }
  
  if (task.status !== ExecutionTaskStatus.queued) {
    console.log(`[ExecutionWorker] Task ${taskId} is not queued (status: ${task.status}), skipping`);
    return false;
  }
  
  return true;
}

/**
 * Process a single execution task
 */
async function processTask(
  message: ExecutionTaskMessage,
  taskService: ExecutionTaskService,
  orchestrator: TaskOrchestrator
): Promise<void> {
  const { taskId, projectId, workspaceId, instruction, options } = message;
  const timeoutMs = options?.timeoutMs ?? 120000;

  try {
    // ========================================
    // IDEMPOTENT GUARD: Verify task is queued
    // ========================================
    const isQueued = await verifyTaskIsQueued(taskService, taskId);
    if (!isQueued) {
      return; // Skip - already processed or cancelled
    }

    // ========================================
    // CONCURRENCY LIMIT: Acquire slot
    // ========================================
    const hasSlot = await acquireConcurrencySlot();
    if (!hasSlot) {
      console.log(`[ExecutionWorker] Concurrency limit reached (${MAX_CONCURRENT_TASKS}), re-queuing task ${taskId}`);
      // Don't process - let another worker or later attempt handle it
      return;
    }

    // ========================================
    // WORKSPACE LOCK: 1 workspace → 1 execution
    // ========================================
    const hasWorkspaceLock = await acquireWorkspaceLock(workspaceId);
    if (!hasWorkspaceLock) {
      console.log(`[ExecutionWorker] Workspace ${workspaceId} is locked by another task, re-queuing`);
      await releaseConcurrencySlot();
      return;
    }

    // ========================================
    // ATOMIC CLAIM: Mark task as ours
    // ========================================
    const claimed = await taskService.claimTask(taskId, WORKER_ID);
    if (!claimed) {
      console.log(`[ExecutionWorker] Task ${taskId} already claimed by another worker`);
      await releaseWorkspaceLock(workspaceId);
      await releaseConcurrencySlot();
      return;
    }

    console.log(`[ExecutionWorker] Processing task ${taskId}: ${instruction.slice(0, 50)}...`);
    console.log(`[ExecutionWorker] Active tasks: ${activeTaskCount}/${MAX_CONCURRENT_TASKS}`);

    // Create remote workspace (files stored in S3 via project-service API)
    console.log(`[ExecutionWorker] Creating remote workspace for project ${projectId}`);
    // Validate that userId is a proper UUID before passing it to project-service.
    // The createdBy / lastEditedBy columns in project_files are UUID columns —
    // Prisma will throw "invalid character" if a non-UUID string (e.g. "system") is used.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const resolvedUserId = message.userId && UUID_RE.test(message.userId)
      ? message.userId
      : projectId; // Fall back to projectId (also a UUID) — better than 'system'
    const workspace = createRemoteWorkspace({
      projectId,
      projectServiceUrl: config.projectServiceUrl,
      internalApiKey: config.internalApiKey,
      userId: resolvedUserId,
    });
    workspace.setDiffEngine(getDiffEngine());

    // Register workspace with orchestrator (cast to WorkspaceFS for type compat)
    orchestrator.registerWorkspace(workspaceId, workspace as unknown as WorkspaceFS);

    // Set up progress callback to emit events
    orchestrator.setProgressCallback(async (event) => {
      await taskService.updateStatus(taskId, ExecutionTaskStatus.running, {
        progress: Math.round(event.progress * 100),
        currentStage: event.stage,
        stageMessage: event.message,
      });

      await taskService.appendEvent(taskId, {
        eventType: ExecutionEventType.progress_update,
        stage: event.stage,
        message: event.message,
        progress: Math.round(event.progress * 100),
        payload: event.agentProgress ? JSON.parse(JSON.stringify(event.agentProgress)) : null,
      });

      // Extend locks during progress
      await extendLock(taskId);
    });

    // Update status to planning
    await taskService.updateStatus(taskId, ExecutionTaskStatus.running, {
      progress: 5,
      currentStage: EXECUTION_STAGES.PLANNING,
      stageMessage: 'Starting task planning...',
    });

    await taskService.appendEvent(taskId, {
      eventType: ExecutionEventType.progress_update,
      stage: EXECUTION_STAGES.PLANNING,
      message: 'Task started',
      progress: 5,
    });

    // Create task request for orchestrator
    const taskRequest = {
      id: taskId,
      workspaceId,
      prompt: instruction,
      userId: resolvedUserId,
      mode: options?.mode as 'direct' | 'plan_execute' | 'multi_agent' | undefined,
      modelHint: options?.modelHint,
      options: {
        timeoutMs,
        enableRollback: options?.enableRollback ?? true,
        enableSandbox: options?.enableSandbox ?? true,
        dryRun: options?.dryRun ?? false,
        sandboxChecks: options?.sandboxChecks ?? ['syntax', 'typecheck', 'lint'],
        maxFilesModified: options?.maxFilesModified ?? 10,
        streamProgress: true,
      },
      workspaceContext: message.workspaceContext,
      createdAt: new Date(),
    };

    const result = await orchestrator.runTask(taskRequest);

    // Handle result
    if (result.success) {
      // Update task as completed
      await taskService.updateStatus(taskId, ExecutionTaskStatus.completed, {
        progress: 100,
        currentStage: EXECUTION_STAGES.COMPLETED,
        stageMessage: 'Task completed successfully',
        summary: {
          response: result.agentResult?.summary ?? '',
          filesChanged: result.agentResult?.filesChanged ?? [],
          patchesGenerated: result.agentResult?.patches.length ?? 0,
        },
        artifacts: {
          patches: result.agentResult?.patches ?? [],
          filesChanged: result.agentResult?.filesChanged ?? [],
        },
        metrics: {
          totalDurationMs: result.metrics.totalDurationMs,
          planningMs: result.metrics.planningMs,
          executionMs: result.metrics.executionMs,
          validationMs: result.metrics.validationMs,
          filesModified: result.metrics.filesModified,
          patchesApplied: result.agentResult?.patches.length ?? 0,
        },
        snapshotId: result.snapshotId,
      });

      await taskService.appendEvent(taskId, {
        eventType: ExecutionEventType.task_completed,
        stage: EXECUTION_STAGES.COMPLETED,
        message: 'Task completed successfully',
        progress: 100,
        payload: {
          filesModified: result.metrics.filesModified,
          duration: result.metrics.totalDurationMs,
        },
      });

      console.log(`[ExecutionWorker] Task ${taskId} completed successfully`);

      if (result.agentResult?.filesChanged && result.agentResult.filesChanged.length > 0) {
        console.log(`[ExecutionWorker] ${result.agentResult.filesChanged.length} files modified: ${result.agentResult.filesChanged.join(', ')}`);
      }
    } else if (result.status === 'timeout' || result.error?.code === 'TASK_TIMEOUT') {
      const error = result.error;

      await taskService.updateStatus(taskId, ExecutionTaskStatus.timeout, {
        progress: 0,
        currentStage: EXECUTION_STAGES.FAILED,
        stageMessage: error?.message ?? 'Task timed out',
        error: {
          code: error?.code ?? 'TASK_TIMEOUT',
          message: error?.message ?? 'Task timed out',
          stage: error?.stage ?? 'execution',
          recoverable: error?.recoverable ?? true,
        },
        summary: {
          rollbackPerformed: result.rollbackPerformed,
          snapshotId: result.snapshotId,
        },
        metrics: {
          totalDurationMs: result.metrics.totalDurationMs,
        },
        rollbackPerformed: result.rollbackPerformed,
        snapshotId: result.snapshotId,
      });

      await taskService.appendEvent(taskId, {
        eventType: ExecutionEventType.task_failed,
        stage: EXECUTION_STAGES.FAILED,
        message: error?.message ?? 'Task timed out',
        progress: 0,
        payload: {
          timeout: true,
          rollbackPerformed: result.rollbackPerformed,
        },
      });

      console.error(`[ExecutionWorker] Task ${taskId} timed out:`, error?.message);

      const task = await taskService.getTask(taskId);
      if (task && task.retryCount < task.maxRetries && (error?.recoverable ?? true)) {
        console.log(`[ExecutionWorker] Retrying task ${taskId} after timeout`);
        await taskService.retryTask(taskId);
      }
    } else if (result.status === 'cancelled' || result.error?.code === 'TASK_CANCELLED') {
      const error = result.error;

      await taskService.updateStatus(taskId, ExecutionTaskStatus.cancelled, {
        progress: 0,
        currentStage: EXECUTION_STAGES.FAILED,
        stageMessage: error?.message ?? 'Task cancelled',
        error: {
          code: error?.code ?? 'TASK_CANCELLED',
          message: error?.message ?? 'Task cancelled',
          stage: error?.stage ?? 'execution',
          recoverable: error?.recoverable ?? false,
        },
        summary: {
          rollbackPerformed: result.rollbackPerformed,
          snapshotId: result.snapshotId,
        },
        metrics: {
          totalDurationMs: result.metrics.totalDurationMs,
        },
        rollbackPerformed: result.rollbackPerformed,
        snapshotId: result.snapshotId,
      });

      await taskService.appendEvent(taskId, {
        eventType: ExecutionEventType.task_cancelled,
        stage: EXECUTION_STAGES.FAILED,
        message: error?.message ?? 'Task cancelled',
        progress: 0,
        payload: {
          rollbackPerformed: result.rollbackPerformed,
        },
      });

      console.warn(`[ExecutionWorker] Task ${taskId} cancelled`);
    } else {
      // Task failed
      const error = result.error;
      
      await taskService.updateStatus(taskId, ExecutionTaskStatus.failed, {
        progress: result.rollbackPerformed ? 0 : Math.round((result.metrics?.totalDurationMs ?? 0) / 100),
        currentStage: EXECUTION_STAGES.FAILED,
        stageMessage: error?.message ?? 'Task failed',
        error: {
          code: error?.code ?? 'UNKNOWN',
          message: error?.message ?? 'Unknown error',
          stage: error?.stage ?? 'unknown',
          recoverable: error?.recoverable ?? false,
        },
        summary: {
          rollbackPerformed: result.rollbackPerformed,
          snapshotId: result.snapshotId,
        },
        metrics: {
          totalDurationMs: result.metrics.totalDurationMs,
        },
        rollbackPerformed: result.rollbackPerformed,
        snapshotId: result.snapshotId,
      });

      await taskService.appendEvent(taskId, {
        eventType: ExecutionEventType.task_failed,
        stage: EXECUTION_STAGES.FAILED,
        message: error?.message ?? 'Task failed',
        progress: 0,
        payload: {
          error: error,
          rollbackPerformed: result.rollbackPerformed,
        },
      });

      console.error(`[ExecutionWorker] Task ${taskId} failed:`, error?.message);

      // Check if we should retry
      const task = await taskService.getTask(taskId);
      if (task && task.retryCount < task.maxRetries && error?.recoverable) {
        console.log(`[ExecutionWorker] Retrying task ${taskId} (attempt ${task.retryCount + 1}/${task.maxRetries})`);
        await taskService.retryTask(taskId);
      }
    }

  } catch (error) {
    console.error(`[ExecutionWorker] Error processing task ${taskId}:`, error);

    // Update task as failed
    await taskService.updateStatus(taskId, ExecutionTaskStatus.failed, {
      progress: 0,
      currentStage: EXECUTION_STAGES.FAILED,
      stageMessage: error instanceof Error ? error.message : 'Unknown error',
      error: {
        code: 'WORKER_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        stage: 'execution',
        recoverable: true,
      },
    });

    await taskService.appendEvent(taskId, {
      eventType: ExecutionEventType.task_failed,
      stage: EXECUTION_STAGES.FAILED,
      message: error instanceof Error ? error.message : 'Unknown error',
      progress: 0,
      payload: {
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      },
    });

    // Check retry
    const task = await taskService.getTask(taskId);
    if (task && task.retryCount < task.maxRetries) {
      await taskService.retryTask(taskId);
    }
  } finally {
    // Release workspace lock
    await releaseWorkspaceLock(workspaceId);
    
    // Release concurrency slot
    await releaseConcurrencySlot();
    
    // Release lock
    await releaseLock(taskId);
    
    // Unregister workspace
    const orchestrator = getTaskOrchestrator();
    orchestrator.unregisterWorkspace(workspaceId);
    
    console.log(`[ExecutionWorker] Released task ${taskId}, active tasks: ${activeTaskCount}/${MAX_CONCURRENT_TASKS}`);
  }
}

/**
 * Handle incoming Kafka message
 */
async function handleMessage(
  payload: EachMessagePayload,
  taskService: ExecutionTaskService,
  orchestrator: TaskOrchestrator
): Promise<void> {
  const { message } = payload;
  
  if (!message.value) {
    return;
  }
  
  console.log(`[ExecutionWorker] Received Kafka message offset ${message.offset} on topic ${payload.topic}`);

  try {
    const taskMessage: ExecutionTaskMessage = JSON.parse(message.value.toString());
    
    // Try to acquire lock
    const locked = await acquireLock(taskMessage.taskId);
    if (!locked) {
      console.log(`[ExecutionWorker] Task ${taskMessage.taskId} already locked`);
      return;
    }

    await processTask(taskMessage, taskService, orchestrator);
  } catch (error) {
    console.error('[ExecutionWorker] Error parsing message:', error);
  }
}

/**
 * Start the execution worker
 */
export async function startExecutionWorker(): Promise<void> {
  if (isRunning) {
    console.log('[ExecutionWorker] Already running');
    return;
  }

  const taskService = getExecutionTaskService();
  const orchestrator = getTaskOrchestrator();

  consumer = kafka.consumer({
    groupId: 'ai-execution-workers',
    allowAutoTopicCreation: true,
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: EXECUTION_KAFKA_TOPICS.TASKS,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async (payload) => {
      await handleMessage(payload, taskService, orchestrator);
    },
  });

  isRunning = true;
  console.log(`[ExecutionWorker] Started (workerId: ${WORKER_ID})`);
}

/**
 * Stop the execution worker
 */
export async function stopExecutionWorker(): Promise<void> {
  if (!isRunning || !consumer) {
    return;
  }

  await consumer.disconnect();
  await redis.quit();
  
  consumer = null;
  isRunning = false;
  
  console.log('[ExecutionWorker] Stopped');
}

/**
 * Get worker status
 */
export function getWorkerStatus(): {
  isRunning: boolean;
  workerId: string;
} {
  return {
    isRunning,
    workerId: WORKER_ID,
  };
}
