/**
 * Execution Types
 * 
 * Type definitions for the Execution Layer (Phase-5).
 * Covers task orchestration, sandbox validation, and rollback management.
 */

import type {
  AgentResult,
  AgentProgressEvent,
  AgentMode,
  TaskComplexity,
  ToolIntent,
  ToolName,
} from '../agent/agent_types.js';

// Task status
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'validating'
  | 'applying'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'timeout'
  | 'cancelled';

// Sandbox check type
export type SandboxCheckType =
  | 'syntax'
  | 'typecheck'
  | 'lint'
  | 'dependency'
  | 'test'
  | 'build';

// Snapshot status
export type SnapshotStatus =
  | 'creating'
  | 'ready'
  | 'restoring'
  | 'restored'
  | 'failed'
  | 'expired';

export interface TaskRoutingHints {
  complexity?: TaskComplexity;
  toolIntent?: ToolIntent;
  contextFiles?: string[];
}

export interface TaskModeDecision {
  mode: AgentMode;
  reason: string;
  complexity: TaskComplexity;
  modelConfig: { provider: string; model: string };
  maxTurns: number;
  availableTools: ToolName[];
  selectedTools: ToolName[];
  toolIntent?: ToolIntent;
}

// Coding task request
export interface CodingTaskRequest {
  id: string;
  workspaceId: string;
  prompt: string;
  userId: string;
  mode?: AgentMode;                   // direct | plan_execute | multi_agent (auto-detected if not set)
  modelHint?: string;                 // User-selected model from IDE (e.g., "nvidia/meta/llama-3.1-8b-instruct")
  options?: CodingTaskOptions;
  routing?: TaskRoutingHints;
  metadata?: Record<string, unknown>;
  workspaceContext?: {
    fileTree?: string[];
    activeFile?: string | null;
    activeFileContent?: string | null;
    openTabs?: string[];
  };
  createdAt: Date;
}

// Coding task options
export interface CodingTaskOptions {
  timeoutMs?: number;
  maxRetries?: number;
  enableRollback?: boolean;
  enableSandbox?: boolean;
  sandboxChecks?: SandboxCheckType[];
  maxFilesModified?: number;
  dryRun?: boolean;
  streamProgress?: boolean;
}

// Coding task result
export interface CodingTaskResult {
  taskId: string;
  success: boolean;
  status: TaskStatus;
  modeUsed?: AgentMode;               // Which mode was actually used
  modeDecision?: TaskModeDecision;
  agentResult?: AgentResult;
  sandboxResult?: SandboxResult;
  snapshotId?: string;
  rollbackPerformed?: boolean;
  error?: TaskError;
  metrics: TaskMetrics;
  completedAt: Date;
}

// Task error
export interface TaskError {
  code: string;
  message: string;
  stage: 'planning' | 'execution' | 'validation' | 'application' | 'rollback';
  recoverable: boolean;
  details?: Record<string, unknown>;
}

// Task metrics
export interface TaskMetrics {
  totalDurationMs: number;
  planningMs: number;
  executionMs: number;
  validationMs: number;
  applicationMs: number;
  retries: number;
  filesModified: number;
  linesAdded: number;
  linesRemoved: number;
}

// Sandbox result
export interface SandboxResult {
  valid: boolean;
  checks: SandboxCheckResult[];
  errors: SandboxError[];
  warnings: SandboxWarning[];
  durationMs: number;
}

// Sandbox check result
export interface SandboxCheckResult {
  type: SandboxCheckType;
  passed: boolean;
  durationMs: number;
  output?: string;
  errorCount: number;
  warningCount: number;
}

// Sandbox error
export interface SandboxError {
  type: SandboxCheckType;
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  severity: 'error' | 'critical';
}

