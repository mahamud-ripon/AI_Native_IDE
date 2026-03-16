/**
 * Diff Types
 * 
 * Type definitions for the Patch/Diff Engine.
 */

// Patch line type
export type PatchLineType = 'context' | 'add' | 'remove';

// File operation type
export type FileOperationType = 'modify' | 'create' | 'delete' | 'rename';

// Conflict type
export type ConflictType = 'context_mismatch' | 'already_applied' | 'line_missing' | 'file_not_found';

// Single line in a patch
export interface PatchLine {
  type: PatchLineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// Hunk (contiguous change block)
export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: PatchLine[];
}

// File-level patch
export interface FilePatch {
  oldPath: string | null;
  newPath: string | null;
  operation: FileOperationType;
  hunks: Hunk[];
  binary?: boolean;
}

// Parsed patch structure
export interface ParsedPatch {
  files: FilePatch[];
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalHunks: number;
}

// Conflict during validation
export interface Conflict {
  file: string;
  hunkIndex: number;
  lineIndex?: number;
  type: ConflictType;
  expectedContent?: string;
  actualContent?: string;
  message: string;
}

// Validation result
export interface ValidationResult {
  valid: boolean;
  conflicts: Conflict[];
  warnings: string[];
  stats: {
    filesAffected: number;
    linesAdded: number;
    linesRemoved: number;
  };
}

// File-level apply result
export interface FileApplyResult {
  path: string;
  operation: FileOperationType;
  linesAdded: number;
  linesRemoved: number;
  success: boolean;
  error?: string;
}

// Apply result
export interface ApplyResult {
  success: boolean;
  filesChanged: FileApplyResult[];
  totalLinesAdded: number;
  totalLinesRemoved: number;
  errors: PatchError[];
  warnings: string[];
}

// Patch error
export interface PatchError {
  file: string;
  message: string;
  type: 'parse_error' | 'apply_error' | 'conflict' | 'limit_exceeded' | 'file_error';
  hunkIndex?: number;
  lineIndex?: number;
}

// Safety limits
export interface PatchLimits {
  maxFilesPerPatch: number;
  maxLinesPerPatch: number;
  maxHunksPerFile: number;
  maxLineLength: number;
}

// Default safety limits
export const DEFAULT_PATCH_LIMITS: PatchLimits = {
  maxFilesPerPatch: 10,
  maxLinesPerPatch: 2000,
  maxHunksPerFile: 50,
  maxLineLength: 1000,
};

// Patch safety error
export class PatchSafetyError extends Error {
  constructor(
    message: string,
    public readonly limit: keyof PatchLimits,
    public readonly actual: number,
    public readonly max: number
  ) {
    super(message);
    this.name = 'PatchSafetyError';
  }
}

// Patch parse error
export class PatchParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number
  ) {
    super(message);
    this.name = 'PatchParseError';
  }
}

// Patch apply error
export class PatchApplyError extends Error {
  constructor(
    message: string,
    public readonly errors: PatchError[]
  ) {
    super(message);
    this.name = 'PatchApplyError';
  }
}
