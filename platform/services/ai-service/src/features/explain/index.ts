/**
 * Explain Feature Module
 * 
 * AI-powered code explanation and documentation.
 */

// Service
export {
  ExplainService,
  getExplainService,
  createExplainService,
  explainCode,
} from './explain_service.js';

// Types
export {
  ExplanationDepth,
  ExplanationFormat,
  ExplainRequest,
  ExplainTarget,
  ExplainOptions,
  ExplainResult,
  Explanation,
  ExplainSection,
  CodeReference,
  CodeFlowStep,
  DependencyInfo,
  ArchitectureInfo,
  SecurityInfo,
  PerformanceInfo,
  RelatedCode,
  ExplainMetrics,
  ExplainConfig,
  EXPLAIN_DEFAULTS,
  DEPTH_DESCRIPTIONS,
  AUDIENCE_PROMPTS,
} from './explain_types.js';
