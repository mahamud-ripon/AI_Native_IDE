/**
 * Execution Types
 * 
 * Type definitions for the Execution Control Plane (Phase-6A).
 * Covers task creation, status management, and event streaming.
 */

import { ExecutionTaskStatus, ExecutionTaskPriority, ExecutionEventType } from '@prisma/client';

// Task creation request
export interface CreateExecutionTaskRequest {
  projectId: string;
  workspaceId: string;
  instruction: string;
  userId: string;
  conversationId?: string;
  branch?: string;
  priority?: ExecutionTaskPriority;
  agentName?: string;
  workflowRunId?: string;
  options?: ExecutionTaskOptions;
  // Execution metadata for observability
  metadata?: ExecutionTaskMetadata;
}

// Execution metadata for observability, debugging, and analytics
export interface ExecutionTaskMetadata {
  /** Agent that initiated this task */
  agent?: string;
  /** Workflow stage (e.g., 'backend', 'frontend', 'testing') */
  workflowStage?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Parent task ID if this is a subtask */
  parentTaskId?: string;
  /** User agent / client info */
  clientInfo?: {
    type: 'ide' | 'api' | 'cli' | 'web';
    version?: string;
  };
  /** Additional context */
  context?: Record<string, unknown>;
}

// Task options (mapped to TaskOrchestrator options)
export interface ExecutionTaskOptions {
  timeoutMs?: number;
  enableRollback?: boolean;
  enableSandbox?: boolean;
  dryRun?: boolean;
  sandboxChecks?: ('syntax' | 'typecheck' | 'lint' | 'dependency' | 'test' | 'build')[];
  maxFilesModified?: number;
}

// Task entity (from database)
export interface ExecutionTaskEntity {
  id: string;
  projectId: string;
  workspaceId: string;
  conversationId: string | null;
  instruction: string;
  branch: string | null;
  priority: ExecutionTaskPriority;
  status: ExecutionTaskStatus;
  progress: number;
  currentStage: string | null;
  stageMessage: string | null;
  retryCount: number;
  maxRetries: number;
  workerId: string | null;
  options: Record<string, unknown> | null;
  timeoutMs: number;
  enableRollback: boolean;
  enableSandbox: boolean;
  dryRun: boolean;
  summary: Record<string, unknown> | null;
  artifacts: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  patchesApplied: number;
  filesModified: number;
  totalDurationMs: number | null;
  planningMs: number | null;
  executionMs: number | null;
  validationMs: number | null;
  tokensUsed: number;
  costUsd: number | null;
  createdBy: string;
  agentName: string | null;
  workflowRunId: string | null;
  // Execution metadata for observability
  metadata: ExecutionTaskMetadata | null;
  createdAt: Date;
  queuedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  snapshotId: string | null;
  rollbackPerformed: boolean;
}

// Event entity (from database)
export interface ExecutionTaskEventEntity {
  id: string;
  taskId: string;
  sequence: number;
  eventType: ExecutionEventType;
  stage: string;
  message: string;
  progress: number;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

// Event creation payload
export interface CreateExecutionEventPayload {
  eventType: ExecutionEventType;
  stage: string;
  message: string;
  progress: number;
  payload?: Record<string, unknown>;
}

// Task summary (for API responses)
export interface ExecutionTaskSummary {
  id: string;
  projectId: string;
  workspaceId: string;
  instruction: string;
  status: ExecutionTaskStatus;
  progress: number;
  currentStage: string | null;
  stageMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  error: Record<string, unknown> | null;
}

// Task result (for completed tasks)
export interface ExecutionTaskResult {
  taskId: string;
  success: boolean;
  status: ExecutionTaskStatus;
  summary: Record<string, unknown> | null;
  artifacts: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  metrics: {
    totalDurationMs: number | null;
    planningMs: number | null;
    executionMs: number | null;
    validationMs: number | null;
    tokensUsed: number;
    costUsd: number | null;
    patchesApplied: number;
    filesModified: number;
  };
}

// Kafka message for task queue
export interface ExecutionTaskMessage {
  taskId: string;
  projectId: string;
  workspaceId: string;
  instruction: string;
  priority: ExecutionTaskPriority;
  options: ExecutionTaskOptions;
  retryCount: number;
  maxRetries: number;
  userId?: string;
  rootPath?: string;
}

// Kafka event message
export interface ExecutionEventMessage {
  taskId: string;
  projectId: string;
  eventType: ExecutionEventType;
  stage: string;
  message: string;
  progress: number;
  payload: Record<string, unknown> | null;
  timestamp: string;
}

// Stage constants (for currentStage field)
export const EXECUTION_STAGES = {
  PENDING: 'pending',
  PLANNING: 'planning',
  GENERATING_PATCH: 'generating_patch',
  VALIDATING: 'validating',
  APPLYING_PATCH: 'applying_patch',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ROLLING_BACK: 'rolling_back',
} as const;

export type ExecutionStage = typeof EXECUTION_STAGES[keyof typeof EXECUTION_STAGES];

// Kafka topics
export const EXECUTION_KAFKA_TOPICS = {
  TASKS: 'ai.execution.tasks',
  EVENTS: 'ai.execution.events',
} as const;
