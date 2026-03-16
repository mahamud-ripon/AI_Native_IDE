/**
 * Refactor Types
 * 
 * Type definitions for the AI-powered refactoring feature.
 */

// Refactor operation type
export type RefactorOperation =
  | 'rename'
  | 'extract_function'
  | 'extract_variable'
  | 'extract_constant'
  | 'inline_variable'
  | 'inline_function'
  | 'move_file'
  | 'convert_to_async'
  | 'convert_to_sync'
  | 'convert_to_typescript'
  | 'convert_to_javascript'
  | 'add_types'
  | 'remove_unused'
  | 'organize_imports'
  | 'simplify_condition'
  | 'split_function'
  | 'merge_functions';

// Refactor status
export type RefactorStatus =
  | 'pending'
  | 'analyzing'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'rolled_back';

// Refactor scope
export type RefactorScope = 'single_file' | 'multi_file' | 'project_wide';

// Symbol reference
export interface SymbolReference {
  path: string;
  line: number;
  column: number;
  context: string;
}

// Refactor request
export interface RefactorRequest {
  id: string;
  workspaceId: string;
  userId: string;
  operation: RefactorOperation;
  target: RefactorTarget;
  options?: RefactorOptions;
  timestamp: Date;
}

// Refactor target
export interface RefactorTarget {
  // For rename operations
  symbolName?: string;
  newName?: string;

  // For extract operations
  selection?: {
    path: string;
    content: string;
    startLine: number;
    endLine: number;
    language: string;
  };

  // For move operations
  sourcePath?: string;
  targetPath?: string;

  // For file-level operations
  filePath?: string;
}

// Refactor options
export interface RefactorOptions {
  scope?: RefactorScope;
  dryRun?: boolean;
  previewChanges?: boolean;
  updateReferences?: boolean;
  preserveComments?: boolean;
  generateBackup?: boolean;
  maxFiles?: number;
}

// Refactor result
export interface RefactorResult {
  id: string;
  requestId: string;
  success: boolean;
  status: RefactorStatus;
  operation: RefactorOperation;
  changes: RefactorChange[];
  summary: RefactorSummary;
  warnings?: string[];
  error?: string;
  metrics: RefactorMetrics;
}

// Refactor change
export interface RefactorChange {
  id: string;
  path: string;
  operation: 'create' | 'modify' | 'delete' | 'rename';
  originalContent?: string;
  newContent?: string;
  patch?: string;
  linesAdded: number;
  linesRemoved: number;
  references?: SymbolReference[];
}

// Refactor summary
export interface RefactorSummary {
  filesAffected: number;
  symbolsRenamed: number;
  functionsExtracted: number;
  referencesUpdated: number;
  linesChanged: number;
}

// Refactor metrics
export interface RefactorMetrics {
  analysisMs: number;
  executionMs: number;
  verificationMs: number;
  totalMs: number;
  tokensUsed: number;
}

// Refactor plan
export interface RefactorPlan {
  id: string;
  operation: RefactorOperation;
  steps: RefactorStep[];
  affectedFiles: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  requiresVerification: boolean;
  canRollback: boolean;
}

// Refactor step
export interface RefactorStep {
  step: number;
  action: string;
  file?: string;
  description: string;
  dependencies?: number[];
}

// Refactor service config
export interface RefactorConfig {
  maxFilesPerRefactor: number;
  enableProjectWideRefactors: boolean;
  requirePreview: boolean;
  enableAutoVerification: boolean;
  backupEnabled: boolean;
}

// Default configuration
export const REFACTOR_DEFAULTS: Required<RefactorConfig> = {
  maxFilesPerRefactor: 50,
  enableProjectWideRefactors: true,
  requirePreview: true,
  enableAutoVerification: true,
  backupEnabled: true,
} as const;

// Operation descriptions
export const REFACTOR_OPERATIONS: Record<RefactorOperation, {
  description: string;
  scope: RefactorScope;
  requiresSymbol: boolean;
}> = {
  rename: {
    description: 'Rename a symbol across all references',
    scope: 'project_wide',
    requiresSymbol: true,
  },
  extract_function: {
    description: 'Extract selected code into a new function',
    scope: 'single_file',
    requiresSymbol: false,
  },
  extract_variable: {
    description: 'Extract expression into a variable',
    scope: 'single_file',
    requiresSymbol: false,
  },
  extract_constant: {
    description: 'Extract value into a constant',
    scope: 'single_file',
    requiresSymbol: false,
  },
  inline_variable: {
    description: 'Inline variable usage',
    scope: 'single_file',
    requiresSymbol: true,
  },
  inline_function: {
    description: 'Inline function calls',
    scope: 'single_file',
    requiresSymbol: true,
  },
  move_file: {
    description: 'Move file and update all imports',
    scope: 'multi_file',
    requiresSymbol: false,
  },
  convert_to_async: {
    description: 'Convert sync code to async/await',
    scope: 'single_file',
    requiresSymbol: false,
  },
  convert_to_sync: {
    description: 'Convert async code to synchronous',
    scope: 'single_file',
    requiresSymbol: false,
  },
  convert_to_typescript: {
    description: 'Convert JavaScript to TypeScript',
    scope: 'single_file',
    requiresSymbol: false,
  },
  convert_to_javascript: {
    description: 'Convert TypeScript to JavaScript',
    scope: 'single_file',
    requiresSymbol: false,
  },
  add_types: {
    description: 'Add type annotations to code',
    scope: 'single_file',
    requiresSymbol: false,
  },
  remove_unused: {
    description: 'Remove unused imports and variables',
    scope: 'single_file',
    requiresSymbol: false,
  },
  organize_imports: {
    description: 'Sort and organize imports',
    scope: 'single_file',
    requiresSymbol: false,
  },
  simplify_condition: {
    description: 'Simplify conditional expressions',
    scope: 'single_file',
    requiresSymbol: false,
  },
  split_function: {
    description: 'Split a large function into smaller ones',
    scope: 'single_file',
    requiresSymbol: true,
  },
  merge_functions: {
    description: 'Merge similar functions',
    scope: 'single_file',
    requiresSymbol: true,
  },
} as const;
