/**
 * Execution Event Types
 *
 * Defines all event types for the Execution Control Plane event streaming system.
 * Events are partitioned by purpose to prevent consumer lag and ensure ordering.
 *
 * Architecture:
 *   - Lifecycle events: Critical task state changes (low volume, high priority)
 *   - Progress events: Frequent progress updates (high volume, lightweight)
 *   - Patch events: File modification details (medium volume, larger payloads)
 *
 * Kafka Topics:
 *   - ai.execution.lifecycle  → TASK_QUEUED, TASK_STARTED, TASK_COMPLETED, etc.
 *   - ai.execution.progress   → PROGRESS_UPDATE, STAGE_STARTED, STAGE_COMPLETED
 *   - ai.execution.patches    → PATCH_GENERATED, PATCH_APPLIED, FILE_MODIFIED
 *
 * Ordering Guarantee:
 *   - All events use taskId as Kafka partition key
 *   - Events for same task always go to same partition
 *   - Sequence number provides additional ordering within partition
 */

// ========================================
// KAFKA TOPIC NAMES
// ========================================

export const EXECUTION_KAFKA_TOPICS = {
  /** Task commands - create, cancel, retry */
  TASKS: 'ai.execution.tasks',
  /** Lifecycle events - queued, started, completed, failed */
  LIFECYCLE: 'ai.execution.lifecycle',
  /** Progress events - stage changes, progress updates */
  PROGRESS: 'ai.execution.progress',
  /** Patch events - file modifications, patch generation */
  PATCHES: 'ai.execution.patches',
} as const;

// ========================================
// EVENT TYPES
// ========================================

/**
 * Lifecycle event types
 * Critical state changes - low volume, must not be lost
 */
export enum LifecycleEventType {
  TASK_QUEUED = 'task.queued',
  TASK_STARTED = 'task.started',
  TASK_COMPLETED = 'task.completed',
  TASK_FAILED = 'task.failed',
  TASK_TIMEOUT = 'task.timeout',
  TASK_CANCELLED = 'task.cancelled',
  TASK_RETRYING = 'task.retrying',
}

/**
 * Progress event types
 * Frequent updates - high volume, lightweight payloads
 */
export enum ProgressEventType {
  STAGE_STARTED = 'stage.started',
  STAGE_COMPLETED = 'stage.completed',
  PROGRESS_UPDATE = 'progress.update',
  AGENT_PLANNING = 'agent.planning',
  AGENT_GENERATING = 'agent.generating',
  AGENT_STEP = 'agent.step',
  COMMAND_APPROVAL_REQUESTED = 'command.approval_requested',
}

/**
 * Patch event types
 * File modification details - medium volume, summary only (not full patches)
 */
export enum PatchEventType {
  PATCH_GENERATED = 'patch.generated',
  PATCH_VALIDATING = 'patch.validating',
  PATCH_VALIDATION_PASSED = 'patch.validation_passed',
  PATCH_VALIDATION_FAILED = 'patch.validation_failed',
  PATCH_APPLYING = 'patch.applying',
  PATCH_APPLIED = 'patch.applied',
  FILE_MODIFIED = 'file.modified',
  ROLLBACK_STARTED = 'rollback.started',
  ROLLBACK_COMPLETED = 'rollback.completed',
}

/**
 * Union of all event types
 */
export type ExecutionEventType = LifecycleEventType | ProgressEventType | PatchEventType;

// ========================================
// EXECUTION STAGES
// ========================================

