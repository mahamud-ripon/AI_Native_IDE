/**
 * Execution Task Service
 * 
 * Service layer for the Execution Control Plane (Phase-6A).
 * Handles task lifecycle, event tracking, and Kafka integration.
 */

import { PrismaClient, ExecutionTaskStatus, ExecutionTaskPriority, ExecutionEventType, Prisma } from '@prisma/client';
import {
  CreateExecutionTaskRequest,
  ExecutionTaskEntity,
  ExecutionTaskEventEntity,
  CreateExecutionEventPayload,
  ExecutionTaskSummary,
  ExecutionTaskResult,
  ExecutionTaskMessage,
  ExecutionEventMessage,
  EXECUTION_KAFKA_TOPICS,
} from './execution_types.js';
import { Kafka, Producer, Consumer } from 'kafkajs';
import { config } from '../config.js';

const prisma = new PrismaClient();

// Kafka producer singleton
let kafkaProducer: Producer | null = null;

/**
 * Get or create Kafka producer
 */
async function getKafkaProducer(): Promise<Producer> {
  if (!kafkaProducer) {
    const kafka = new Kafka({
      clientId: 'ai-service-execution',
      brokers: config.kafkaBrokers.split(','),
    });
    kafkaProducer = kafka.producer();
    await kafkaProducer.connect();
  }
  return kafkaProducer;
}

/**
 * Execution Task Service
 */
export class ExecutionTaskService {
  /**
   * Create a new execution task
   */
  async createTask(request: CreateExecutionTaskRequest): Promise<ExecutionTaskEntity> {
    const task = await prisma.executionTask.create({
      data: {
        projectId: request.projectId,
        workspaceId: request.workspaceId,
        conversationId: request.conversationId ?? null,
        instruction: request.instruction,
        branch: request.branch ?? null,
        priority: request.priority ?? ExecutionTaskPriority.normal,
        status: ExecutionTaskStatus.pending,
        progress: 0,
        currentStage: 'pending',
        stageMessage: 'Task created',
        options: (request.options ?? undefined) as unknown as Prisma.InputJsonValue,
        timeoutMs: request.options?.timeoutMs ?? 120000,
        enableRollback: request.options?.enableRollback ?? true,
        enableSandbox: request.options?.enableSandbox ?? true,
        dryRun: request.options?.dryRun ?? false,
        createdBy: request.userId,
        agentName: request.agentName ?? null,
        workflowRunId: request.workflowRunId ?? null,
      },
    });

    // Append creation event
    await this.appendEvent(task.id, {
      eventType: ExecutionEventType.task_created,
      stage: 'pending',
      message: 'Task created',
      progress: 0,
      payload: { instruction: request.instruction },
    });

    return task as ExecutionTaskEntity;
  }

  /**
   * Enqueue task to Kafka for worker processing
   */
  async enqueueTask(taskId: string): Promise<void> {
    const task = await prisma.executionTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== ExecutionTaskStatus.pending) {
      throw new Error(`Task cannot be enqueued: status=${task.status}`);
    }

    // Update status to queued
    await prisma.executionTask.update({
      where: { id: taskId },
      data: {
        status: ExecutionTaskStatus.queued,
        queuedAt: new Date(),
      },
    });

    // Append queued event
    await this.appendEvent(taskId, {
      eventType: ExecutionEventType.task_queued,
      stage: 'queued',
      message: 'Task enqueued for processing',
      progress: 0,
    });

    // Publish to Kafka
    const producer = await getKafkaProducer();
    const message: ExecutionTaskMessage = {
      taskId: task.id,
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      instruction: task.instruction,
      priority: task.priority as ExecutionTaskPriority,
      options: task.options as Record<string, unknown> ?? {},
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
    };

