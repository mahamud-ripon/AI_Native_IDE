/**
 * Inline Edit Types
 * 
 * Type definitions for inline code editing feature.
 */

// Edit operation type
export type InlineEditOperation = 
  | 'modify'
  | 'refactor'
  | 'optimize'
  | 'document'
  | 'fix'
  | 'convert';

// Edit status
export type InlineEditStatus = 
  | 'pending'
  | 'processing'
  | 'preview'
  | 'approved'
  | 'applied'
  | 'rejected'
  | 'failed';

// Code selection
export interface CodeSelection {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  language: string;
}

// Inline edit request
export interface InlineEditRequest {
  id: string;
  workspaceId: string;
  userId: string;
  selection: CodeSelection;
  instruction: string;
  operation?: InlineEditOperation;
  options?: InlineEditOptions;
  timestamp: Date;
}

// Inline edit options
export interface InlineEditOptions {
  preserveStyle?: boolean;
  addComments?: boolean;
  maxTokens?: number;
  temperature?: number;
  previewOnly?: boolean;
  autoApply?: boolean;
}

// Inline edit result
export interface InlineEditResult {
  id: string;
  requestId: string;
  success: boolean;
  status: InlineEditStatus;
  originalCode: string;
  modifiedCode: string;
  patch?: string;
  diff?: CodeDiff;
  explanation?: string;
  warnings?: string[];
  error?: string;
  metrics: InlineEditMetrics;
}

// Code diff
export interface CodeDiff {
  additions: DiffLine[];
  deletions: DiffLine[];
  unchanged: DiffLine[];
  summary: string;
}

// Diff line
export interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'add' | 'remove' | 'context';
}

// Inline edit metrics
export interface InlineEditMetrics {
  tokensUsed: number;
  latencyMs: number;
  linesAdded: number;
  linesRemoved: number;
  linesUnchanged: number;
}

// Edit preview
export interface EditPreview {
  id: string;
  requestId: string;
  original: string;
  modified: string;
  diff: CodeDiff;
  explanation: string;
  confidence: number;
  suggestions?: string[];
}

// Edit history entry
export interface EditHistoryEntry {
  id: string;
  workspaceId: string;
  userId: string;
  path: string;
  operation: InlineEditOperation;
  timestamp: Date;
  success: boolean;
  linesChanged: number;
}

// Inline edit service config
export interface InlineEditConfig {
  defaultOperation: InlineEditOperation;
  maxSelectionLines: number;
  preserveStyle: boolean;
  previewByDefault: boolean;
  autoApplyThreshold: number; // Confidence threshold for auto-apply
}

// Default configuration
export const INLINE_EDIT_DEFAULTS: Required<InlineEditConfig> = {
  defaultOperation: 'modify',
  maxSelectionLines: 100,
  preserveStyle: true,
  previewByDefault: true,
  autoApplyThreshold: 0.9,
} as const;

// Operation prompts
export const OPERATION_PROMPTS: Record<InlineEditOperation, string> = {
  modify: `Modify the selected code according to the instruction. Preserve the existing code style and patterns.`,

  refactor: `Refactor the selected code to improve its structure, readability, or performance while preserving its behavior. Apply clean code principles.`,

  optimize: `Optimize the selected code for performance. Consider algorithmic complexity, memory usage, and common optimization patterns.`,

  document: `Add documentation to the selected code. Include JSDoc/TSDoc comments, inline comments for complex logic, and describe parameters and return values.`,

  fix: `Fix bugs or issues in the selected code. Identify potential problems and correct them while preserving intended behavior.`,

  convert: `Convert the selected code to a different style or pattern (e.g., callback to async/await, var to const/let, class to functional).`,
} as const;
