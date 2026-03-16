/**
 * Content Preprocessor
 * 
 * Optimizes file content for LLM context by reducing token usage
 * while preserving code structure and semantics.
 */

import {
  PreprocessOptions,
  ProcessedContent,
  PREPROCESS_DEFAULTS,
} from './context_types.js';

/**
 * Preprocess file content for LLM context
 */
export function preprocessContent(
  content: string,
  options: Partial<PreprocessOptions> = {}
): ProcessedContent {
  const opts: Required<PreprocessOptions> = {
    ...PREPROCESS_DEFAULTS,
    ...options,
  };

  const originalTokens = estimateTokens(content);
  let processed = content;

  // 1. Remove large block comments
  if (opts.maxCommentLines) {
    processed = removeLargeComments(processed, opts.maxCommentLines);
  }

  // 2. Collapse whitespace
  if (opts.collapseWhitespace) {
    processed = collapseWhitespace(processed);
  }

  // 3. Truncate large arrays
  if (opts.maxArrayItems) {
    processed = truncateLargeArrays(processed, opts.maxArrayItems);
  }

  // 4. Truncate large objects
  if (opts.maxObjectKeys) {
    processed = truncateLargeObjects(processed, opts.maxObjectKeys);
  }

  // 5. Remove external imports from output (keep structure)
  if (opts.removeExternalImports) {
    processed = simplifyExternalImports(processed);
  }

  const processedTokens = estimateTokens(processed);
  const reductionPercent = originalTokens > 0
    ? ((originalTokens - processedTokens) / originalTokens) * 100
    : 0;

  return {
    content: processed,
    originalTokens,
    processedTokens,
    reductionPercent,
  };
}

/**
 * Estimate token count from content
 * Approximation: 1 token ≈ 4 characters for code
 */
