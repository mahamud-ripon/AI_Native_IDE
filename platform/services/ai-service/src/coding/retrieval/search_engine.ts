/**
 * Search Engine
 * 
 * Provides hybrid search combining semantic (embedding-based) and
 * keyword (BM25-style) search for code retrieval.
 */

import {
  CodeChunk,
  SearchResult,
  SearchOptions,
  SearchMode,
  MatchType,
  Highlight,
  ChunkContext,
  SEARCH_DEFAULTS,
} from './retrieval_types.js';
import {
  cosineSimilarity,
  findMostSimilar,
} from './embedding_engine.js';
import { buildSearchQuery } from './embedding_builder.js';

/**
 * Search Engine
 */
export class SearchEngine {
  private chunks: Map<string, CodeChunk> = new Map();
  private embeddings: Map<string, number[]> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private documentFrequency: Map<string, number> = new Map();
  private totalDocuments: number = 0;

  /**
   * Index chunks for search
   */
  indexChunks(chunks: CodeChunk[]): void {
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
      this.totalDocuments++;

      // Build inverted index for keyword search
      const tokens = this.tokenize(chunk.content);
      const uniqueTokens = new Set(tokens);

      for (const token of uniqueTokens) {
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, new Set());
        }
        this.invertedIndex.get(token)!.add(chunk.id);

