/**
 * Explain Types
 * 
 * Type definitions for AI-powered code explanation.
 */

// Explanation depth
export type ExplanationDepth = 'brief' | 'detailed' | 'comprehensive';

// Explanation format
export type ExplanationFormat = 'text' | 'markdown' | 'structured';

// Explain request
export interface ExplainRequest {
  id: string;
  workspaceId: string;
  userId: string;
  target: ExplainTarget;
  options?: ExplainOptions;
  timestamp: Date;
}

// Explain target
export interface ExplainTarget {
  type: 'file' | 'function' | 'class' | 'selection' | 'error';
  path?: string;
  content?: string;
  selection?: {
    startLine: number;
    endLine: number;
    content: string;
  };
  functionName?: string;
  className?: string;
  error?: {
    message: string;
    stack?: string;
  };
  language: string;
}

// Explain options
export interface ExplainOptions {
  depth?: ExplanationDepth;
  format?: ExplanationFormat;
  includeExamples?: boolean;
  includeDependencies?: boolean;
  includeArchitecture?: boolean;
  includeSecurity?: boolean;
  includePerformance?: boolean;
  targetAudience?: 'developer' | 'junior' | 'architect' | 'non-technical';
}

// Explain result
export interface ExplainResult {
  id: string;
  requestId: string;
  success: boolean;
  explanation: Explanation;
  relatedCode?: RelatedCode[];
  suggestions?: string[];
  error?: string;
  metrics: ExplainMetrics;
}

// Explanation
export interface Explanation {
  summary: string;
  overview: string;
  sections: ExplainSection[];
  codeFlow?: CodeFlowStep[];
  dependencies?: DependencyInfo[];
  architecture?: ArchitectureInfo;
  security?: SecurityInfo;
  performance?: PerformanceInfo;
}

// Explain section
export interface ExplainSection {
  title: string;
  content: string;
  codeReferences?: CodeReference[];
}

// Code reference
export interface CodeReference {
  path: string;
  line: number;
  content: string;
  description: string;
}

// Code flow step
export interface CodeFlowStep {
  step: number;
  description: string;
  code: string;
  line: number;
  nextStep?: string;
}

// Dependency info
export interface DependencyInfo {
  name: string;
  type: 'import' | 'function' | 'class' | 'variable';
  path: string;
  description: string;
}

// Architecture info
export interface ArchitectureInfo {
  pattern: string;
  layers: string[];
  responsibilities: string[];
  relationships: string[];
}

// Security info
export interface SecurityInfo {
  risks: SecurityRisk[];
  recommendations: string[];
}

// Security risk
export interface SecurityRisk {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  description: string;
  line?: number;
}

// Performance info
export interface PerformanceInfo {
  complexity: string;
  bottlenecks: string[];
  optimizations: string[];
}

// Related code
export interface RelatedCode {
  path: string;
  relation: 'dependency' | 'dependent' | 'similar' | 'test';
  relevance: number;
  content: string;
}

// Explain metrics
export interface ExplainMetrics {
  tokensUsed: number;
  latencyMs: number;
  contextTokens: number;
  relatedFilesFound: number;
}

// Explain service config
export interface ExplainConfig {
  defaultDepth: ExplanationDepth;
  defaultFormat: ExplanationFormat;
  includeDependenciesByDefault: boolean;
  includeArchitectureByDefault: boolean;
  maxRelatedFiles: number;
  contextMaxTokens: number;
}

// Default configuration
export const EXPLAIN_DEFAULTS: Required<ExplainConfig> = {
  defaultDepth: 'detailed',
  defaultFormat: 'markdown',
  includeDependenciesByDefault: true,
  includeArchitectureByDefault: true,
  maxRelatedFiles: 5,
  contextMaxTokens: 10000,
} as const;

// Depth descriptions
export const DEPTH_DESCRIPTIONS: Record<ExplanationDepth, string> = {
  brief: 'Provide a concise summary in 2-3 sentences',
  detailed: 'Explain with moderate detail including key concepts',
  comprehensive: 'Thorough explanation with all aspects covered',
} as const;

// Audience prompts
export const AUDIENCE_PROMPTS: Record<NonNullable<ExplainOptions['targetAudience']>, string> = {
  developer: 'Explain for an experienced developer familiar with the language and patterns.',
  junior: 'Explain in simple terms, avoiding jargon. Include basic concepts and learning resources.',
  architect: 'Focus on architecture, design patterns, and system-level implications.',
  'non-technical': 'Use plain language, avoid technical jargon, use analogies where helpful.',
} as const;
