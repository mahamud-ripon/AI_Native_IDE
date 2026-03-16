/**
 * Retrieval Types
 * 
 * Type definitions for the Code Retrieval / Index system.
 */

// Chunk types
export type ChunkType =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'import'
  | 'export'
  | 'block';

// Embedding status
export type EmbeddingStatus = 'pending' | 'ready' | 'stale' | 'failed';

// Search mode
export type SearchMode = 'semantic' | 'keyword' | 'hybrid' | 'exact';

// Match type
export type MatchType = 'semantic' | 'keyword' | 'exact';

// Code chunk
export interface CodeChunk {
  id: string;
  path: string;
  content: string;
  type: ChunkType;
  name: string;
  startLine: number;
  endLine: number;
  language: string;
  embedding?: number[];
  embeddingStatus: EmbeddingStatus;
  hash: string;
  metadata: ChunkMetadata;
  createdAt: Date;
  updatedAt: Date;
}

// Chunk metadata
export interface ChunkMetadata {
  parent?: string;           // Parent symbol (class for method)
  parentType?: ChunkType;    // Parent's type
  exports: string[];         // Exported symbols
  imports: string[];         // Imported symbols
  dependencies: string[];    // Referenced symbols
  docstring?: string;        // Documentation/comment
  signature?: string;        // Function/method signature
  returnType?: string;       // Return type
  parameters?: Parameter[];  // Function parameters
}

// Parameter
export interface Parameter {
  name: string;
  type?: string;
  optional?: boolean;
  defaultValue?: string;
}

// Search result
export interface SearchResult {
  chunk: CodeChunk;
  score: number;             // Relevance score 0-1
  matchType: MatchType;
  highlights: Highlight[];
  context?: ChunkContext;    // Neighbor chunks if requested
}

// Highlight
export interface Highlight {
  startLine: number;
  endLine: number;
  text: string;
  type: 'exact' | 'semantic';
}

// Chunk context (neighbor chunks)
export interface ChunkContext {
  previous?: CodeChunk;
  next?: CodeChunk;
}

// Search options
export interface SearchOptions {
  mode?: SearchMode;         // Default: hybrid
  maxResults?: number;       // Default: 10
  minScore?: number;         // Default: 0.5
  fileTypes?: string[];      // Filter by extension
  includeContext?: boolean;  // Include surrounding chunks
  contextChunks?: number;    // Number of neighbor chunks (default 1)
  language?: string;         // Filter by language
  paths?: string[];          // Filter by file paths
}

// Index options
export interface IndexOptions {
  forceReindex?: boolean;    // Force full reindex
  lazyEmbeddings?: boolean;  // Defer embedding generation (default true)
  maxChunksPerFile?: number; // Max chunks per file (default 50)
  maxTotalChunks?: number;   // Max total chunks (default 20000)
  fileTypes?: string[];      // File types to index
  excludePatterns?: string[];// Paths to exclude
}

// Embedding config
export interface EmbeddingConfig {
  provider: 'openai' | 'local' | 'cohere';
  model: string;
  dimension: number;
  batchSize: number;
  maxRetries: number;
}

// Embedding status for index
export interface EmbeddingIndexEntry {
  chunkId: string;
  embedding: number[];
  status: EmbeddingStatus;
  generatedAt?: Date;
  error?: string;
}

// Index statistics
export interface IndexStats {
  totalChunks: number;
  totalFiles: number;
  totalEmbeddings: number;
  pendingEmbeddings: number;
  readyEmbeddings: number;
  staleEmbeddings: number;
  indexSizeBytes: number;
  lastUpdated: Date;
  oldestChunk?: Date;
  newestChunk?: Date;
}

// Retrieval context for LLM
export interface RetrievalContext {
  query: string;
  results: RetrievalResultEntry[];
  totalFound: number;
  searchMode: SearchMode;
  buildTimeMs: number;
}

// Retrieval result entry (formatted for LLM)
export interface RetrievalResultEntry {
  index: number;
  path: string;
  type: ChunkType;
  name: string;
  lines: string;
  score: number;
  content: string;
  signature?: string;
  docstring?: string;
}

// Chunk limits
export const CHUNK_LIMITS = {
  minChunkLines: 5,
  maxChunkLines: 100,
  targetChunkLines: 40,
  overlapLines: 5,
  maxChunksPerFile: 50,
  maxTotalChunks: 20000,
} as const;

// Embedding defaults
export const EMBEDDING_DEFAULTS: EmbeddingConfig = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  dimension: 1536,
  batchSize: 100,
  maxRetries: 3,
} as const;

// Search defaults
export const SEARCH_DEFAULTS: Required<Omit<SearchOptions, 'fileTypes' | 'paths' | 'language'>> = {
  mode: 'hybrid',
  maxResults: 10,
  minScore: 0.5,
  includeContext: false,
  contextChunks: 1,
} as const;

// Index defaults
export const INDEX_DEFAULTS: Required<Omit<IndexOptions, 'fileTypes' | 'excludePatterns'>> = {
  forceReindex: false,
  lazyEmbeddings: true,
  maxChunksPerFile: CHUNK_LIMITS.maxChunksPerFile,
  maxTotalChunks: CHUNK_LIMITS.maxTotalChunks,
} as const;

// File types to index
export const INDEXABLE_EXTENSIONS = [
  // TypeScript/JavaScript
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  // Python
  '.py',
  // Go
  '.go',
  // Rust
  '.rs',
  // Java
  '.java',
  // C/C++
  '.c', '.cpp', '.cc', '.h', '.hpp',
  // Other
  '.rb', '.php', '.swift', '.kt', '.scala',
] as const;

// File types to ignore
export const IGNORED_EXTENSIONS = [
  // Data files
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env',
  // Lock files
  '.lock', '-lock.json',
  // Logs
  '.log',
  // Assets
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
  // Documents
  '.md', '.txt', '.rst',
  // Config
  '.config', '.conf',
  // Binary
  '.bin', '.exe', '.dll', '.so', '.dylib',
] as const;

// Index directory name
export const INDEX_DIR = '.ai-ide/index';

// Index file names
export const INDEX_FILES = {
  chunks: 'chunks.db',
  embeddings: 'embeddings.db',
  fts: 'fts.db',
  contentDir: 'chunks',
} as const;

// Tree-sitter node types for chunking (these are AST node type names, not ChunkTypes)
export const TREE_SITTER_NODES: Record<string, string[]> = {
  typescript: [
    'function_declaration',
    'function_signature',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'method_definition',
    'arrow_function',
    'function_expression',
  ],
  javascript: [
    'function_declaration',
    'class_declaration',
    'method_definition',
    'arrow_function',
    'function_expression',
  ],
  python: [
    'function_definition',
    'class_definition',
    'decorated_definition',
  ],
  go: [
    'function_declaration',
    'method_declaration',
    'type_declaration',
    'interface_type',
  ],
  rust: [
    'function_item',
    'struct_item',
    'enum_item',
    'trait_item',
    'impl_item',
  ],
} as const;

// Retrieval error
export class RetrievalError extends Error {
  constructor(
    message: string,
    public readonly type: 'index_error' | 'search_error' | 'embedding_error' | 'parse_error'
  ) {
    super(message);
    this.name = 'RetrievalError';
  }
}

// Chunk not found error
export class ChunkNotFoundError extends Error {
  constructor(public readonly chunkId: string) {
    super(`Chunk not found: ${chunkId}`);
    this.name = 'ChunkNotFoundError';
  }
}

// Embedding error
export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly chunkIds: string[]
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}