        // Update document frequency
        this.documentFrequency.set(
          token,
          (this.documentFrequency.get(token) || 0) + 1
        );
      }
    }
  }

  /**
   * Index embeddings
   */
  indexEmbeddings(embeddings: Map<string, number[]>): void {
    for (const [chunkId, embedding] of embeddings) {
      this.embeddings.set(chunkId, embedding);
    }
  }

  /**
   * Remove chunk from index
   */
  removeChunk(chunkId: string): void {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return;

    // Remove from chunks
    this.chunks.delete(chunkId);
    this.totalDocuments--;

    // Remove from embeddings
    this.embeddings.delete(chunkId);

    // Remove from inverted index
    const tokens = this.tokenize(chunk.content);
    for (const token of tokens) {
      const postings = this.invertedIndex.get(token);
      if (postings) {
        postings.delete(chunkId);
        if (postings.size === 0) {
          this.invertedIndex.delete(token);
          this.documentFrequency.delete(token);
        } else {
          this.documentFrequency.set(
            token,
            (this.documentFrequency.get(token) || 1) - 1
          );
        }
      }
    }
  }

  /**
   * Search for chunks
   */
  async search(
    query: string,
    queryEmbedding: number[] | null,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const opts = { ...SEARCH_DEFAULTS, ...options };
    const mode = opts.mode as SearchMode;

    let results: SearchResult[] = [];

    switch (mode) {
      case 'semantic':
        if (queryEmbedding) {
          results = await this.semanticSearch(queryEmbedding, opts);
        }
        break;

      case 'keyword':
        results = this.keywordSearch(query, opts);
        break;

      case 'hybrid':
        const [semantic, keyword] = await Promise.all([
          queryEmbedding
            ? this.semanticSearch(queryEmbedding, { ...opts, maxResults: opts.maxResults * 2 })
            : Promise.resolve([]),
          Promise.resolve(this.keywordSearch(query, { ...opts, maxResults: opts.maxResults * 2 })),
        ]);
        results = this.mergeResults(semantic, keyword, opts);
        break;

      case 'exact':
        results = this.exactSearch(query, opts);
        break;
    }

    // Apply filters
    results = this.applyFilters(results, opts);

    // Add context if requested
    if (opts.includeContext) {
      results = this.addContext(results, opts.contextChunks);
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, opts.maxResults);
  }

  /**
   * Semantic search using embeddings
   */
  private async semanticSearch(
    queryEmbedding: number[],
    options: Required<Omit<SearchOptions, 'fileTypes' | 'paths' | 'language'>>
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const [chunkId, embedding] of this.embeddings) {
      const chunk = this.chunks.get(chunkId);
      if (!chunk) continue;

      const score = cosineSimilarity(queryEmbedding, embedding);

      if (score >= options.minScore) {
        results.push({
          chunk,
          score,
          matchType: 'semantic',
          highlights: [],
        });
      }
    }

    return results;
  }

  /**
   * Keyword search using BM25-like scoring
   */
  private keywordSearch(
    query: string,
    options: Required<Omit<SearchOptions, 'fileTypes' | 'paths' | 'language'>>
  ): SearchResult[] {
    const queryTokens = this.tokenize(query);
    const scores = new Map<string, number>();

    // Calculate BM25 scores
    const k1 = 1.2; // BM25 parameter
    const b = 0.75; // BM25 parameter
    const avgDocLength = this.getAverageDocumentLength();

    for (const token of queryTokens) {
      const postings = this.invertedIndex.get(token);
      if (!postings) continue;

      const df = this.documentFrequency.get(token) || 1;
      const idf = Math.log(
        (this.totalDocuments - df + 0.5) / (df + 0.5) + 1
      );

      for (const chunkId of postings) {
        const chunk = this.chunks.get(chunkId);
        if (!chunk) continue;

        const tf = this.countOccurrences(chunk.content, token);
        const docLength = chunk.content.split(/\s+/).length;

        // BM25 formula
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
        const bm25Score = idf * (numerator / denominator);

        scores.set(chunkId, (scores.get(chunkId) || 0) + bm25Score);
      }
    }

    // Normalize scores and build results
    const maxScore = Math.max(...scores.values(), 1);
    const results: SearchResult[] = [];

    for (const [chunkId, rawScore] of scores) {
      const chunk = this.chunks.get(chunkId);
      if (!chunk) continue;

      const normalizedScore = rawScore / maxScore;

      if (normalizedScore >= options.minScore) {
        results.push({
          chunk,
          score: normalizedScore,
          matchType: 'keyword',
          highlights: this.findHighlights(chunk, queryTokens),
        });
      }
    }

    return results;
  }

  /**
   * Exact string match search
   */
  private exactSearch(
    query: string,
    options: Required<Omit<SearchOptions, 'fileTypes' | 'paths' | 'language'>>
  ): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const [chunkId, chunk] of this.chunks) {
      const lowerContent = chunk.content.toLowerCase();
      const index = lowerContent.indexOf(lowerQuery);

      if (index !== -1) {
        results.push({
          chunk,
          score: 1.0,
          matchType: 'exact',
          highlights: [{
            startLine: this.findLineForPosition(chunk.content, index),
            endLine: this.findLineForPosition(chunk.content, index + query.length),
            text: query,
            type: 'exact',
          }],
        });
      }
    }

    return results;
  }

  /**
   * Merge semantic and keyword results using Reciprocal Rank Fusion
   */
  private mergeResults(
    semantic: SearchResult[],
    keyword: SearchResult[],
    options: Required<Omit<SearchOptions, 'fileTypes' | 'paths' | 'language'>>
  ): SearchResult[] {
    const rrfScores = new Map<string, number>();
    const chunkMap = new Map<string, SearchResult>();

    // Semantic weight: 0.6, Keyword weight: 0.4
    const semanticWeight = 0.6;
    const keywordWeight = 0.4;

    // Process semantic results
    semantic.forEach((result, index) => {
      const rrf = semanticWeight / (index + 60); // RRF constant k=60
      rrfScores.set(result.chunk.id, (rrfScores.get(result.chunk.id) || 0) + rrf);
      chunkMap.set(result.chunk.id, result);
    });

    // Process keyword results
    keyword.forEach((result, index) => {
      const rrf = keywordWeight / (index + 60);
      rrfScores.set(result.chunk.id, (rrfScores.get(result.chunk.id) || 0) + rrf);
      
      // Merge highlights if already exists
      const existing = chunkMap.get(result.chunk.id);
      if (existing) {
        existing.highlights.push(...result.highlights);
        existing.matchType = 'semantic'; // Mark as hybrid
      } else {
        chunkMap.set(result.chunk.id, result);
      }
    });

    // Build merged results
    const results: SearchResult[] = [];
    for (const [chunkId, score] of rrfScores) {
      const result = chunkMap.get(chunkId);
      if (result && score >= options.minScore * 0.5) { // Lower threshold for merged
        results.push({
          ...result,
          score,
        });
      }
    }

    return results;
  }

  /**
   * Apply filters to results
   */
  private applyFilters(
    results: SearchResult[],
    options: SearchOptions
  ): SearchResult[] {
    let filtered = results;

    // Filter by file types
    if (options.fileTypes && options.fileTypes.length > 0) {
      const extensions = options.fileTypes.map(ext =>
        ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
      );
      filtered = filtered.filter(r =>
        extensions.some(ext => r.chunk.path.toLowerCase().endsWith(ext))
      );
    }

    // Filter by language
    if (options.language) {
      filtered = filtered.filter(r =>
        r.chunk.language === options.language
      );
    }

    // Filter by paths
    if (options.paths && options.paths.length > 0) {
      filtered = filtered.filter(r =>
        options.paths!.some(p => r.chunk.path.startsWith(p))
      );
    }

    return filtered;
  }

  /**
   * Add context chunks to results
   */
  private addContext(
    results: SearchResult[],
    contextChunks: number = 1
  ): SearchResult[] {
    return results.map(result => {
      const context: ChunkContext = {};

      // Find previous chunk
      const previous = this.findAdjacentChunk(result.chunk, -1);
      if (previous) {
        context.previous = previous;
      }

      // Find next chunk
      const next = this.findAdjacentChunk(result.chunk, 1);
      if (next) {
        context.next = next;
      }

      return {
        ...result,
        context,
      };
    });
  }

  /**
   * Find adjacent chunk in same file
   */
  private findAdjacentChunk(chunk: CodeChunk, direction: number): CodeChunk | undefined {
    const targetLine = direction < 0 ? chunk.startLine - 1 : chunk.endLine + 1;

    for (const [, c] of this.chunks) {
      if (c.path === chunk.path) {
        if (direction < 0 && c.endLine === chunk.startLine - 1) {
          return c;
        }
        if (direction > 0 && c.startLine === chunk.endLine + 1) {
          return c;
        }
      }
    }

    return undefined;
  }

  /**
   * Tokenize text for indexing/searching
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1);
  }

  /**
   * Count occurrences of token in text
   */
  private countOccurrences(text: string, token: string): number {
    const tokens = this.tokenize(text);
    return tokens.filter(t => t === token).length;
  }

  /**
   * Get average document length
   */
  private getAverageDocumentLength(): number {
    if (this.totalDocuments === 0) return 100;

    let totalLength = 0;
    for (const [, chunk] of this.chunks) {
      totalLength += chunk.content.split(/\s+/).length;
    }

    return totalLength / this.totalDocuments;
  }

  /**
   * Find highlights in chunk
   */
  private findHighlights(chunk: CodeChunk, tokens: string[]): Highlight[] {
    const highlights: Highlight[] = [];
    const lines = chunk.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      for (const token of tokens) {
        if (line.includes(token)) {
          highlights.push({
            startLine: chunk.startLine + i,
            endLine: chunk.startLine + i,
            text: token,
            type: 'semantic',
          });
        }
      }
    }

    return highlights.slice(0, 5); // Limit highlights
  }

  /**
   * Find line number for character position
   */
  private findLineForPosition(content: string, position: number): number {
    let line = 1;
    for (let i = 0; i < position && i < content.length; i++) {
      if (content[i] === '\n') {
        line++;
      }
    }
    return line;
  }

  /**
   * Clear all indexed data
   */
  clear(): void {
    this.chunks.clear();
    this.embeddings.clear();
    this.invertedIndex.clear();
    this.documentFrequency.clear();
    this.totalDocuments = 0;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalChunks: number;
    totalEmbeddings: number;
    vocabularySize: number;
  } {
    return {
      totalChunks: this.chunks.size,
      totalEmbeddings: this.embeddings.size,
      vocabularySize: this.invertedIndex.size,
    };
  }
}

// Singleton instance
let defaultEngine: SearchEngine | null = null;

/**
 * Get default search engine
 */
export function getSearchEngine(): SearchEngine {
  if (!defaultEngine) {
    defaultEngine = new SearchEngine();
  }
  return defaultEngine;
}

/**
 * Create search engine
 */
export function createSearchEngine(): SearchEngine {
  return new SearchEngine();
}
