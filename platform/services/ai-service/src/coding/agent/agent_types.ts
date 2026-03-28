/**
 * Agent Types
 * 
 * Type definitions for the CodeAgent execution pipeline.
 */

import { CodeChunk } from '../retrieval/retrieval_types.js';
import { ProjectContext } from '../context/context_types.js';

// Agent execution modes (3-mode architecture)
export type AgentMode = 'direct' | 'plan_execute' | 'multi_agent';

// Task complexity hints used by the router
export type TaskComplexity = 'low' | 'medium' | 'high';

// Plan action types
export type PlanAction =
  | 'create_file'
  | 'modify_file'
  | 'delete_file'
  | 'rename_file'
  | 'search_code'
  | 'read_file';

// Edit operation types
export type EditOperation =
  | 'create'
  | 'modify'
  | 'delete'
  | 'rename';

// Agent stage
export type AgentStage =
  | 'initializing'
  | 'building_context'
  | 'planning'
  | 'searching'
  | 'editing'
  | 'building_patch'
  | 'verifying'
  | 'applying'
  | 'completed'
  | 'failed';

// Tool names
export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'delete_file'
  | 'edit_file'
  | 'apply_patch'
  | 'search_code'
  | 'list_files'
  | 'get_context'
  | 'execute_command';

// High-level tool capabilities for routing and observability
export type ToolCapability =
  | 'read'
  | 'write'
  | 'modify'
  | 'delete'
  | 'search'
  | 'inspect'
  | 'context'
  | 'execute'
  | 'debug';

// Optional tool preferences supplied by the client
export interface ToolIntent {
  preferredTools?: ToolName[];
  requiredTools?: ToolName[];
  readOnly?: boolean;
}

// Plan step
export interface PlanStep {
  step: number;
  action: PlanAction;
  file?: string;
  description: string;
  dependencies?: number[];  // Step numbers this depends on
  estimatedComplexity?: 'low' | 'medium' | 'high';
}

// Code plan
export interface CodePlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  affectedFiles: string[];
  newFiles: string[];
  deletedFiles: string[];
  confidence: number;  // 0-1
  reasoning: string;
  createdAt: Date;
}

// File edit plan
export interface FileEditPlan {
  id: string;
  path: string;
  operation: EditOperation;
  instructions: string;
  contextChunks: CodeChunk[];
  originalContent?: string;
  targetContent?: string;
  renameFrom?: string;  // For rename operations
}

// Edit plan collection
export interface EditPlan {
  id: string;
  planId: string;
  edits: FileEditPlan[];
  createdAt: Date;
}

// Tool call
export interface ToolCall {
  id: string;
  name: ToolName;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp: Date;
}

// Tool parameter
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
}

// Standardized Tool Result
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
}

// Tool definition
export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: ToolParameter[];
  capabilities?: ToolCapability[];
  permissions?: string[];     // Array of roles/agents allowed to use this tool (e.g. ['admin', 'engineer'])
  timeoutMs?: number;         // Max execution time before throwing
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

// Verification result
export interface VerificationResult {
  valid: boolean;
  errors: VerificationError[];
  warnings: VerificationWarning[];
  stats: VerificationStats;
}

// Verification error
export interface VerificationError {
  code: string;
  message: string;
  file?: string;
  line?: number;
  severity: 'error' | 'critical';
}

// Verification warning
export interface VerificationWarning {
  code: string;
  message: string;
  file?: string;
  suggestion?: string;
}

// Verification stats
export interface VerificationStats {
  filesChecked: number;
  syntaxValid: number;
  syntaxInvalid: number;
  conflicts: number;
  importIssues: number;
}

// Agent result
export interface AgentResult {
  success: boolean;
  plan: CodePlan;
  patches: string[];
  filesChanged: string[];
  summary: string;
  metrics: AgentMetrics;
  error?: AgentError;
}

// Agent metrics
export interface AgentMetrics {
  totalSteps: number;
  completedSteps: number;
  filesRead: number;
  filesModified: number;
  patchesGenerated: number;
  patchesApplied: number;
  contextTokens: number;
  executionTimeMs: number;
  llmCalls: number;
}

// Agent error
export interface AgentError {
  stage: AgentStage;
  message: string;
  recoverable: boolean;
  suggestion?: string;
}

// Agent progress event
export interface AgentProgressEvent {
  agentId: string;
  stage: AgentStage;
  progress: number;  // 0-1
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

// Agent configuration
export interface AgentConfig {
  maxFilesModified: number;     // Default: 10
  maxPatchLines: number;        // Default: 2000
  maxIterations: number;        // Default: 5
  timeoutMs: number;            // Default: 30000
  enableVerification: boolean; // Default: true
  enableRollback: boolean;     // Default: true
  streamingEnabled: boolean;   // Default: true
  contextMaxTokens: number;     // Default: 20000
}

// LLM message
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

// LLM tool call
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// LLM response
export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

// LLM provider
export interface LLMProvider {
  complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
  stream(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
}

// LLM tool definition for passing to LLM (without execute function)
export interface LLMToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

// LLM options
export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: LLMToolSchema[];
  stopSequences?: string[];
}

// LLM stream chunk
export interface LLMStreamChunk {
  content?: string;
  toolCall?: LLMToolCall;
  done: boolean;
}

// Agent defaults
export const AGENT_DEFAULTS: Required<AgentConfig> = {
  maxFilesModified: 10,
  maxPatchLines: 2000,
  maxIterations: 5,
  timeoutMs: 30000,
  enableVerification: true,
  enableRollback: true,
  streamingEnabled: true,
  contextMaxTokens: 20000,
} as const;

// Verification error codes
export const VERIFICATION_ERRORS = {
  SYNTAX_ERROR: 'SYNTAX_ERROR',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_EXISTS: 'FILE_EXISTS',
  PATCH_CONFLICT: 'PATCH_CONFLICT',
  PATCH_TOO_LARGE: 'PATCH_TOO_LARGE',
  IMPORT_MISSING: 'IMPORT_MISSING',
  INVALID_OPERATION: 'INVALID_OPERATION',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

// Agent error codes
export const AGENT_ERRORS = {
  PLANNING_FAILED: 'PLANNING_FAILED',
  EDIT_FAILED: 'EDIT_FAILED',
  PATCH_BUILD_FAILED: 'PATCH_BUILD_FAILED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  APPLY_FAILED: 'APPLY_FAILED',
  TIMEOUT: 'TIMEOUT',
  LLM_ERROR: 'LLM_ERROR',
  TOOL_ERROR: 'TOOL_ERROR',
} as const;

// Agent error class
export class AgentExecutionError extends Error {
  constructor(
    message: string,
    public readonly stage: AgentStage,
    public readonly code: string,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'AgentExecutionError';
  }
}

// Plan generation error
export class PlanGenerationError extends Error {
  constructor(message: string, public readonly partial?: Partial<CodePlan>) {
    super(message);
    this.name = 'PlanGenerationError';
  }
}

// Verification error
export class VerificationFailedError extends Error {
  constructor(
    message: string,
    public readonly result: VerificationResult
  ) {
    super(message);
    this.name = 'VerificationFailedError';
  }
}

// Tool execution error
export class ToolExecutionError extends Error {
  public readonly code: string;

  constructor(
    toolName: string,
    message: string,
    public readonly args: Record<string, unknown>,
    code?: string,
    public readonly originalError?: Error
  ) {
    super(`Tool '${toolName}' failed: ${message}`);
    this.name = 'ToolExecutionError';
    this.code = code || 'EXECUTION_FAILED';
    if (originalError?.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }
}