export enum ExecutionStage {
  QUEUED = 'queued',
  PLANNING = 'planning',
  EXECUTION = 'execution',
  VALIDATION = 'validation',
  APPLICATION = 'application',
  ROLLBACK = 'rollback',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// ========================================
// EVENT INTERFACES
// ========================================

/**
 * Base event interface - common fields for all events
 */
export interface BaseExecutionEvent {
  /** Task identifier - used as Kafka partition key */
  taskId: string;
  /** Project identifier */
  projectId: string;
  /** Workspace identifier */
  workspaceId: string;
  /** User who initiated the task */
  userId: string;
  /** Event type */
  type: ExecutionEventType;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Sequence number for ordering within task */
  sequence: number;
  /** Current execution stage */
  stage?: ExecutionStage;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Event metadata for observability */
  metadata: EventMetadata;
}

/**
 * Event metadata for observability and debugging
 */
export interface EventMetadata {
  /** Agent that generated this event */
  agent?: string;
  /** Workflow run ID if part of a workflow */
  workflowRunId?: string;
  /** Conversation ID for context */
  conversationId?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Worker ID that processed the task */
  workerId?: string;
  /** Parent task ID if this is a subtask */
  parentTaskId?: string;
}

// ========================================
// LIFECYCLE EVENTS
// ========================================

/**
 * Task queued event
 */
export interface TaskQueuedEvent extends BaseExecutionEvent {
  type: LifecycleEventType.TASK_QUEUED;
  stage: ExecutionStage.QUEUED;
  progress: 0;
  payload: {
    instruction: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    timeoutMs: number;
    branch?: string;
  };
}

/**
 * Task started event
 */
export interface TaskStartedEvent extends BaseExecutionEvent {
  type: LifecycleEventType.TASK_STARTED;
  stage: ExecutionStage.PLANNING;
  progress: 5;
  payload: {
    instruction: string;
    workerId: string;
    estimatedDurationMs?: number;
  };
}

/**
 * Task completed event
 */
export interface TaskCompletedEvent extends BaseExecutionEvent {
  type: LifecycleEventType.TASK_COMPLETED;
  stage: ExecutionStage.COMPLETED;
  progress: 100;
  payload: {
    filesModified: number;
    linesAdded: number;
    linesRemoved: number;
    durationMs: number;
    snapshotId?: string;
  };
}

/**
 * Task failed event
 */
export interface TaskFailedEvent extends BaseExecutionEvent {
  type: LifecycleEventType.TASK_FAILED;
  stage: ExecutionStage.FAILED;
  progress: number;
  payload: {
    error: {
      code: string;
      message: string;
      stage: ExecutionStage;
      recoverable: boolean;
    };
    rollbackPerformed: boolean;
    retryCount: number;
    maxRetries: number;
  };
}

/**
 * Task timeout event
 */
export interface TaskTimeoutEvent extends BaseExecutionEvent {
  type: LifecycleEventType.TASK_TIMEOUT;
  stage: ExecutionStage.FAILED;
  progress: number;
  payload: {
    timeoutMs: number;
    elapsedMs: number;
    rollbackPerformed: boolean;
  };
}

/**
 * Task cancelled event
 */
export interface TaskCancelledEvent extends BaseExecutionEvent {
  type: LifecycleEventType.TASK_CANCELLED;
  stage: ExecutionStage.FAILED;
  progress: number;
  payload: {
    reason: string;
    rollbackPerformed: boolean;
  };
}

/**
 * Task retrying event
 */
export interface TaskRetryingEvent extends BaseExecutionEvent {
  type: LifecycleEventType.TASK_RETRYING;
  stage: ExecutionStage.QUEUED;
  progress: 0;
  payload: {
    retryCount: number;
    maxRetries: number;
    previousError: string;
    delayMs: number;
  };
}

// ========================================
// PROGRESS EVENTS
// ========================================

/**
 * Stage started event
 */
export interface StageStartedEvent extends BaseExecutionEvent {
  type: ProgressEventType.STAGE_STARTED;
  stage: ExecutionStage;
  progress: number;
  payload: {
    stageName: string;
    description: string;
  };
}

/**
 * Stage completed event
 */
export interface StageCompletedEvent extends BaseExecutionEvent {
  type: ProgressEventType.STAGE_COMPLETED;
  stage: ExecutionStage;
  progress: number;
  payload: {
    stageName: string;
    durationMs: number;
    success: boolean;
  };
}

/**
 * Progress update event
 */
export interface ProgressUpdateEvent extends BaseExecutionEvent {
  type: ProgressEventType.PROGRESS_UPDATE;
  stage: ExecutionStage;
  progress: number;
  payload: {
    message: string;
    detail?: string;
  };
}

/**
 * Agent planning event
 */
export interface AgentPlanningEvent extends BaseExecutionEvent {
  type: ProgressEventType.AGENT_PLANNING;
  stage: ExecutionStage.PLANNING;
  progress: number;
  payload: {
    thought?: string;
    filesAnalyzed: number;
    contextSize: number;
  };
}

/**
 * Agent generating event
 */
export interface AgentGeneratingEvent extends BaseExecutionEvent {
  type: ProgressEventType.AGENT_GENERATING;
  stage: ExecutionStage.EXECUTION;
  progress: number;
  payload: {
    currentFile?: string;
    filesPlanned: number;
    filesGenerated: number;
  };
}

/**
 * Agent step event
 */
export interface AgentStepEvent extends BaseExecutionEvent {
  type: ProgressEventType.AGENT_STEP;
  stage: ExecutionStage;
  progress: number;
  payload: {
    step: string;
    description: string;
    result?: 'success' | 'failure' | 'skipped';
  };
}

// ========================================
// PATCH EVENTS
// ========================================

/**
 * Patch generated event
 * Note: Only sends summary, not full patch content
 */
export interface PatchGeneratedEvent extends BaseExecutionEvent {
  type: PatchEventType.PATCH_GENERATED;
  stage: ExecutionStage.EXECUTION;
  progress: number;
  payload: {
    file: string;
    linesAdded: number;
    linesRemoved: number;
    /** Hash for frontend to request full patch via API */
    patchHash: string;
    /** Preview of first few lines (truncated) */
    preview?: string;
  };
}

/**
 * Patch validating event
 */
export interface PatchValidatingEvent extends BaseExecutionEvent {
  type: PatchEventType.PATCH_VALIDATING;
  stage: ExecutionStage.VALIDATION;
  progress: number;
  payload: {
    file: string;
    checks: string[];
  };
}

/**
 * Patch validation passed event
 */
export interface PatchValidationPassedEvent extends BaseExecutionEvent {
  type: PatchEventType.PATCH_VALIDATION_PASSED;
  stage: ExecutionStage.VALIDATION;
  progress: number;
  payload: {
    file: string;
    checksPassed: string[];
    durationMs: number;
  };
}

/**
 * Patch validation failed event
 */
export interface PatchValidationFailedEvent extends BaseExecutionEvent {
  type: PatchEventType.PATCH_VALIDATION_FAILED;
  stage: ExecutionStage.VALIDATION;
  progress: number;
  payload: {
    file: string;
    errors: Array<{
      check: string;
      message: string;
      line?: number;
    }>;
  };
}

/**
 * Patch applying event
 */
export interface PatchApplyingEvent extends BaseExecutionEvent {
  type: PatchEventType.PATCH_APPLYING;
  stage: ExecutionStage.APPLICATION;
  progress: number;
  payload: {
    file: string;
    linesToModify: number;
  };
}

/**
 * Patch applied event
 */
export interface PatchAppliedEvent extends BaseExecutionEvent {
  type: PatchEventType.PATCH_APPLIED;
  stage: ExecutionStage.APPLICATION;
  progress: number;
  payload: {
    file: string;
    linesAdded: number;
    linesRemoved: number;
    success: boolean;
  };
}

/**
 * File modified event
 * Sent when a file has been modified - allows IDE to highlight live
 */
export interface FileModifiedEvent extends BaseExecutionEvent {
  type: PatchEventType.FILE_MODIFIED;
  stage: ExecutionStage.APPLICATION;
  progress: number;
  payload: {
    file: string;
    linesAdded: number;
    linesRemoved: number;
    /** Hash of new content for conflict detection */
    contentHash: string;
    /** Whether this was a creation, modification, or deletion */
    operation: 'created' | 'modified' | 'deleted';
  };
}

/**
 * Rollback started event
 */
export interface RollbackStartedEvent extends BaseExecutionEvent {
  type: PatchEventType.ROLLBACK_STARTED;
  stage: ExecutionStage.ROLLBACK;
  progress: number;
  payload: {
    snapshotId: string;
    filesToRestore: number;
  };
}

/**
 * Rollback completed event
 */
export interface RollbackCompletedEvent extends BaseExecutionEvent {
  type: PatchEventType.ROLLBACK_COMPLETED;
  stage: ExecutionStage.ROLLBACK;
  progress: number;
  payload: {
    snapshotId: string;
    filesRestored: number;
    filesFailed: number;
    success: boolean;
  };
}

// ========================================
// EVENT UNION TYPES
// ========================================

/**
 * All lifecycle events
 */
export type LifecycleEvent =
  | TaskQueuedEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskTimeoutEvent
  | TaskCancelledEvent
  | TaskRetryingEvent;

/**
 * All progress events
 */
export type ProgressEvent =
  | StageStartedEvent
  | StageCompletedEvent
  | ProgressUpdateEvent
  | AgentPlanningEvent
  | AgentGeneratingEvent
  | AgentStepEvent;

/**
 * All patch events
 */
export type PatchEvent =
  | PatchGeneratedEvent
  | PatchValidatingEvent
  | PatchValidationPassedEvent
  | PatchValidationFailedEvent
  | PatchApplyingEvent
  | PatchAppliedEvent
  | FileModifiedEvent
  | RollbackStartedEvent
  | RollbackCompletedEvent;

/**
 * All execution events
 */
export type ExecutionEvent = LifecycleEvent | ProgressEvent | PatchEvent;

// ========================================
// KAFKA MESSAGE TYPES
// ========================================

/**
 * Kafka message wrapper with partition key
 */
export interface KafkaExecutionMessage {
  /** Partition key - always taskId for ordering */
  key: string;
  /** Event payload */
  value: ExecutionEvent;
  /** Topic to publish to */
  topic: string;
  /** Timestamp for Kafka log */
  timestamp?: number;
  /** Headers for additional metadata */
  headers?: Record<string, string>;
}

// ========================================
// WEBSOCKET CHANNELS
// ========================================

/**
 * WebSocket channel names for execution events
 */
export const EXECUTION_CHANNELS = {
  /** Single task events */
  task: (taskId: string) => `execution:task:${taskId}`,
  /** All tasks in workspace */
  workspace: (workspaceId: string) => `execution:workspace:${workspaceId}`,
  /** All tasks in project */
  project: (projectId: string) => `execution:project:${projectId}`,
  /** All tasks for user */
  user: (userId: string) => `execution:user:${userId}`,
} as const;

// ========================================
// REDIS STREAM KEYS
// ========================================

/**
 * Redis stream keys for event buffering
 */
export const EXECUTION_STREAM_KEYS = {
  /** Event buffer for a task (for replay on reconnect) */
  taskEvents: (taskId: string) => `execution:events:${taskId}`,
  /** Consumer group for event consumers */
  consumerGroup: 'execution-events-consumers',
} as const;

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Determine which Kafka topic an event should be published to
 */
export function getTopicForEvent(event: ExecutionEvent): string {
  switch (event.type) {
    case LifecycleEventType.TASK_QUEUED:
    case LifecycleEventType.TASK_STARTED:
    case LifecycleEventType.TASK_COMPLETED:
    case LifecycleEventType.TASK_FAILED:
    case LifecycleEventType.TASK_TIMEOUT:
    case LifecycleEventType.TASK_CANCELLED:
    case LifecycleEventType.TASK_RETRYING:
      return EXECUTION_KAFKA_TOPICS.LIFECYCLE;

    case ProgressEventType.STAGE_STARTED:
    case ProgressEventType.STAGE_COMPLETED:
    case ProgressEventType.PROGRESS_UPDATE:
    case ProgressEventType.AGENT_PLANNING:
    case ProgressEventType.AGENT_GENERATING:
    case ProgressEventType.AGENT_STEP:
      return EXECUTION_KAFKA_TOPICS.PROGRESS;

    case PatchEventType.PATCH_GENERATED:
    case PatchEventType.PATCH_VALIDATING:
    case PatchEventType.PATCH_VALIDATION_PASSED:
    case PatchEventType.PATCH_VALIDATION_FAILED:
    case PatchEventType.PATCH_APPLYING:
    case PatchEventType.PATCH_APPLIED:
    case PatchEventType.FILE_MODIFIED:
    case PatchEventType.ROLLBACK_STARTED:
    case PatchEventType.ROLLBACK_COMPLETED:
      return EXECUTION_KAFKA_TOPICS.PATCHES;

    default:
      // Fallback to lifecycle for unknown types
      return EXECUTION_KAFKA_TOPICS.LIFECYCLE;
  }
}

/**
 * Check if event is a terminal event (task is complete)
 */
export function isTerminalEvent(event: ExecutionEvent): boolean {
  return [
    LifecycleEventType.TASK_COMPLETED,
    LifecycleEventType.TASK_FAILED,
    LifecycleEventType.TASK_TIMEOUT,
    LifecycleEventType.TASK_CANCELLED,
  ].includes(event.type as LifecycleEventType);
}

/**
 * Check if event is a lifecycle event
 */
export function isLifecycleEvent(event: ExecutionEvent): event is LifecycleEvent {
  return Object.values(LifecycleEventType).includes(event.type as LifecycleEventType);
}

/**
 * Check if event is a progress event
 */
export function isProgressEvent(event: ExecutionEvent): event is ProgressEvent {
  return Object.values(ProgressEventType).includes(event.type as ProgressEventType);
}

/**
 * Check if event is a patch event
 */
export function isPatchEvent(event: ExecutionEvent): event is PatchEvent {
  return Object.values(PatchEventType).includes(event.type as PatchEventType);
}
