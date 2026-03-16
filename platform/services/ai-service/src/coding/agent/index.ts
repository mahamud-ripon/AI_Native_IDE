/**
 * Agent Module
 * 
 * AI coding agent orchestration for multi-step code operations.
 */

// Main agent
export {
  CodeAgent,
  getCodeAgent,
  createCodeAgent,
  runAgent,
} from './code_agent.js';
export type { ProgressCallback } from './code_agent.js';

// Plan generator
export {
  PlanGenerator,
  getPlanGenerator,
  createPlanGenerator,
  setLLMProvider,
  getLLMProvider,
  generatePlan,
} from './plan_generator.js';

// Edit planner
export {
  EditPlanner,
  getEditPlanner,
  createEditPlanner,
  planEdits,
} from './edit_planner.js';

// Patch builder
export {
  PatchBuilder,
  getPatchBuilder,
  createPatchBuilder,
  buildPatches,
} from './patch_builder.js';
export type { GeneratedPatch } from './patch_builder.js';

// Verification engine
export {
  VerificationEngine,
  getVerificationEngine,
  createVerificationEngine,
  verifyPatches,
} from './verification_engine.js';

// Tool router
export {
  ToolRouter,
  getToolRouter,
  createToolRouter,
  executeTool,
} from './tool_router.js';

// Types
export {
  PlanAction,
  EditOperation,
  AgentStage,
  ToolName,
  PlanStep,
  CodePlan,
  FileEditPlan,
  EditPlan,
  ToolCall,
  ToolDefinition,
  ToolParameter,
  VerificationResult,
  VerificationError,
  VerificationWarning,
  VerificationStats,
  AgentResult,
  AgentMetrics,
  AgentError,
  AgentProgressEvent,
  AgentConfig,
  LLMMessage,
  LLMToolCall,
  LLMResponse,
  LLMProvider,
  LLMOptions,
  LLMStreamChunk,
  AGENT_DEFAULTS,
  VERIFICATION_ERRORS,
  AGENT_ERRORS,
  AgentExecutionError,
  PlanGenerationError,
  VerificationFailedError,
  ToolExecutionError,
} from './agent_types.js';
