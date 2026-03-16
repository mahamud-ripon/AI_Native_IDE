/**
 * Code Index
 * 
 * Main index management for code retrieval. Handles indexing workspace files,
 * storing chunks, managing embeddings, and integrating with WorkspaceFS events.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import {
  CodeChunk,
  IndexOptions,
  IndexStats,
  SearchOptions,
  SearchResult,
  RetrievalContext,
  INDEX_DIR,
  INDEX_FILES,
  INDEX_DEFAULTS,
  CHUNK_LIMITS,
  INDEXABLE_EXTENSIONS,
  RetrievalError,
} from './retrieval_types.js';
import { chunkFile, shouldIndexFile } from './chunker.js';
import { EmbeddingEngine, getEmbeddingEngine, areEmbeddingsAvailable } from './embedding_engine.js';
import { SearchEngine, getSearchEngine } from './search_engine.js';
import { buildRetrievalContext } from './embedding_builder.js';

/**
 * Code Index Manager
 */
export class CodeIndex {
  private workspace: WorkspaceFS | null = null;
  private embeddingEngine: EmbeddingEngine;
  private searchEngine: SearchEngine;
  private options: Required<IndexOptions>;
  private indexPath: string = '';
  private initialized: boolean = false;

  // In-memory chunk storage
  private chunks: Map<string, CodeChunk> = new Map();
  private fileHashes: Map<string, string> = new Map();
  private pendingEmbeddings: Set<string> = new Set();

  constructor(options: Partial<IndexOptions> = {}) {
    this.options = { ...INDEX_DEFAULTS, ...options } as Required<IndexOptions>;
    this.embeddingEngine = getEmbeddingEngine();
    this.searchEngine = getSearchEngine();
  }

  /**
   * Initialize index for workspace
   */
  async initialize(workspace: WorkspaceFS): Promise<void> {
    this.workspace = workspace;
    this.indexPath = path.join(workspace.getConfig().rootPath, INDEX_DIR);

    // Create index directory if needed
    await this.ensureIndexDir();

    // Load existing index if available
    await this.loadIndex();

    this.initialized = true;
  }

  /**
   * Index entire workspace
   */
  async indexWorkspace(options?: Partial<IndexOptions>): Promise<IndexStats> {
    if (!this.workspace) {
      throw new RetrievalError('Workspace not initialized', 'index_error');
    }

    const opts = { ...this.options, ...options } as Required<IndexOptions>;
    const startTime = Date.now();

    // Clear existing index if force reindex
    if (opts.forceReindex) {
      await this.clearIndex();
    }

    // List all files
    const files = await this.workspace.listFiles();
    const indexableFiles = files.filter(f =>
      f.type === 'file' && shouldIndexFile(f.path)
    );

    // Check total chunk limit
    const estimatedChunks = indexableFiles.length * 10; // Rough estimate
    if (estimatedChunks > opts.maxTotalChunks && !opts.forceReindex) {
      console.warn(`Estimated chunks (${estimatedChunks}) exceeds limit (${opts.maxTotalChunks})`);
    }

    // Process files in batches
    const batchSize = 10;
    let totalChunks = 0;

    for (let i = 0; i < indexableFiles.length; i += batchSize) {
      const batch = indexableFiles.slice(i, i + batchSize);

      for (const file of batch) {
        try {
          const content = await this.workspace.readFile(file.path);
          const hash = this.hashContent(content);

          // Skip if unchanged
          if (!opts.forceReindex && this.fileHashes.get(file.path) === hash) {
            continue;
          }

          // Chunk file
          const chunks = await chunkFile(file.path, content, {
            maxChunksPerFile: opts.maxChunksPerFile,
          });

          // Check chunk limit
          if (totalChunks + chunks.length > opts.maxTotalChunks) {
            console.warn(`Chunk limit reached: ${opts.maxTotalChunks}`);
            break;
          }

          // Store chunks
          for (const chunk of chunks) {
            this.chunks.set(chunk.id, chunk);
            this.pendingEmbeddings.add(chunk.id);
            totalChunks++;
          }

          // Update file hash
          this.fileHashes.set(file.path, hash);
        } catch (error) {
          console.warn(`Failed to index ${file.path}:`, error);
        }
      }

      // Break if limit reached
      if (totalChunks >= opts.maxTotalChunks) {
        break;
      }
    }

    // Index in search engine
    this.searchEngine.indexChunks(Array.from(this.chunks.values()));

    // Generate embeddings if not lazy
    if (!opts.lazyEmbeddings && areEmbeddingsAvailable()) {
      await this.generatePendingEmbeddings();
    }

    // Save index
    await this.saveIndex();

    return this.getStats();
  }