export function estimateTokens(content: string): number {
  // More accurate for code: account for symbols, keywords
  const lines = content.split('\n');
  let tokens = 0;

  for (const line of lines) {
    // Count significant characters
    const trimmed = line.trim();
    if (!trimmed) {
      tokens += 1; // Empty line
      continue;
    }

    // Approximate: split by whitespace and symbols
    const parts = trimmed.split(/[\s{}()\[\];,.<>:'"=!+\-*/&|]+/).filter(p => p.length > 0);
    tokens += parts.length;
    tokens += Math.floor((trimmed.length - parts.join('').length) / 2); // Symbols
  }

  return tokens;
}

/**
 * Remove large block comments
 */
function removeLargeComments(content: string, maxLines: number): string {
  // Remove multi-line comments that exceed maxLines
  // Preserve small comments for context

  const lines = content.split('\n');
  const result: string[] = [];
  let inBlockComment = false;
  let commentStartLine = 0;
  let commentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for block comment start
    if (!inBlockComment && trimmed.startsWith('/*')) {
      inBlockComment = true;
      commentStartLine = i;
      commentLines = [line];

      // Check if it ends on same line
      if (trimmed.includes('*/')) {
        inBlockComment = false;
        // Single-line block comment - keep it
        result.push(line);
        continue;
      }
      continue;
    }

    // Inside block comment
    if (inBlockComment) {
      commentLines.push(line);

      if (trimmed.includes('*/')) {
        inBlockComment = false;

        // Keep if small enough
        if (commentLines.length <= maxLines) {
          result.push(...commentLines);
        } else {
          // Replace with placeholder
          result.push(`/* ... ${commentLines.length - 2} lines of comments removed ... */`);
        }
        commentLines = [];
      }
      continue;
    }

    // Single-line comments - keep if not too long
    if (trimmed.startsWith('//')) {
      // Keep doc-style comments
      if (trimmed.startsWith('///') || trimmed.startsWith('//!')) {
        result.push(line);
      } else if (trimmed.length < 80) {
        // Keep short comments
        result.push(line);
      }
      // Skip long single-line comments
      continue;
    }

    // Python-style comments
    if (trimmed.startsWith('#')) {
      if (trimmed.startsWith('##') || trimmed.length < 60) {
        result.push(line);
      }
      continue;
    }

    // Regular code line
    result.push(line);
  }

  return result.join('\n');
}

/**
 * Collapse excessive whitespace
 */
function collapseWhitespace(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let prevEmpty = false;

  for (const line of lines) {
    const isEmpty = line.trim().length === 0;

    // Collapse multiple empty lines to single
    if (isEmpty && prevEmpty) {
      continue;
    }

    result.push(line);
    prevEmpty = isEmpty;
  }

  // Remove trailing whitespace
  return result.map(line => line.trimEnd()).join('\n');
}

/**
 * Truncate large arrays
 */
function truncateLargeArrays(content: string, maxItems: number): string {
  // Pattern to find large arrays
  // This is a simplified approach - real implementation would need AST parsing

  const lines = content.split('\n');
  const result: string[] = [];
  let inArray = false;
  let arrayDepth = 0;
  let arrayStartLine = 0;
  let arrayItems = 0;
  let arrayLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect array start
    if (!inArray && trimmed.endsWith('[') && !trimmed.includes(']')) {
      inArray = true;
      arrayDepth = 1;
      arrayStartLine = i;
      arrayItems = 0;
      arrayLines = [line];
      continue;
    }

    if (inArray) {
      arrayLines.push(line);

      // Count brackets
      for (const char of line) {
        if (char === '[') arrayDepth++;
        if (char === ']') arrayDepth--;
      }

      // Count items (simplified - count commas at depth 1)
      if (arrayDepth === 1 && line.includes(',')) {
        arrayItems++;
      }

      // Check if array ended
      if (arrayDepth === 0) {
        inArray = false;

        // Keep if small enough
        if (arrayItems <= maxItems) {
          result.push(...arrayLines);
        } else {
          // Truncate
          const firstLines = arrayLines.slice(0, maxItems + 1);
          const lastLine = arrayLines[arrayLines.length - 1];
          result.push(...firstLines);
          result.push(`  // ... ${arrayItems - maxItems} more items truncated`);
          result.push(lastLine);
        }
        arrayLines = [];
        continue;
      }

      // Safety: break if array is too long
      if (arrayLines.length > 100) {
        inArray = false;
        result.push(...arrayLines.slice(0, maxItems + 2));
        result.push(`  // ... array truncated`);
        result.push('],');
        arrayLines = [];
      }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Truncate large objects
 */
function truncateLargeObjects(content: string, maxKeys: number): string {
  // Similar to array truncation but for objects

  const lines = content.split('\n');
  const result: string[] = [];
  let inObject = false;
  let objectDepth = 0;
  let objectKeys = 0;
  let objectLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect object start (not in array or function call context)
    if (!inObject && trimmed.endsWith('{') && !trimmed.includes('}')) {
      // Skip function bodies and blocks
      if (trimmed.includes('function') || trimmed.includes('=>') || trimmed.includes('if') || trimmed.includes('for') || trimmed.includes('while')) {
        result.push(line);
        continue;
      }

      inObject = true;
      objectDepth = 1;
      objectKeys = 0;
      objectLines = [line];
      continue;
    }

    if (inObject) {
      objectLines.push(line);

      // Count braces
      for (const char of line) {
        if (char === '{') objectDepth++;
        if (char === '}') objectDepth--;
      }

      // Count keys (simplified)
      if (objectDepth === 1 && (line.includes(':') || line.includes(','))) {
        objectKeys++;
      }

      // Check if object ended
      if (objectDepth === 0) {
        inObject = false;

        // Keep if small enough
        if (objectKeys <= maxKeys) {
          result.push(...objectLines);
        } else {
          // Truncate
          const firstLines = objectLines.slice(0, maxKeys + 1);
          const lastLine = objectLines[objectLines.length - 1];
          result.push(...firstLines);
          result.push(`  // ... ${objectKeys - maxKeys} more keys truncated`);
          result.push(lastLine);
        }
        objectLines = [];
        continue;
      }

      // Safety: break if object is too long
      if (objectLines.length > 100) {
        inObject = false;
        result.push(...objectLines.slice(0, maxKeys + 2));
        result.push(`  // ... object truncated`);
        result.push('},');
        objectLines = [];
      }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Simplify external imports
 * Keep import statements but mark them as external
 */
function simplifyExternalImports(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let importBlock: string[] = [];
  let inImportBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect import statements
    const isImport = trimmed.startsWith('import ') || 
                     trimmed.startsWith('export ') ||
                     trimmed.startsWith('require(');

    if (isImport) {
      if (!inImportBlock) {
        inImportBlock = true;
        importBlock = [];
      }
      importBlock.push(line);
      continue;
    }

    // End of import block
    if (inImportBlock && !isImport) {
      inImportBlock = false;

      // Keep only internal imports (relative)
      const internalImports = importBlock.filter(imp => {
        const match = imp.match(/from\s+['"]([^'"]+)['"]/) ||
                      imp.match(/require\(['"]([^'"]+)['"]\)/);
        if (match) {
          const importPath = match[1];
          return importPath.startsWith('.') || importPath.startsWith('/');
        }
        return true; // Keep if can't determine
      });

      // Add simplified external import marker
      const externalCount = importBlock.length - internalImports.length;
      if (externalCount > 0 && internalImports.length > 0) {
        result.push('// ... external imports');
      }

      result.push(...internalImports);
      importBlock = [];
    }

    result.push(line);
  }

  // Handle trailing imports
  if (importBlock.length > 0) {
    const internalImports = importBlock.filter(imp => {
      const match = imp.match(/from\s+['"]([^'"]+)['"]/) ||
                    imp.match(/require\(['"]([^'"]+)['"]\)/);
      if (match) {
        const importPath = match[1];
        return importPath.startsWith('.') || importPath.startsWith('/');
      }
      return true;
    });
    result.push(...internalImports);
  }

  return result.join('\n');
}

/**
 * Truncate content to specific token limit
 */
export function truncateToTokenLimit(content: string, maxTokens: number): string {
  const currentTokens = estimateTokens(content);

  if (currentTokens <= maxTokens) {
    return content;
  }

  // Truncate by lines, preserving structure
  const lines = content.split('\n');
  const result: string[] = [];
  let tokens = 0;

  // Keep imports and exports first
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ') || trimmed.startsWith('export ') || trimmed.startsWith('from ')) {
      const lineTokens = estimateTokens(line);
      if (tokens + lineTokens <= maxTokens * 0.2) { // 20% for imports
        result.push(line);
        tokens += lineTokens;
      }
    }
  }

  // Add code until limit
  for (const line of lines) {
    if (result.includes(line)) continue; // Skip already added

    const lineTokens = estimateTokens(line);
    if (tokens + lineTokens <= maxTokens) {
      result.push(line);
      tokens += lineTokens;
    } else {
      // Add truncation marker
      result.push('');
      result.push('// ... content truncated to fit token budget');
      break;
    }
  }

  return result.join('\n');
}

/**
 * Get content statistics
 */
export function getContentStats(content: string): {
  lines: number;
  characters: number;
  tokens: number;
  emptyLines: number;
  commentLines: number;
  codeLines: number;
} {
  const lines = content.split('\n');
  let emptyLines = 0;
  let commentLines = 0;
  let codeLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      emptyLines++;
    } else if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      commentLines++;
    } else {
      codeLines++;
    }
  }

  return {
    lines: lines.length,
    characters: content.length,
    tokens: estimateTokens(content),
    emptyLines,
    commentLines,
    codeLines,
  };
}