    await producer.send({
      topic: EXECUTION_KAFKA_TOPICS.TASKS,
      messages: [
        {
          key: task.id,
          value: JSON.stringify(message),
          headers: {
            priority: task.priority,
          },
        },
      ],
    });
  }

  /**
   * Create task and immediately enqueue it
   */
  async createAndEnqueue(request: CreateExecutionTaskRequest): Promise<ExecutionTaskEntity> {
    const task = await this.createTask(request);
    await this.enqueueTask(task.id);
    return task;
  }

  /**
   * Update task status
   */
  async updateStatus(
    taskId: string,
    status: ExecutionTaskStatus,
    options?: {
      progress?: number;
      currentStage?: string;
      stageMessage?: string;
      workerId?: string;
      summary?: Record<string, unknown>;
      artifacts?: Record<string, unknown>;
      error?: Record<string, unknown>;
      metrics?: {
        totalDurationMs?: number;
        planningMs?: number;
        executionMs?: number;
        validationMs?: number;
        tokensUsed?: number;
        costUsd?: number;
        patchesApplied?: number;
        filesModified?: number;
      };
      snapshotId?: string;
      rollbackPerformed?: boolean;
    }
  ): Promise<ExecutionTaskEntity> {
    const updateData: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };

    if (options?.progress !== undefined) {
      updateData.progress = Math.min(100, Math.max(0, options.progress));
    }
    if (options?.currentStage !== undefined) {
      updateData.currentStage = options.currentStage;
    }
    if (options?.stageMessage !== undefined) {
      updateData.stageMessage = options.stageMessage;
    }
    if (options?.workerId !== undefined) {
      updateData.workerId = options.workerId;
    }
    if (options?.summary !== undefined) {
      updateData.summary = options.summary;
    }
    if (options?.artifacts !== undefined) {
      updateData.artifacts = options.artifacts;
    }
    if (options?.error !== undefined) {
      updateData.error = options.error;
    }
    if (options?.snapshotId !== undefined) {
      updateData.snapshotId = options.snapshotId;
    }
    if (options?.rollbackPerformed !== undefined) {
      updateData.rollbackPerformed = options.rollbackPerformed;
    }

    // Metrics
    if (options?.metrics) {
      if (options.metrics.totalDurationMs !== undefined) {
        updateData.totalDurationMs = options.metrics.totalDurationMs;
      }
      if (options.metrics.planningMs !== undefined) {
        updateData.planningMs = options.metrics.planningMs;
      }
      if (options.metrics.executionMs !== undefined) {
        updateData.executionMs = options.metrics.executionMs;
      }
      if (options.metrics.validationMs !== undefined) {
        updateData.validationMs = options.metrics.validationMs;
      }
      if (options.metrics.tokensUsed !== undefined) {
        updateData.tokensUsed = options.metrics.tokensUsed;
      }
      if (options.metrics.costUsd !== undefined) {
        updateData.costUsd = options.metrics.costUsd;
      }
      if (options.metrics.patchesApplied !== undefined) {
        updateData.patchesApplied = options.metrics.patchesApplied;
      }
      if (options.metrics.filesModified !== undefined) {
        updateData.filesModified = options.metrics.filesModified;
      }
    }

    // Set timestamps based on status
    if (status === ExecutionTaskStatus.running) {
      updateData.startedAt = new Date();
    } else if (
      status === ExecutionTaskStatus.completed ||
      status === ExecutionTaskStatus.failed ||
      status === ExecutionTaskStatus.cancelled ||
      status === ExecutionTaskStatus.timeout
    ) {
      updateData.completedAt = new Date();
    }

    const task = await prisma.executionTask.update({
      where: { id: taskId },
      data: updateData,
    });

    return task as ExecutionTaskEntity;
  }

  /**
   * Append an event to task
   */
  async appendEvent(
    taskId: string,
    payload: CreateExecutionEventPayload
  ): Promise<ExecutionTaskEventEntity> {
    // Get current max sequence for this task
    const latestEvent = await prisma.executionTaskEvent.findFirst({
      where: { taskId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const sequence = (latestEvent?.sequence ?? -1) + 1;

    const event = await prisma.executionTaskEvent.create({
      data: {
        taskId,
        sequence,
        eventType: payload.eventType,
        stage: payload.stage,
        message: payload.message,
        progress: payload.progress,
        payload: (payload.payload ?? undefined) as unknown as Prisma.InputJsonValue,
      },
    });

    // Also publish to Kafka for real-time streaming
    await this.publishEvent(taskId, {
      ...payload,
      timestamp: new Date().toISOString(),
    });

    return event as ExecutionTaskEventEntity;
  }

  /**
   * Publish event to Kafka
   */
  private async publishEvent(
    taskId: string,
    payload: CreateExecutionEventPayload & { timestamp: string }
  ): Promise<void> {
    const task = await prisma.executionTask.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });

    if (!task) return;

    const producer = await getKafkaProducer();
    const message: ExecutionEventMessage = {
      taskId,
      projectId: task.projectId,
      eventType: payload.eventType,
      stage: payload.stage,
      message: payload.message,
      progress: payload.progress,
      payload: payload.payload ?? null,
      timestamp: payload.timestamp,
    };

    await producer.send({
      topic: EXECUTION_KAFKA_TOPICS.EVENTS,
      messages: [
        {
          key: taskId,
          value: JSON.stringify(message),
        },
      ],
    });
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<ExecutionTaskEntity | null> {
    const task = await prisma.executionTask.findUnique({
      where: { id: taskId },
    });
    return task as ExecutionTaskEntity | null;
  }

  /**
   * Get task events
   */
  async getTaskEvents(taskId: string, options?: { limit?: number; offset?: number }): Promise<ExecutionTaskEventEntity[]> {
    const events = await prisma.executionTaskEvent.findMany({
      where: { taskId },
      orderBy: { sequence: 'asc' },
      take: options?.limit ?? 100,
      skip: options?.offset ?? 0,
    });
    return events as ExecutionTaskEventEntity[];
  }

  /**
   * Get task events since a sequence number (for replay on reconnect)
   */
  async getTaskEventsSince(taskId: string, sinceSequence: number): Promise<ExecutionTaskEventEntity[]> {
    const events = await prisma.executionTaskEvent.findMany({
      where: {
        taskId,
        sequence: { gt: sinceSequence },
      },
      orderBy: { sequence: 'asc' },
    });
    return events as ExecutionTaskEventEntity[];
  }

  /**
   * Get task summary (lighter query)
   */
  async getTaskSummary(taskId: string): Promise<ExecutionTaskSummary | null> {
    const task = await prisma.executionTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        projectId: true,
        workspaceId: true,
        instruction: true,
        status: true,
        progress: true,
        currentStage: true,
        stageMessage: true,
        createdAt: true,
        completedAt: true,
        error: true,
      },
    });
    return task as ExecutionTaskSummary | null;
  }

  /**
   * Get task result (for completed tasks)
   */
  async getTaskResult(taskId: string): Promise<ExecutionTaskResult | null> {
    const task = await prisma.executionTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        summary: true,
        artifacts: true,
        error: true,
        totalDurationMs: true,
        planningMs: true,
        executionMs: true,
        validationMs: true,
        tokensUsed: true,
        costUsd: true,
        patchesApplied: true,
        filesModified: true,
      },
    });

    if (!task) return null;

    return {
      taskId: task.id,
      success: task.status === ExecutionTaskStatus.completed,
      status: task.status as ExecutionTaskStatus,
      summary: task.summary as Record<string, unknown> | null,
      artifacts: task.artifacts as Record<string, unknown> | null,
      error: task.error as Record<string, unknown> | null,
      metrics: {
        totalDurationMs: task.totalDurationMs,
        planningMs: task.planningMs,
        executionMs: task.executionMs,
        validationMs: task.validationMs,
        tokensUsed: task.tokensUsed,
        costUsd: task.costUsd ? Number(task.costUsd) : null,
        patchesApplied: task.patchesApplied,
        filesModified: task.filesModified,
      },
    };
  }

  /**
   * List tasks by project
   */
  async listTasksByProject(
    projectId: string,
    options?: {
      status?: ExecutionTaskStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<ExecutionTaskEntity[]> {
    const tasks = await prisma.executionTask.findMany({
      where: {
        projectId,
        ...(options?.status && { status: options.status }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
    return tasks as ExecutionTaskEntity[];
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<ExecutionTaskEntity> {
    const task = await prisma.executionTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Can only cancel pending or queued tasks
    if (
      task.status !== ExecutionTaskStatus.pending &&
      task.status !== ExecutionTaskStatus.queued &&
      task.status !== ExecutionTaskStatus.running
    ) {
      throw new Error(`Task cannot be cancelled: status=${task.status}`);
    }

    const updatedTask = await prisma.executionTask.update({
      where: { id: taskId },
      data: {
        status: ExecutionTaskStatus.cancelled,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await this.appendEvent(taskId, {
      eventType: ExecutionEventType.task_cancelled,
      stage: 'cancelled',
      message: 'Task cancelled by user',
      progress: task.progress,
    });

    return updatedTask as ExecutionTaskEntity;
  }

  /**
   * Increment retry count and re-queue
   */
  async retryTask(taskId: string): Promise<ExecutionTaskEntity> {
    const task = await prisma.executionTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.retryCount >= task.maxRetries) {
      throw new Error(`Max retries exceeded: ${task.maxRetries}`);
    }

    const updatedTask = await prisma.executionTask.update({
      where: { id: taskId },
      data: {
        status: ExecutionTaskStatus.pending,
        retryCount: task.retryCount + 1,
        updatedAt: new Date(),
      },
    });

    await this.enqueueTask(taskId);

    return updatedTask as ExecutionTaskEntity;
  }

  /**
   * Claim task for worker (atomic operation)
   */
  async claimTask(taskId: string, workerId: string): Promise<boolean> {
    const result = await prisma.executionTask.updateMany({
      where: {
        id: taskId,
        status: ExecutionTaskStatus.queued,
        workerId: null,
      },
      data: {
        status: ExecutionTaskStatus.running,
        workerId,
        startedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    if (result.count > 0) {
      await this.appendEvent(taskId, {
        eventType: ExecutionEventType.task_started,
        stage: 'running',
        message: `Task started by worker ${workerId}`,
        progress: 0,
        payload: { workerId },
      });
      return true;
    }

    return false;
  }
}

// Singleton instance
let executionTaskService: ExecutionTaskService | null = null;

/**
 * Get execution task service singleton
 */
export function getExecutionTaskService(): ExecutionTaskService {
  if (!executionTaskService) {
    executionTaskService = new ExecutionTaskService();
  }
  return executionTaskService;
}

/**
 * Disconnect Kafka producer
 */
export async function disconnectExecutionKafka(): Promise<void> {
  if (kafkaProducer) {
    await kafkaProducer.disconnect();
    kafkaProducer = null;
  }
}