  /**
   * Index single file
   */
  async indexFile(filePath: string, content?: string): Promise<CodeChunk[]> {
    if (!this.workspace) {
      throw new RetrievalError('Workspace not initialized', 'index_error');
    }

    // Get content if not provided
    const fileContent = content ?? await this.workspace.readFile(filePath);
    const hash = this.hashContent(fileContent);

    // Check if unchanged
    if (this.fileHashes.get(filePath) === hash) {
      return this.getChunksByPath(filePath);
    }

    // Remove old chunks
    await this.removeFile(filePath);

    // Chunk file
    const chunks = await chunkFile(filePath, fileContent, {
      maxChunksPerFile: this.options.maxChunksPerFile,
    });

    // Store chunks
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
      this.pendingEmbeddings.add(chunk.id);
    }

    // Update file hash
    this.fileHashes.set(filePath, hash);

    // Index in search engine
    this.searchEngine.indexChunks(chunks);

    // Generate embeddings if available
    if (areEmbeddingsAvailable() && !this.options.lazyEmbeddings) {
      const embeddings = await this.embeddingEngine.embedChunks(chunks);
      this.searchEngine.indexEmbeddings(embeddings);

      // Update chunk embedding status
      for (const [chunkId] of embeddings) {
        const chunk = this.chunks.get(chunkId);
        if (chunk) {
          chunk.embeddingStatus = 'ready';
          this.pendingEmbeddings.delete(chunkId);
        }
      }
    }

    // Save index
    await this.saveIndex();

