/**
 * Patch Module
 * 
 * Unified diff parsing, validation, and application.
 */

// Engine
export {
  DiffEngine,
  getDiffEngine,
  createDiffEngine,
} from './diff_engine.js';

// Parser
export {
  parsePatch,
  extractFilePaths,
  hasNewFiles,
  hasDeletedFiles,
  hasRenamedFiles,
  getPatchSummary,
} from './diff_parser.js';

// Types
export {
  PatchLineType,
  FileOperationType,
  ConflictType,
  PatchLine,
  Hunk,
  FilePatch,
  ParsedPatch,
  Conflict,
  ValidationResult,
  FileApplyResult,
  ApplyResult,
  PatchError,
  PatchLimits,
  DEFAULT_PATCH_LIMITS,
  PatchSafetyError,
  PatchParseError,
  PatchApplyError,
} from './diff_types.js';
