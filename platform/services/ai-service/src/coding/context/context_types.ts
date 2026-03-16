/**
 * Context Types
 * 
 * Type definitions for the Project Context Builder.
 */

// Project types
export type ProjectType =
  | 'nodejs-backend'
  | 'nodejs-fullstack'
  | 'react-frontend'
  | 'nextjs-app'
  | 'python-backend'
  | 'python-script'
  | 'go-backend'
  | 'rust-backend'
  | 'monorepo'
  | 'unknown';

// Monorepo tools
export type MonorepoTool = 'pnpm' | 'turbo' | 'lerna' | 'nx' | 'rush';

// Relevance reasons
export type RelevanceReason =
  | 'open'        // Currently open in IDE (score 1.0)
  | 'changed'     // Recently modified (score 0.9)
  | 'import-by'   // Imported by open/changed files (score 0.7)
  | 'import-of'   // Files that import open/changed files (score 0.7)
  | 'keyword'     // Matches prompt keywords (score 0.6)
  | 'entrypoint'; // Project entrypoint (score 0.5)

// Context request
export interface ContextRequest {
  userPrompt: string;
  openFiles?: string[];
  changedFiles?: string[];
  maxTokens?: number;      // Default: 20000
  maxFiles?: number;       // Default: 12
}

// Framework information
export interface FrameworkInfo {
  name: string;
  version?: string;
  patterns: string[];      // e.g., ["app-router", "server-components"]
}

// Dependency
export interface Dependency {
  name: string;
  version: string;
  type: 'production' | 'development';
}

// File tree node
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

// Relevant file
export interface RelevantFile {
  path: string;
  content: string;
  originalSize: number;
  processedSize: number;
  relevance: number;       // 0-1 score
  reason: RelevanceReason;
}

// Monorepo information
export interface MonorepoInfo {
  isMonorepo: boolean;
  tool?: MonorepoTool;
  packages: string[];
  currentPackage?: string;
}

// Project context
export interface ProjectContext {
  projectType: ProjectType;
  framework?: FrameworkInfo;
  language: string;
  dependencies: Dependency[];
  fileTree: FileTreeNode[];
  relevantFiles: RelevantFile[];
  monorepo?: MonorepoInfo;
  summary: string;
  tokenCount: number;
  buildTimeMs: number;
}

// Import graph
export interface ImportGraph {
  // Files that this file imports
  getImports(file: string): string[];
  // Files that import this file
  getDependents(file: string): string[];
  // Get all files that are imported by any file
  getAllImported(): string[];
  // Check if file has been analyzed
  hasFile(file: string): boolean;
}

// Preprocess options
export interface PreprocessOptions {
  maxCommentLines?: number;        // Default: 10
  maxArrayItems?: number;          // Default: 50
  maxObjectKeys?: number;          // Default: 50
  collapseWhitespace?: boolean;    // Default: true
  removeExternalImports?: boolean; // Default: true
}

// Processed content
export interface ProcessedContent {
  content: string;
  originalTokens: number;
  processedTokens: number;
  reductionPercent: number;
}

// Context build error
export interface ContextBuildError {
  type: 'workspace_empty' | 'no_source_files' | 'token_overflow' | 'parse_error';
  message: string;
}

// Context build result
export interface ContextBuildResult {
  success: boolean;
  context?: ProjectContext;
  error?: ContextBuildError;
  warnings?: string[];
}

// Cache entry
export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttlMs: number;
}

// File tree limits
export const FILE_TREE_LIMITS = {
  maxDepth: 4,
  maxFiles: 500,
  maxNodes: 1000,
} as const;

// Context defaults
export const CONTEXT_DEFAULTS = {
  maxTokens: 20000,
  maxFiles: 12,
  maxGraphFiles: 2000,
  graphExpansionDepth: 2,
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
} as const;

// Preprocess defaults
export const PREPROCESS_DEFAULTS: Required<PreprocessOptions> = {
  maxCommentLines: 10,
  maxArrayItems: 50,
  maxObjectKeys: 50,
  collapseWhitespace: true,
  removeExternalImports: true,
} as const;

// Relevance scores
export const RELEVANCE_SCORES: Record<RelevanceReason, number> = {
  open: 1.0,
  changed: 0.9,
  'import-by': 0.7,
  'import-of': 0.7,
  keyword: 0.6,
  entrypoint: 0.5,
} as const;

// Source file extensions for import graph
export const SOURCE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py',
  '.go',
  '.rs',
] as const;

// Config file patterns
export const CONFIG_FILES = {
  // JavaScript/TypeScript
  packageJson: 'package.json',
  tsconfig: 'tsconfig.json',
  jsconfig: 'jsconfig.json',
  
  // Python
  requirements: 'requirements.txt',
  pyproject: 'pyproject.toml',
  setup: 'setup.py',
  
  // Go
  goMod: 'go.mod',
  
  // Rust
  cargoToml: 'Cargo.toml',
  
  // Monorepo
  pnpmWorkspace: 'pnpm-workspace.yaml',
  turbo: 'turbo.json',
  lerna: 'lerna.json',
  nx: 'nx.json',
  rush: 'rush.json',
} as const;

// Framework indicators
export const FRAMEWORK_INDICATORS: Record<string, { framework: string; patterns: string[] }> = {
  // Node.js frameworks
  'next.config.js': { framework: 'next.js', patterns: ['app-router', 'ssr'] },
  'next.config.mjs': { framework: 'next.js', patterns: ['app-router', 'ssr'] },
  'nuxt.config.js': { framework: 'nuxt', patterns: ['vue', 'ssr'] },
  'nuxt.config.ts': { framework: 'nuxt', patterns: ['vue', 'ssr'] },
  
  // Python frameworks
  'fastapi': { framework: 'fastapi', patterns: ['async', 'api'] },
  'django': { framework: 'django', patterns: ['orm', 'admin'] },
  'flask': { framework: 'flask', patterns: ['micro', 'api'] },
  
  // Go frameworks
  'fiber': { framework: 'fiber', patterns: ['fast', 'api'] },
  'gin': { framework: 'gin', patterns: ['http', 'api'] },
  'echo': { framework: 'echo', patterns: ['http', 'api'] },
  
  // Rust frameworks
  'actix-web': { framework: 'actix', patterns: ['async', 'http'] },
  'rocket': { framework: 'rocket', patterns: ['async', 'http'] },
  'axum': { framework: 'axum', patterns: ['async', 'http'] },
} as const;

// Entrypoint patterns by project type
export const ENTRYPOINT_PATTERNS: Record<string, string[]> = {
  'nodejs-backend': ['src/index.ts', 'src/main.ts', 'src/app.ts', 'index.ts', 'main.ts'],
  'nodejs-fullstack': ['src/index.ts', 'src/server.ts', 'server.ts'],
  'react-frontend': ['src/index.tsx', 'src/index.ts', 'src/main.tsx', 'src/App.tsx'],
  'nextjs-app': ['src/app/page.tsx', 'src/pages/index.tsx', 'app/page.tsx', 'pages/index.tsx'],
  'python-backend': ['main.py', 'app.py', 'src/__init__.py', 'src/main.py'],
  'python-script': ['main.py', '__main__.py'],
  'go-backend': ['main.go', 'cmd/main.go', 'cmd/server/main.go'],
  'rust-backend': ['src/main.rs', 'src/lib.rs'],
} as const;