    return chunks;
  }

  /**
   * Remove file from index
   */
  async removeFile(filePath: string): Promise<void> {
    // Find and remove chunks
    const chunksToRemove: string[] = [];
    for (const [id, chunk] of this.chunks) {
      if (chunk.path === filePath) {
        chunksToRemove.push(id);
      }
    }

    for (const id of chunksToRemove) {
      this.chunks.delete(id);
      this.pendingEmbeddings.delete(id);
      this.searchEngine.removeChunk(id);
    }

    this.fileHashes.delete(filePath);
  }

  /**
   * Search for code
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    await this.ensureEmbeddingsForSearch();

    // Generate query embedding if semantic/hybrid search
    let queryEmbedding: number[] | null = null;
    if (options?.mode !== 'keyword' && options?.mode !== 'exact') {
      if (areEmbeddingsAvailable()) {
        queryEmbedding = await this.embeddingEngine.embed(query);
      }
    }

    return this.searchEngine.search(query, queryEmbedding, options);
  }

  /**
   * Get retrieval context for LLM
   */
  async getRetrievalContext(
    query: string,
    options?: SearchOptions
  ): Promise<RetrievalContext> {
    const startTime = Date.now();
    const results = await this.search(query, options);

    return {
      query,
      results: results.map((r, i) => ({
        index: i + 1,
        path: r.chunk.path,
        type: r.chunk.type,
        name: r.chunk.name,
        lines: `${r.chunk.startLine}-${r.chunk.endLine}`,
        score: r.score,
        content: r.chunk.content,
        signature: r.chunk.metadata.signature,
        docstring: r.chunk.metadata.docstring,
      })),
      totalFound: results.length,
      searchMode: options?.mode ?? 'hybrid',
      buildTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Get chunk by ID
   */
  getChunk(chunkId: string): CodeChunk | undefined {
    return this.chunks.get(chunkId);
  }

  /**
   * Get all chunks for a file
   */
  getChunksByPath(filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.path === filePath) {
        chunks.push(chunk);
      }
    }
    return chunks.sort((a, b) => a.startLine - b.startLine);
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    let pending = 0;
    let ready = 0;
    let stale = 0;

    for (const chunk of this.chunks.values()) {
      switch (chunk.embeddingStatus) {
        case 'pending':
          pending++;
          break;
        case 'ready':
          ready++;
          break;
        case 'stale':
          stale++;
          break;
      }
    }

    return {
      totalChunks: this.chunks.size,
      totalFiles: this.fileHashes.size,
      totalEmbeddings: ready,
      pendingEmbeddings: pending,
      readyEmbeddings: ready,
      staleEmbeddings: stale,
      indexSizeBytes: this.estimateIndexSize(),
      lastUpdated: new Date(),
    };
  }

  /**
   * Clear entire index
   */
  async clearIndex(): Promise<void> {
    this.chunks.clear();
    this.fileHashes.clear();
    this.pendingEmbeddings.clear();
    this.searchEngine.clear();

    // Clear index files
    if (this.indexPath) {
      try {
        await fs.rm(this.indexPath, { recursive: true });
      } catch {
        // Ignore if doesn't exist
      }
    }
  }

  /**
   * Generate pending embeddings
   */
  async generatePendingEmbeddings(): Promise<void> {
    if (this.pendingEmbeddings.size === 0) return;

    const chunksToEmbed: CodeChunk[] = [];
    for (const chunkId of this.pendingEmbeddings) {
      const chunk = this.chunks.get(chunkId);
      if (chunk) {
        chunksToEmbed.push(chunk);
      }
    }

    if (chunksToEmbed.length === 0) return;

    // Generate embeddings
    const embeddings = await this.embeddingEngine.embedChunks(chunksToEmbed);

    // Index embeddings
    this.searchEngine.indexEmbeddings(embeddings);

    // Update status
    for (const chunkId of embeddings.keys()) {
      const chunk = this.chunks.get(chunkId);
      if (chunk) {
        chunk.embeddingStatus = 'ready';
        this.pendingEmbeddings.delete(chunkId);
      }
    }
  }

  // Private methods

  /**
   * Ensure index directory exists
   */
  private async ensureIndexDir(): Promise<void> {
    if (!this.indexPath) return;

    try {
      await fs.mkdir(this.indexPath, { recursive: true });
    } catch {
      // Ignore
    }
  }

  /**
   * Load existing index from disk
   */
  private async loadIndex(): Promise<void> {
    if (!this.indexPath) return;

    const chunksFile = path.join(this.indexPath, INDEX_FILES.chunks);

    try {
      const data = await fs.readFile(chunksFile, 'utf-8');
      const parsed = JSON.parse(data);

      // Load chunks
      if (parsed.chunks) {
        for (const chunk of parsed.chunks) {
          // Restore dates
          chunk.createdAt = new Date(chunk.createdAt);
          chunk.updatedAt = new Date(chunk.updatedAt);
          this.chunks.set(chunk.id, chunk);

          if (chunk.embeddingStatus === 'pending') {
            this.pendingEmbeddings.add(chunk.id);
          }
        }
      }

      // Load file hashes
      if (parsed.fileHashes) {
        for (const [path, hash] of Object.entries(parsed.fileHashes)) {
          this.fileHashes.set(path, hash as string);
        }
      }

      // Index in search engine
      this.searchEngine.indexChunks(Array.from(this.chunks.values()));
    } catch {
      // No existing index, start fresh
    }
  }

  /**
   * Save index to disk
   */
  private async saveIndex(): Promise<void> {
    if (!this.indexPath) return;

    const chunksFile = path.join(this.indexPath, INDEX_FILES.chunks);

    const data = {
      version: 1,
      chunks: Array.from(this.chunks.values()),
      fileHashes: Object.fromEntries(this.fileHashes),
      savedAt: new Date().toISOString(),
    };

    await fs.writeFile(chunksFile, JSON.stringify(data, null, 2));
  }

  /**
   * Hash content for change detection
   */
  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Estimate index size in bytes
   */
  private estimateIndexSize(): number {
    let size = 0;
    for (const chunk of this.chunks.values()) {
      size += chunk.content.length;
      size += chunk.path.length * 2;
      size += 500; // Metadata overhead
    }
    return size;
  }

  /**
   * Ensure embeddings are available for search
   */
  private async ensureEmbeddingsForSearch(): Promise<void> {
    if (!areEmbeddingsAvailable()) return;
    if (this.pendingEmbeddings.size === 0) return;

    // Generate embeddings for pending chunks (up to 100)
    const toEmbed = Array.from(this.pendingEmbeddings).slice(0, 100);
    const chunks = toEmbed
      .map(id => this.chunks.get(id))
      .filter((c): c is CodeChunk => c !== undefined);

    if (chunks.length === 0) return;

    const embeddings = await this.embeddingEngine.embedChunks(chunks);
    this.searchEngine.indexEmbeddings(embeddings);

    for (const chunkId of embeddings.keys()) {
      const chunk = this.chunks.get(chunkId);
      if (chunk) {
        chunk.embeddingStatus = 'ready';
        this.pendingEmbeddings.delete(chunkId);
      }
    }
  }
}

// Singleton instance
let defaultIndex: CodeIndex | null = null;

/**
 * Get default code index
 */
export function getCodeIndex(): CodeIndex {
  if (!defaultIndex) {
    defaultIndex = new CodeIndex();
  }
  return defaultIndex;
}

/**
 * Create code index with options
 */
export function createCodeIndex(options?: Partial<IndexOptions>): CodeIndex {
  return new CodeIndex(options);
}

/**
 * Index workspace helper
 */
export async function indexWorkspace(
  workspace: WorkspaceFS,
  options?: Partial<IndexOptions>
): Promise<CodeIndex> {
  const index = getCodeIndex();
  await index.initialize(workspace);
  await index.indexWorkspace(options);
  return index;
}

/**
 * Search workspace helper
 */
export async function searchWorkspace(
  workspace: WorkspaceFS,
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const index = getCodeIndex();
  
  if (!index['initialized']) {
    await index.initialize(workspace);
  }

  return index.search(query, options);
}
