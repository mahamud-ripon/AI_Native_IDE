/**
 * Retrieval Module
 * 
 * Provides code indexing, semantic search, and retrieval capabilities
 * for AI coding operations.
 */

// Index management
export {
  CodeIndex,
  getCodeIndex,
  createCodeIndex,
  indexWorkspace,
  searchWorkspace,
} from './code_index.js';

// Chunker
export {
  chunkFile,
  chunkFiles,
  getLanguageFromPath,
  shouldIndexFile,
} from './chunker.js';

// Embedding engine
export {
  EmbeddingEngine,
  getEmbeddingEngine,
  createEmbeddingEngine,
  cosineSimilarity,
  findMostSimilar,
  areEmbeddingsAvailable,
} from './embedding_engine.js';

// Search engine
export {
  SearchEngine,
  getSearchEngine,
  createSearchEngine,
} from './search_engine.js';

// Embedding builder
export {
  buildEmbeddingText,
  buildSearchQuery,
  buildRetrievalContext,
  buildChunkSummary,
  buildSnippetWithContext,
  buildEmbeddingBatch,
  estimateEmbeddingTokens,
  shouldEmbed,
} from './embedding_builder.js';

// Types
export {
  ChunkType,
  EmbeddingStatus,
  SearchMode,
  MatchType,
  CodeChunk,
  ChunkMetadata,
  Parameter,
  SearchResult,
  Highlight,
  ChunkContext,
  SearchOptions,
  IndexOptions,
  EmbeddingConfig,
  EmbeddingIndexEntry,
  IndexStats,
  RetrievalContext,
  RetrievalResultEntry,
  CHUNK_LIMITS,
  EMBEDDING_DEFAULTS,
  SEARCH_DEFAULTS,
  INDEX_DEFAULTS,
  INDEXABLE_EXTENSIONS,
  IGNORED_EXTENSIONS,
  INDEX_DIR,
  INDEX_FILES,
  TREE_SITTER_NODES,
  RetrievalError,
  ChunkNotFoundError,
  EmbeddingError,
} from './retrieval_types.js';
