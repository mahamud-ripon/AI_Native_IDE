/**
 * Chat Types
 * 
 * Type definitions for the AI Coding Chat feature.
 */

// Chat message role
export type ChatRole = 'user' | 'assistant' | 'system';

// Chat message status
export type ChatStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';

// Chat action type
export type ChatActionType =
  | 'code_edit'
  | 'code_create'
  | 'code_delete'
  | 'search'
  | 'explain'
  | 'refactor'
  | 'test'
  | 'question';

// Chat message
export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  status: ChatStatus;
  timestamp: Date;
  metadata?: ChatMessageMetadata;
}

// Chat message metadata
export interface ChatMessageMetadata {
  action?: ChatActionType;
  filesReferenced?: string[];
  filesModified?: string[];
  patchesGenerated?: string[];
  tokensUsed?: number;
  model?: string;
  latencyMs?: number;
  traceId?: string;
}

// Chat conversation
export interface ChatConversation {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  context: ConversationContext;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'archived' | 'deleted';
}

// Conversation context
export interface ConversationContext {
  activeFiles: string[];
  selectedCode?: SelectedCode;
  lastSearchQuery?: string;
  relevantChunks?: ContextChunk[];
  projectContext?: ProjectContextSummary;
}

// Selected code (for inline context)
export interface SelectedCode {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
}

// Context chunk
export interface ContextChunk {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  relevance: number;
  reason: string;
}

// Project context summary
export interface ProjectContextSummary {
  language?: string;
  framework?: string;
  projectType?: string;
  dependencies?: string[];
  structure?: string;
}

// Chat request
export interface ChatRequest {
  id: string;
  conversationId: string;
  workspaceId: string;
  userId: string;
  message: string;
  context?: ConversationContext;
  options?: ChatOptions;
  timestamp: Date;
}

// Chat options
export interface ChatOptions {
  streamResponse?: boolean;
  executeEdits?: boolean;
  previewPatches?: boolean;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  includeContext?: boolean;
  contextMaxTokens?: number;
}

// Chat response
export interface ChatResponse {
  id: string;
  requestId: string;
  conversationId: string;
  message: ChatMessage;
  action?: ChatAction;
  patches?: ChatPatch[];
  context?: ConversationContext;
  metrics: ChatMetrics;
}

// Chat action
export interface ChatAction {
  type: ChatActionType;
  description: string;
  files: string[];
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: ActionResult;
}

// Action result
export interface ActionResult {
  success: boolean;
  filesModified: string[];
  patchesApplied: number;
  error?: string;
}

// Chat patch
export interface ChatPatch {
  id: string;
  path: string;
  operation: 'create' | 'modify' | 'delete';
  patch: string;
  preview: string;
  linesAdded: number;
  linesRemoved: number;
  status: 'pending' | 'approved' | 'applied' | 'rejected';
}

// Chat metrics
export interface ChatMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  contextTokens: number;
  searchLatencyMs?: number;
  planningLatencyMs?: number;
  executionLatencyMs?: number;
}

// Chat stream event
export interface ChatStreamEvent {
  type: 'content' | 'action' | 'patch' | 'progress' | 'error' | 'done';
  content?: string;
  action?: ChatAction;
  patch?: ChatPatch;
  progress?: StreamProgress;
  error?: string;
}

// Stream progress
export interface StreamProgress {
  stage: 'thinking' | 'searching' | 'planning' | 'executing' | 'verifying' | 'done';
  progress: number;
  message: string;
}

// Chat history query
export interface ChatHistoryQuery {
  workspaceId?: string;
  userId?: string;
  conversationId?: string;
  limit?: number;
  offset?: number;
  startDate?: Date;
  endDate?: Date;
}

// Chat service config
export interface ChatServiceConfig {
  maxHistoryMessages: number;
  contextMaxTokens: number;
  defaultModel: string;
  defaultTemperature: number;
  streamEnabled: boolean;
  autoExecuteEdits: boolean;
  requirePatchApproval: boolean;
}

// Default configuration
export const CHAT_SERVICE_DEFAULTS: Required<ChatServiceConfig> = {
  maxHistoryMessages: 50,
  contextMaxTokens: 20000,
  defaultModel: 'gpt-4-turbo',
  defaultTemperature: 0.3,
  streamEnabled: true,
  autoExecuteEdits: false,
  requirePatchApproval: true,
} as const;

// System prompts
export const SYSTEM_PROMPTS = {
  default: `You are an expert coding assistant integrated into an AI IDE. You help developers write, modify, and understand code.

## Capabilities
- Read and write files in the workspace
- Search code semantically
- Generate and apply patches
- Explain code and architecture
- Refactor and optimize code

## Guidelines
1. Always understand the context before making changes
2. Explain your reasoning before executing
3. Show previews of changes before applying
4. Consider project conventions and patterns
5. Be concise and actionable`,

  codeEdit: `You are a code editing assistant. Your task is to modify code according to the user's request.

## Process
1. Analyze the current code and context
2. Plan the necessary changes
3. Generate a unified diff patch
4. Explain what changed and why

## Rules
- Preserve existing code style
- Only modify what's necessary
- Add comments for complex changes
- Ensure imports are correct`,

  explain: `You are a code explanation assistant. Your task is to help developers understand code.

## Process
1. Analyze the code structure
2. Identify key components and patterns
3. Explain dependencies and relationships
4. Provide context about architecture

## Guidelines
- Use clear, simple language
- Provide examples when helpful
- Reference relevant files and functions
- Explain the "why" not just the "what"`,

  refactor: `You are a refactoring assistant. Your task is to improve code quality while preserving behavior.

## Supported Refactors
- Rename symbols
- Extract functions/methods
- Convert between async/sync
- Modernize syntax
- Apply design patterns

## Rules
- Preserve exact behavior
- Run tests after refactoring
- Make incremental changes
- Document breaking changes`,
} as const;
