/**
 * Workflow Engine Types
 * 
 * Core types for defining and executing resumable AI workflows.
 */

import type { LLMTaskType } from '../llm/types.js';

// -----------------------------------------------------------------------------
// WORKFLOW DEFINITION TYPES
// -----------------------------------------------------------------------------

/**
 * Retry policy for step execution
 */
export interface RetryPolicy {
  /** Maximum retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelayMs?: number;
}

/**
 * Condition for conditional step execution
 */
export interface StepCondition {
  /** JSONPath expression to evaluate */
  path: string;
  /** Comparison operator */
  operator: 'eq' | 'neq' | 'exists' | 'gt' | 'lt' | 'gte' | 'lte';
  /** Value to compare against */
  value?: unknown;
}

/**
 * Single step in a workflow definition
 */
export interface WorkflowStep {
  /** Step index (0-based, sequential) */
  stepIndex: number;
  /** Human-readable step name */
  stepName: string;
  /** Agent responsible for this step */
  agentName: string;
  /** Task type for LLM routing */
  taskType: LLMTaskType;
  /** Optional model hint for LLM gateway */
  modelHint?: string;
  /** Retry policy (defaults to 3 retries) */
  retryPolicy?: RetryPolicy;
  /** Optional condition for conditional execution */
  condition?: StepCondition;
  /** Timeout in milliseconds (default: 300000 = 5 min) */
  timeoutMs?: number;
  /** Whether step can be skipped on failure */
  optional?: boolean;
  /** Input mapping from context */
  inputMapping?: Record<string, string>;
  /** Output mapping to context */
  outputMapping?: Record<string, string>;
}

/**
 * Workflow definition structure
 */
export interface WorkflowDefinition {
  /** Unique workflow name */
  name: string;
  /** Workflow version for compatibility tracking */
  version: number;
  /** Human-readable description */
  description?: string;
  /** Ordered list of steps */
  steps: WorkflowStep[];
  /** Default retry policy for all steps */
  defaultRetryPolicy?: RetryPolicy;
  /** Maximum total workflow duration in ms (default: 3600000 = 1 hour) */
  maxDurationMs?: number;
  /** Whether to checkpoint before each step */
  checkpointBeforeStep?: boolean;
  /** Whether to checkpoint after each step */
  checkpointAfterStep?: boolean;
}

// -----------------------------------------------------------------------------
// WORKFLOW STATE TYPES
// -----------------------------------------------------------------------------

/**
 * Agent memory snapshot
 */
export interface AgentMemory {
  /** Conversation history */
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
  }>;
  /** Agent-local variables */
  variables: Record<string, unknown>;
  /** Last output from this agent */
  lastOutput?: string;
}

/**
 * Workflow state stored in checkpoints
 */
export interface WorkflowState {
  /** Schema version for migrations */
  stateVersion: 1;
  
  /** Timestamp of state creation */
  timestamp: string;
  
  /** Per-agent memory */
  agentMemory: Record<string, AgentMemory>;
  
  /** Shared workflow context */
  context: {
    projectId: string;
    userId?: string;
    conversationId?: string;
    /** User-defined variables */
    variables: Record<string, unknown>;
    /** Files modified during workflow */
    modifiedFiles?: string[];
  };
  
  /** Execution progress tracking */
  progress: {
    /** Completed step indices */
    completedSteps: number[];
    /** Failed step indices */
    failedSteps: number[];
    /** Skipped step indices */
    skippedSteps: number[];
    /** Currently executing step (-1 if none) */
    currentStep: number;
  };
}

// -----------------------------------------------------------------------------
// ENGINE INPUT/OUTPUT TYPES
// -----------------------------------------------------------------------------

/**
 * Input for starting a new workflow
 */
export interface StartWorkflowInput {
  /** Project ID */
  projectId: string;
  /** Workflow name to execute */
  workflowName: string;
  /** User who triggered the workflow */
  userId?: string;
  /** Organization ID */
  orgId?: string;
  /** Conversation ID for AI context */
  conversationId?: string;
  /** Initial context variables */
  initialContext?: Record<string, unknown>;
  /** Trigger type */
  triggerType?: 'manual' | 'git_push' | 'ai_agent_auto' | 'scheduled';
  /** Parent workflow run ID (for sub-workflows) */
  parentRunId?: string;
}

/**
 * Result of workflow start operation
 */
export interface StartWorkflowResult {
  /** Created workflow run ID */
  workflowRunId: string;
  /** Initial status */
  status: 'pending' | 'running';
  /** Total steps in workflow */
  totalSteps: number;
}

/**
 * Input for step execution
 */
export interface ExecuteStepInput {
  /** Workflow run ID */
  workflowRunId: string;
  /** Step index to execute */
  stepIndex: number;
  /** Force re-execution even if completed */
  force?: boolean;
}

/**
 * Result of step execution
 */
export interface ExecuteStepResult {
  /** Step run ID */
  stepRunId: string;
  /** Execution status */
  status: 'completed' | 'failed' | 'skipped';
  /** Output data */
  output?: unknown;
  /** Error message if failed */
  error?: string;
  /** LLM metrics */
  metrics?: {
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number;
    provider: string;
    model: string;
  };
}

/**
 * Resume options
 */
export interface ResumeOptions {
  /** Specific step to resume from (overrides checkpoint) */
  fromStep?: number;
  /** Skip completed steps */
  skipCompleted?: boolean;
  /** Clear failed status and retry */
  retryFailed?: boolean;
}

// -----------------------------------------------------------------------------
// WORKFLOW REGISTRY TYPE
// -----------------------------------------------------------------------------

/**
 * Registry of available workflows
 */
export interface WorkflowRegistry {
  /** Get workflow definition by name */
  get(name: string): WorkflowDefinition | undefined;
  
  /** Register a new workflow definition */
  register(definition: WorkflowDefinition): void;
  
  /** List all registered workflows */
  list(): WorkflowDefinition[];
  
  /** Check if workflow exists */
  has(name: string): boolean;
}

// -----------------------------------------------------------------------------
// WORKFLOW ENGINE INTERFACE
// -----------------------------------------------------------------------------

/**
 * Main workflow engine interface
 */
export interface WorkflowEngine {
  /**
   * Start a new workflow execution
   */
  startWorkflow(input: StartWorkflowInput): Promise<StartWorkflowResult>;
  
  /**
   * Execute the next pending step in a workflow
   */
  executeNextStep(workflowRunId: string): Promise<ExecuteStepResult | null>;
  
  /**
   * Resume a paused or crashed workflow
   */
  resumeWorkflow(workflowRunId: string, options?: ResumeOptions): Promise<void>;
  
  /**
   * Cancel a running workflow
   */
  cancelWorkflow(workflowRunId: string, reason?: string): Promise<void>;
  
  /**
   * Pause a running workflow
   */
  pauseWorkflow(workflowRunId: string): Promise<void>;
  
  /**
   * Get workflow run status
   */
  getStatus(workflowRunId: string): Promise<WorkflowRunStatus>;
  
  /**
   * Get checkpoint for a workflow run
   */
  getLatestCheckpoint(workflowRunId: string): Promise<WorkflowState | null>;
}

/**
 * Workflow run status summary
 */
export interface WorkflowRunStatus {
  workflowRunId: string;
  workflowName: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  totalSteps: number;
  completedSteps: number[];
  failedSteps: number[];
  startedAt?: Date;
  completedAt?: Date;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number | null;
  errorMessage?: string;
  errorStep?: number;
}
