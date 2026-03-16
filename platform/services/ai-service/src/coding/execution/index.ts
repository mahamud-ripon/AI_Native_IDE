/**
 * Execution Module
 * 
 * Production execution layer for AI coding operations.
 * Provides task orchestration, sandbox validation, and rollback management.
 */

// Task orchestrator
export {
  TaskOrchestrator,
  getTaskOrchestrator,
  createTaskOrchestrator,
  runCodingTask,
} from './task_orchestrator.js';

// Rollback manager
export {
  RollbackManager,
  getRollbackManager,
  createRollbackManager,
  createSnapshot,
  restoreSnapshot,
} from './rollback_manager.js';

// Patch sandbox
export {
  PatchSandbox,
  getPatchSandbox,
  createPatchSandbox,
  validatePatch,
  validatePatches,
} from './patch_sandbox.js';

// Coding worker
export {
  CodingWorker,
  getCodingWorker,
  createCodingWorker,
  processCodingJob,
  createCodingJob,
  CODING_JOB_TYPE,
} from './coding_worker.js';

// Types
export {
  TaskStatus,
  SandboxCheckType,
  SnapshotStatus,
  CodingTaskRequest,
  CodingTaskOptions,
  CodingTaskResult,
  TaskError,
  TaskMetrics,
  SandboxResult,
  SandboxCheckResult,
  SandboxError,
  SandboxWarning,
  SnapshotMetadata,
  SnapshotFileInfo,
  RollbackResult,
  TaskProgressEvent,
  TaskOrchestratorConfig,
  SandboxConfig,
  RollbackConfig,
  TASK_ORCHESTRATOR_DEFAULTS,
  SANDBOX_DEFAULTS,
  ROLLBACK_DEFAULTS,
  TASK_ERRORS,
  SANDBOX_ERRORS,
  ROLLBACK_ERRORS,
  TaskExecutionError,
  SandboxValidationError,
  RollbackError,
} from './execution_types.js';