// Sandbox warning
export interface SandboxWarning {
  type: SandboxCheckType;
  code: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

// Snapshot metadata
export interface SnapshotMetadata {
  id: string;
  workspaceId: string;
  taskId?: string;
  status: SnapshotStatus;
  files: SnapshotFileInfo[];
  totalSizeBytes: number;
  createdAt: Date;
  expiresAt?: Date;
  description?: string;
}

// Snapshot file info
export interface SnapshotFileInfo {
  path: string;
  hash: string;
  sizeBytes: number;
  modifiedAt: Date;
}

// Rollback result
export interface RollbackResult {
  snapshotId: string;
  success: boolean;
  filesRestored: number;
  filesFailed: string[];
  durationMs: number;
  error?: string;
}

// Task progress event
export interface TaskProgressEvent {
  taskId: string;
  status: TaskStatus;
  progress: number;
  stage: string;
  message: string;
  agentProgress?: AgentProgressEvent;
  modeDecision?: TaskModeDecision;
  details?: Record<string, unknown>;
  timestamp: Date;
}

// Task orchestrator config
export interface TaskOrchestratorConfig {
  maxConcurrentTasks: number;
  defaultTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  enableRollback: boolean;
  enableSandbox: boolean;
  snapshotRetentionMs: number;
}

// Sandbox config
export interface SandboxConfig {
  enabledChecks: SandboxCheckType[];
  timeoutMs: number;
  failFast: boolean;
  typecheckCommand?: string;
  lintCommand?: string;
  testCommand?: string;
  buildCommand?: string;
}

// Rollback config
export interface RollbackConfig {
  snapshotDir: string;
  maxSnapshots: number;
  retentionMs: number;
  compressionEnabled: boolean;
}

// Default configurations
export const TASK_ORCHESTRATOR_DEFAULTS: Required<TaskOrchestratorConfig> = {
  maxConcurrentTasks: 5,
  defaultTimeoutMs: 60000,
  maxRetries: 2,
  retryDelayMs: 1000,
  enableRollback: true,
  enableSandbox: true,
  snapshotRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
} as const;

export const SANDBOX_DEFAULTS: Required<SandboxConfig> = {
  enabledChecks: ['syntax', 'typecheck', 'lint'],
  timeoutMs: 30000,
  failFast: true,
  typecheckCommand: 'npx tsc --noEmit',
  lintCommand: 'npx eslint',
  testCommand: 'npm test',
  buildCommand: 'npm run build',
} as const;

export const ROLLBACK_DEFAULTS: Required<RollbackConfig> = {
  snapshotDir: 'ai-ide-snapshots',
  maxSnapshots: 10,
  retentionMs: 24 * 60 * 60 * 1000, // 24 hours
  compressionEnabled: true,
} as const;

// Error codes
export const TASK_ERRORS = {
  TIMEOUT: 'TASK_TIMEOUT',
  CANCELLED: 'TASK_CANCELLED',
  PLANNING_FAILED: 'PLANNING_FAILED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  SANDBOX_FAILED: 'SANDBOX_FAILED',
  APPLICATION_FAILED: 'APPLICATION_FAILED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  MAX_RETRIES_EXCEEDED: 'MAX_RETRIES_EXCEEDED',
} as const;

export const SANDBOX_ERRORS = {
  SYNTAX_ERROR: 'SYNTAX_ERROR',
  TYPE_ERROR: 'TYPE_ERROR',
  LINT_ERROR: 'LINT_ERROR',
  DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
  TEST_FAILURE: 'TEST_FAILURE',
  BUILD_FAILURE: 'BUILD_FAILURE',
  TIMEOUT: 'SANDBOX_TIMEOUT',
} as const;

export const ROLLBACK_ERRORS = {
  SNAPSHOT_NOT_FOUND: 'SNAPSHOT_NOT_FOUND',
  SNAPSHOT_EXPIRED: 'SNAPSHOT_EXPIRED',
  RESTORE_FAILED: 'RESTORE_FAILED',
  COMPRESSION_ERROR: 'COMPRESSION_ERROR',
} as const;

// Task execution error
export class TaskExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly stage: TaskError['stage'],
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'TaskExecutionError';
  }
}

// Sandbox validation error
export class SandboxValidationError extends Error {
  constructor(
    message: string,
    public readonly result: SandboxResult
  ) {
    super(message);
    this.name = 'SandboxValidationError';
  }
}

// Rollback error
export class RollbackError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly snapshotId?: string
  ) {
    super(message);
    this.name = 'RollbackError';
  }
}
