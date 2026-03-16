/**
 * Embedding Builder
 * 
 * Builds structured text for embedding from code chunks.
 * Enriches chunk content with metadata for better semantic search.
 */

import {
  CodeChunk,
  ChunkType,
} from './retrieval_types.js';

// Chunk type display names
const CHUNK_TYPE_DISPLAY: Record<ChunkType, string> = {
  function: 'Function',
  method: 'Method',
  class: 'Class',
  interface: 'Interface',
  type: 'Type',
  enum: 'Enum',
  constant: 'Constant',
  import: 'Import',
  export: 'Export',
  block: 'Code Block',
};

/**
 * Build text for embedding from chunk
 * 
 * Creates structured text that includes:
 * - Symbol type and name
 * - File path
 * - Documentation
 * - Signature
 * - Code content
 */
export function buildEmbeddingText(chunk: CodeChunk): string {
  const parts: string[] = [];

  // Type and name
  const typeDisplay = CHUNK_TYPE_DISPLAY[chunk.type] || 'Code';
  parts.push(`${typeDisplay}: ${chunk.name}`);

  // File path (relative)
  parts.push(`File: ${chunk.path}`);

  // Parent context (for methods)
  if (chunk.metadata.parent) {
    parts.push(`In: ${chunk.metadata.parent}`);
  }

  // Docstring
  if (chunk.metadata.docstring) {
    parts.push(`Description: ${chunk.metadata.docstring}`);
  }

  // Signature for functions/methods
  if (chunk.metadata.signature) {
    parts.push(`Signature: ${chunk.metadata.signature}`);
  }

  // Parameters
  if (chunk.metadata.parameters && chunk.metadata.parameters.length > 0) {
    const params = chunk.metadata.parameters
      .map(p => p.type ? `${p.name}: ${p.type}` : p.name)
      .join(', ');
    parts.push(`Parameters: ${params}`);
  }

  // Return type
  if (chunk.metadata.returnType) {
    parts.push(`Returns: ${chunk.metadata.returnType}`);
  }

  // Exports
  if (chunk.metadata.exports.length > 0) {
    parts.push(`Exports: ${chunk.metadata.exports.join(', ')}`);
  }

  // Dependencies
  if (chunk.metadata.dependencies.length > 0) {
    const deps = chunk.metadata.dependencies.slice(0, 10).join(', ');
    parts.push(`Uses: ${deps}`);
  }

  // Separator
  parts.push('---');

  // Code content
  parts.push('Code:');
  parts.push(chunk.content);

  return parts.join('\n');
}

/**
 * Build search query text
 * 
 * Converts user query to structured search text
 */
