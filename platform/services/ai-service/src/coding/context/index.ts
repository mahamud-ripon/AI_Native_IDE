/**
 * Context Module
 * 
 * Provides intelligent context building for AI coding operations.
 */

// Builder
export {
  ProjectContextBuilder,
  getContextBuilder,
  createContextBuilder,
} from './project_context_builder.js';

// Framework detection
export {
  detectFramework,
  detectProjectType,
  detectLanguage,
  detectMonorepo,
  clearFrameworkCache,
} from './framework_detector.js';

// Dependency detection
export {
  detectDependencies,
  getProductionDependencies,
  getDevDependencies,
  hasDependency,
  getDependencyVersion,
  clearDependencyCache,
} from './dependency_detector.js';

// Import graph
export {
  buildImportGraph,
  expandViaImports,
  getRelatedFiles,
} from './import_graph.js';
export type { ImportGraph } from './context_types.js';

// Content preprocessing
export {
  preprocessContent,
  estimateTokens,
  truncateToTokenLimit,
  getContentStats,
} from './content_preprocessor.js';

// Types
export {
  ProjectType,
  MonorepoTool,
  RelevanceReason,
  ContextRequest,
  FrameworkInfo,
  Dependency,
  FileTreeNode,
  RelevantFile,
  MonorepoInfo,
  ProjectContext,
  PreprocessOptions,
  ProcessedContent,
  ContextBuildError,
  ContextBuildResult,
  FILE_TREE_LIMITS,
  CONTEXT_DEFAULTS,
  PREPROCESS_DEFAULTS,
  RELEVANCE_SCORES,
  SOURCE_EXTENSIONS,
  CONFIG_FILES,
} from './context_types.js';
