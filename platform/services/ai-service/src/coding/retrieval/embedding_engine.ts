/**
 * Embedding Engine
 * 
 * Generates embeddings for code chunks using various providers.
 * Supports OpenAI, Cohere, and local models with lazy embedding strategy.
 */

import {
  EmbeddingConfig,
  EMBEDDING_DEFAULTS,
  CodeChunk,
  EmbeddingError,
} from './retrieval_types.js';
import { buildEmbeddingText, shouldEmbed } from './embedding_builder.js';

// Default configs for different providers
const PROVIDER_CONFIGS: Record<string, EmbeddingConfig> = {
  openai: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimension: 1536,
    batchSize: 100,
    maxRetries: 3,
  },
  'openai-large': {
    provider: 'openai',
    model: 'text-embedding-3-large',
    dimension: 3072,
    batchSize: 50,
    maxRetries: 3,
  },
  cohere: {
    provider: 'cohere',
    model: 'embed-english-v3.0',
    dimension: 1024,
    batchSize: 96,
    maxRetries: 3,
  },
  local: {
    provider: 'local',
    model: 'all-MiniLM-L6-v2',
    dimension: 384,
    batchSize: 32,
    maxRetries: 1,
  },
};

/**
 * Embedding Engine
 */
export class EmbeddingEngine {
  private config: EmbeddingConfig;
  private apiKey?: string;

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = { ...EMBEDDING_DEFAULTS, ...config };
    
    // Get API key from environment
    if (this.config.provider === 'openai') {
      this.apiKey = process.env.OPENAI_API_KEY;
    } else if (this.config.provider === 'cohere') {
      this.apiKey = process.env.COHERE_API_KEY;
    }
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    return this.config.dimension;
  }

  /**
   * Get provider name
   */
  getProvider(): string {
    return this.config.provider;
  }

  /**
   * Check if engine is ready
   */
  isReady(): boolean {
    if (this.config.provider === 'local') {
      return true; // Local is always ready
    }
    return !!this.apiKey;
  }

  /**
   * Generate embedding for single text
   */
  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Filter empty texts
    const validTexts = texts.filter(t => t.trim().length > 0);
    if (validTexts.length === 0) {
      return texts.map(() => []);
    }

    // Process in batches
    const results: number[][] = [];
    const batchSize = this.config.batchSize;

    for (let i = 0; i < validTexts.length; i += batchSize) {
      const batch = validTexts.slice(i, i + batchSize);
      const batchResults = await this.embedBatchInternal(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Generate embeddings for chunks
   */
  async embedChunks(chunks: CodeChunk[]): Promise<Map<string, number[]>> {
    const result = new Map<string, number[]>();

    // Filter chunks that should be embedded
    const embeddableChunks = chunks.filter(c => shouldEmbed(c));
    
    if (embeddableChunks.length === 0) {
      return result;
    }

    // Build embedding texts
    const texts = embeddableChunks.map(c => buildEmbeddingText(c));

    // Generate embeddings
    const embeddings = await this.embedBatch(texts);

    // Map chunk IDs to embeddings
    for (let i = 0; i < embeddableChunks.length; i++) {
      if (embeddings[i] && embeddings[i].length > 0) {
        result.set(embeddableChunks[i].id, embeddings[i]);
      }
    }

    return result;
  }

  /**
   * Internal batch embedding
   */
  private async embedBatchInternal(texts: string[]): Promise<number[][]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        switch (this.config.provider) {
          case 'openai':
            return await this.embedWithOpenAI(texts);
          case 'cohere':
            return await this.embedWithCohere(texts);
          case 'local':
            return await this.embedWithLocal(texts);
          default:
            throw new Error(`Unknown provider: ${this.config.provider}`);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        // Wait before retry
        if (attempt < this.config.maxRetries - 1) {
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    throw new EmbeddingError(
      lastError?.message || 'Embedding failed',
      []
    );
  }

  /**
   * Embed with OpenAI
   */
  private async embedWithOpenAI(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map(item => item.embedding);
  }

  /**
   * Embed with Cohere
   */
  private async embedWithCohere(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error('Cohere API key not configured');
    }

    const response = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        texts: texts,
        input_type: 'search_document',
        truncate: 'END',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cohere API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      embeddings: number[][];
    };

    return data.embeddings;
  }

  /**
   * Embed with local model (placeholder)
   * In production, this would use a local embedding model
   */
  private async embedWithLocal(texts: string[]): Promise<number[][]> {
    // For now, return mock embeddings
    // In production, this would load a model like all-MiniLM-L6-v2
    // and run inference locally
    
    // Check if we can load the model
    try {
      // Try to use a simple hash-based embedding for demo purposes
      // This is NOT a real embedding, just a placeholder
      const embeddings: number[][] = [];
      
      for (const text of texts) {
        // Generate deterministic pseudo-embedding from text hash
        const embedding = this.generatePseudoEmbedding(text);
        embeddings.push(embedding);
      }
      
      return embeddings;
    } catch {
      throw new Error('Local embedding model not available');
    }
  }

  /**
   * Generate pseudo-embedding (for demo/fallback only)
   * This creates a deterministic vector from text hash
   */
  private generatePseudoEmbedding(text: string): number[] {
    const dimension = this.config.dimension;
    const embedding: number[] = [];
    
    // Use text hash to seed pseudo-random generator
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    // Generate deterministic pseudo-random values
    let seed = Math.abs(hash);
    for (let i = 0; i < dimension; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      embedding.push((seed / 0x7fffffff) * 2 - 1); // Normalize to [-1, 1]
    }
    
    // Normalize to unit length
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / norm);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let defaultEngine: EmbeddingEngine | null = null;

/**
 * Get default embedding engine
 */
export function getEmbeddingEngine(): EmbeddingEngine {
  if (!defaultEngine) {
    defaultEngine = new EmbeddingEngine();
  }
  return defaultEngine;
}

/**
 * Create embedding engine with config
 */
export function createEmbeddingEngine(config: Partial<EmbeddingConfig>): EmbeddingEngine {
  return new EmbeddingEngine(config);
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embedding dimensions must match');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Find most similar embeddings
 */
export function findMostSimilar(
  query: number[],
  embeddings: Array<{ id: string; embedding: number[] }>,
  topK: number = 10
): Array<{ id: string; score: number }> {
  const similarities = embeddings.map(({ id, embedding }) => ({
    id,
    score: cosineSimilarity(query, embedding),
  }));

  // Sort by score descending
  similarities.sort((a, b) => b.score - a.score);

  return similarities.slice(0, topK);
}

/**
 * Check if embeddings are available
 */
export function areEmbeddingsAvailable(): boolean {
  // Check for API keys or local model
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasCohere = !!process.env.COHERE_API_KEY;
  
  return hasOpenAI || hasCohere; // Local is always available as fallback
}