export function buildSearchQuery(query: string): string {
  // Clean and normalize query
  const cleaned = query
    .replace(/[^\w\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Detect query intent
  const intent = detectQueryIntent(cleaned);

  // Build structured query
  const parts: string[] = [];

  if (intent.type) {
    parts.push(`Type: ${intent.type}`);
  }

  if (intent.name) {
    parts.push(`Name: ${intent.name}`);
  }

  if (intent.action) {
    parts.push(`Action: ${intent.action}`);
  }

  parts.push(cleaned);

  return parts.join('\n');
}

/**
 * Detect intent from query
 */
function detectQueryIntent(query: string): {
  type?: string;
  name?: string;
  action?: string;
} {
  const result: { type?: string; name?: string; action?: string } = {};
  const lower = query.toLowerCase();

  // Detect type keywords
  const typeKeywords: Record<string, string> = {
    'function': 'function',
    'func': 'function',
    'method': 'method',
    'class': 'class',
    'interface': 'interface',
    'type': 'type',
    'enum': 'enum',
    'const': 'constant',
    'constant': 'constant',
  };

  for (const [keyword, type] of Object.entries(typeKeywords)) {
    if (lower.includes(keyword)) {
      result.type = type;
      break;
    }
  }

  // Detect action keywords
  const actionKeywords = [
    'find', 'search', 'locate', 'where', 'show', 'get', 'fetch',
    'create', 'add', 'update', 'modify', 'delete', 'remove',
    'implement', 'fix', 'refactor', 'optimize',
  ];

  for (const action of actionKeywords) {
    if (lower.includes(action)) {
      result.action = action;
      break;
    }
  }

  // Try to extract name (capitalized words or quoted strings)
  const nameMatch = query.match(/['"]([^'"]+)['"]/);
  if (nameMatch) {
    result.name = nameMatch[1];
  } else {
    // Look for camelCase or PascalCase words
    const camelMatch = query.match(/\b([A-Z][a-z]+[A-Z]\w*|[a-z]+[A-Z]\w*)\b/);
    if (camelMatch) {
      result.name = camelMatch[1];
    }
  }

  return result;
}

/**
 * Build retrieval context for LLM
 * 
 * Formats search results for inclusion in LLM prompt
 */
export function buildRetrievalContext(
  results: Array<{ chunk: CodeChunk; score: number }>
): string {
  if (results.length === 0) {
    return 'No relevant code found.';
  }

  const lines: string[] = ['Relevant Code Snippets:', ''];

  for (let i = 0; i < results.length; i++) {
    const { chunk, score } = results[i];
    const typeDisplay = CHUNK_TYPE_DISPLAY[chunk.type] || 'Code';

    lines.push(`[${i + 1}] ${chunk.path}`);
    lines.push(`${typeDisplay}: ${chunk.name}`);
    lines.push(`Lines: ${chunk.startLine}-${chunk.endLine}`);
    lines.push(`Score: ${score.toFixed(2)}`);

    if (chunk.metadata.signature) {
      lines.push(`Signature: ${chunk.metadata.signature}`);
    }

    if (chunk.metadata.docstring) {
      lines.push(`Description: ${truncate(chunk.metadata.docstring, 100)}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build chunk summary for display
 */
export function buildChunkSummary(chunk: CodeChunk): string {
  const parts: string[] = [];

  const typeDisplay = CHUNK_TYPE_DISPLAY[chunk.type] || 'Code';
  parts.push(`${typeDisplay} ${chunk.name}`);

  if (chunk.metadata.parent) {
    parts.push(`in ${chunk.metadata.parent}`);
  }

  parts.push(`(${chunk.path}:${chunk.startLine})`);

  return parts.join(' ');
}

/**
 * Build code snippet with context
 */
export function buildSnippetWithContext(
  chunk: CodeChunk,
  previousChunk?: CodeChunk,
  nextChunk?: CodeChunk
): string {
  const lines: string[] = [];

  if (previousChunk) {
    lines.push('// ... previous code ...');
    lines.push('');
  }

  lines.push(`// ${buildChunkSummary(chunk)}`);
  lines.push(chunk.content);

  if (nextChunk) {
    lines.push('');
    lines.push('// ... continues ...');
  }

  return lines.join('\n');
}

/**
 * Truncate text to max length
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Build embedding batch from chunks
 */
export function buildEmbeddingBatch(chunks: CodeChunk[]): string[] {
  return chunks.map(chunk => buildEmbeddingText(chunk));
}

/**
 * Estimate embedding tokens
 */
export function estimateEmbeddingTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Check if chunk is worth embedding
 */
export function shouldEmbed(chunk: CodeChunk): boolean {
  // Skip very small chunks
  if (chunk.content.trim().length < 50) {
    return false;
  }

  // Skip import-only chunks
  if (chunk.type === 'import') {
    return false;
  }

  // Skip generated code
  if (isGeneratedCode(chunk.content)) {
    return false;
  }

  return true;
}

/**
 * Check if content appears to be generated
 */
function isGeneratedCode(content: string): boolean {
  const markers = [
    '@Generated',
    'AUTO-GENERATED',
    'DO NOT EDIT',
    'auto-generated',
    'This file is generated',
  ];

  const firstLines = content.split('\n').slice(0, 10).join('\n');
  return markers.some(marker => firstLines.includes(marker));
}
