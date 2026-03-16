/**
 * Workflow Engine Module
 * 
 * Exports for the workflow checkpoint persistence system.
 */

// Types
export type {
  WorkflowDefinition,
  WorkflowStep,
  RetryPolicy,
  StepCondition,
  WorkflowState,
  AgentMemory,
  StartWorkflowInput,
  StartWorkflowResult,
  ExecuteStepInput,
  ExecuteStepResult,
  ResumeOptions,
  WorkflowRegistry,
  WorkflowEngine,
  WorkflowRunStatus,
} from './types.js';

// Registry
export { getWorkflowRegistry, resetRegistry } from './registry.js';

// Engine
export { createWorkflowEngine, getWorkflowEngine } from './engine/workflow_engine.js';
export { executeStep } from './engine/step_executor.js';
export {
  createCheckpoint,
  loadLatestCheckpoint,
  restoreState,
  getCheckpointAtStep,
  clearCheckpoints,
} from './engine/resume_manager.js';

// Events
export {
  emitWorkflowStarted,
  emitWorkflowCompleted,
  emitWorkflowFailed,
  emitStepStarted,
  emitStepCompleted,
  emitStepFailed,
  emitCheckpointCreated,
} from './events/workflow_events.js';

// Worker
export {
  startWorkflowWorker,
  stopWorkflowWorker,
  getWorkerStatus,
} from './worker/workflow_worker.js';

// Workflow definitions
export { projectGenerationWorkflow } from './definitions/project_generation.workflow.js';
