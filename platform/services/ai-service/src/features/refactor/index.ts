/**
 * Refactor Feature Module
 * 
 * AI-powered code refactoring operations.
 */

// Service
export {
  RefactorService,
  getRefactorService,
  createRefactorService,
  performRefactor,
} from './refactor_service.js';

// Types
export {
  RefactorOperation,
  RefactorStatus,
  RefactorScope,
  SymbolReference,
  RefactorRequest,
  RefactorTarget,
  RefactorOptions,
  RefactorResult,
  RefactorChange,
  RefactorSummary,
  RefactorMetrics,
  RefactorPlan,
  RefactorStep,
  RefactorConfig,
  REFACTOR_DEFAULTS,
  REFACTOR_OPERATIONS,
} from './refactor_types.js';
