/**
 * Code Chunker
 * 
 * Chunks source code into semantic units using AST parsing (Tree-sitter)
 * with fallback to line-based chunking for unsupported languages.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import {
  CodeChunk,
  ChunkType,
  ChunkMetadata,
  CHUNK_LIMITS,
  INDEXABLE_EXTENSIONS,
  TREE_SITTER_NODES,
  RetrievalError,
} from './retrieval_types.js';

// Chunk options type (mutable version of CHUNK_LIMITS)
interface ChunkOptions {
  minChunkLines: number;
  maxChunkLines: number;
  targetChunkLines: number;
  overlapLines: number;
  maxChunksPerFile: number;
  maxTotalChunks: number;
}

// Language detection from extension
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
};

// Tree-sitter parser instances (lazy loaded)
let parserInstances: Map<string, unknown> | null = null;

/**
 * Check if Tree-sitter is available
 */
function isTreeSitterAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('tree-sitter');
    return !!mod;
  } catch {
    return false;
  }
}

/**
 * Get or create parser for language
 */
async function getParser(language: string): Promise<unknown | null> {
  if (!isTreeSitterAvailable()) {
    return null;
  }

  if (!parserInstances) {
    parserInstances = new Map();
  }

  if (parserInstances.has(language)) {
    return parserInstances.get(language);
  }

  try {
    // Dynamic require for tree-sitter (ESM compatibility)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Parser = require('tree-sitter');
    const parser = new Parser();

    // Load language grammar
    const languageMap: Record<string, string> = {
      typescript: 'tree-sitter-typescript',
      tsx: 'tree-sitter-tsx',
      javascript: 'tree-sitter-javascript',
      jsx: 'tree-sitter-jsx',
      python: 'tree-sitter-python',
      go: 'tree-sitter-go',
      rust: 'tree-sitter-rust',
    };

    const grammarPackage = languageMap[language];
    if (grammarPackage) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const grammar = require(grammarPackage);
      parser.setLanguage(grammar);
      parserInstances.set(language, parser);
      return parser;
    }
  } catch {
    // Tree-sitter not available for this language
  }

  return null;
}

/**
 * Chunk a file into semantic units
 */
export async function chunkFile(
  filePath: string,
  content: string,
  options: Partial<ChunkOptions> = {}
): Promise<CodeChunk[]> {
  const opts: ChunkOptions = { ...CHUNK_LIMITS, ...options } as ChunkOptions;
  const ext = path.extname(filePath).toLowerCase();
  const language = EXTENSION_TO_LANGUAGE[ext] || 'unknown';

  // Check if file type is indexable
  if (!INDEXABLE_EXTENSIONS.includes(ext as typeof INDEXABLE_EXTENSIONS[number])) {
    return [];
  }

  // Try AST-based chunking first
  const parser = await getParser(language);
  let chunks: CodeChunk[];

  if (parser) {
    chunks = await chunkWithAST(filePath, content, language, parser, opts);
  } else {
    // Fallback to line-based chunking
    chunks = chunkByLines(filePath, content, language, opts);
  }

  // Enforce max chunks per file
  if (chunks.length > opts.maxChunksPerFile) {
    // Merge smallest chunks
    chunks = mergeSmallChunks(chunks, opts.maxChunksPerFile);
  }

  return chunks;
}

/**
 * Chunk using Tree-sitter AST
 */
async function chunkWithAST(
  filePath: string,
  content: string,
  language: string,
  parser: unknown,
  options: ChunkOptions
): Promise<CodeChunk[]> {
  const chunks: CodeChunk[] = [];
  const lines = content.split('\n');

  try {
    // Parse the content
    const tree = (parser as { parse: (text: string) => { rootNode: TreeNode } }).parse(content);
    const rootNode = tree.rootNode;

    // Get node types to extract for this language
    const nodeTypes = TREE_SITTER_NODES[language] || TREE_SITTER_NODES.typescript;

    // Walk the tree and extract nodes
    const nodes = extractNodes(rootNode, nodeTypes, options);

    for (const node of nodes) {
      const chunk = createChunkFromNode(filePath, node, lines, language);
      if (chunk) {
        chunks.push(chunk);
      }
    }
  } catch (error) {
    // Fall back to line-based chunking on parse error
    return chunkByLines(filePath, content, language, options);
  }

  return chunks;
}

/**
 * Tree node interface
 */
interface TreeNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text: string;
  children: TreeNode[];
  childCount: number;
  parent?: TreeNode;
  childForFieldName?(name: string): TreeNode | null;
}

/**
 * Extract relevant nodes from AST
 */
function extractNodes(
  node: TreeNode,
  targetTypes: readonly string[],
  options: ChunkOptions
): TreeNode[] {
  const nodes: TreeNode[] = [];

  function walk(n: TreeNode): void {
    // Check if this node is a target type
    if (targetTypes.includes(n.type)) {
      const lineCount = n.endPosition.row - n.startPosition.row + 1;
      
      // Only include if within size limits
      if (lineCount >= options.minChunkLines && lineCount <= options.maxChunkLines) {
        nodes.push(n);
        return; // Don't traverse children of extracted nodes
      }
    }

    // Traverse children
    for (let i = 0; i < n.childCount; i++) {
      walk(n.children[i]);
    }
  }

  walk(node);
  return nodes;
}

/**
 * Create chunk from AST node
 */
function createChunkFromNode(
  filePath: string,
  node: TreeNode,
  lines: string[],
  language: string
): CodeChunk | null {
  const startLine = node.startPosition.row + 1; // 1-indexed
  const endLine = node.endPosition.row + 1;
  const content = lines.slice(startLine - 1, endLine).join('\n');

  if (!content.trim()) {
    return null;
  }

  const chunkType = mapNodeTypeToChunkType(node.type);
  const name = extractNodeName(node, chunkType);
  const metadata = extractMetadata(node, lines, language);

  return {
    id: generateChunkId(filePath, startLine, endLine),
    path: filePath,
    content,
    type: chunkType,
    name,
    startLine,
    endLine,
    language,
    embeddingStatus: 'pending',
    hash: hashContent(content),
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Map Tree-sitter node type to chunk type
 */
function mapNodeTypeToChunkType(nodeType: string): ChunkType {
  const mapping: Record<string, ChunkType> = {
    'function_declaration': 'function',
    'function_definition': 'function',
    'function_signature': 'function',
    'function_item': 'function',
    'function_expression': 'function',
    'arrow_function': 'function',
    'method_definition': 'method',
    'method_declaration': 'method',
    'class_declaration': 'class',
    'class_definition': 'class',
    'struct_item': 'class',
    'interface_declaration': 'interface',
    'interface_type': 'interface',
    'trait_item': 'interface',
    'type_alias_declaration': 'type',
    'type_declaration': 'type',
    'enum_declaration': 'enum',
    'enum_item': 'enum',
    'decorated_definition': 'function',
  };

  return mapping[nodeType] || 'block';
}

/**
 * Extract name from AST node
 */
function extractNodeName(node: TreeNode, chunkType: ChunkType): string {
  // Try to get name from identifier child
  for (const child of node.children) {
    if (child.type === 'identifier' || child.type === 'property_identifier') {
      return child.text;
    }
    if (child.type === 'type_identifier') {
      return child.text;
    }
  }

  // Try field name access
  const nameNode = node.childForFieldName?.('name');
  if (nameNode) {
    return nameNode.text;
  }

  // Fallback to generated name
  return `${chunkType}_${node.startPosition.row + 1}`;
}

/**
 * Extract metadata from AST node
 */
function extractMetadata(
  node: TreeNode,
  lines: string[],
  language: string
): ChunkMetadata {
  const metadata: ChunkMetadata = {
    exports: [],
    imports: [],
    dependencies: [],
  };

  // Extract docstring/comment
  const docstring = extractDocstring(node, lines);
  if (docstring) {
    metadata.docstring = docstring;
  }

  // Extract signature for functions
  if (node.type.includes('function')) {
    metadata.signature = extractSignature(node);
    const params = extractParameters(node, language);
    if (params.length > 0) {
      metadata.parameters = params;
    }
  }

  // Extract parent info
  const parent = findParentClass(node);
  if (parent) {
    metadata.parent = parent.name;
    metadata.parentType = parent.type;
  }

  return metadata;
}

/**
 * Extract docstring from node
 */
function extractDocstring(node: TreeNode, lines: string[]): string | undefined {
  // Check for preceding comment
  const lineIndex = node.startPosition.row - 1;
  if (lineIndex > 0) {
    const prevLine = lines[lineIndex - 1]?.trim();
    if (prevLine?.startsWith('//') || prevLine?.startsWith('#') || prevLine?.startsWith('/*')) {
      // Collect multi-line comment
      const commentLines: string[] = [];
      let i = lineIndex - 1;
      while (i >= 0) {
        const line = lines[i].trim();
        if (line.startsWith('//') || line.startsWith('#')) {
          commentLines.unshift(line.replace(/^[#\/]+\s?/, ''));
          i--;
        } else if (line.startsWith('/*') || line.endsWith('*/')) {
          // Handle block comments
          commentLines.unshift(line.replace(/^\/\*|\*\/$/g, '').trim());
          break;
        } else {
          break;
        }
      }
      return commentLines.join('\n');
    }
  }

  return undefined;
}

/**
 * Extract function signature
 */
function extractSignature(node: TreeNode): string {
  const firstLine = node.text.split('\n')[0];
  // Clean up signature
  return firstLine.replace(/\s+/g, ' ').trim();
}

/**
 * Extract parameters from function node
 */
function extractParameters(node: TreeNode, language: string): Array<{ name: string; type?: string }> {
  const params: Array<{ name: string; type?: string }> = [];

  // Find parameters node
  for (const child of node.children) {
    if (child.type === 'parameters' || child.type === 'parameter_list' || child.type === 'argument_list') {
      for (const param of child.children) {
        if (param.type === 'identifier' || param.type === 'parameter') {
          params.push({ name: param.text });
        } else if (param.type === 'typed_parameter' || param.type === 'required_parameter') {
          // TypeScript/Python typed parameter
          const nameChild = param.children.find(c => c.type === 'identifier');
          const typeChild = param.children.find(c => c.type === 'type_annotation');
          if (nameChild) {
            params.push({
              name: nameChild.text,
              type: typeChild?.text,
            });
          }
        }
      }
    }
  }

  return params;
}

/**
 * Find parent class for method
 */
function findParentClass(node: TreeNode): { name: string; type: ChunkType } | null {
  // Walk up to find class declaration
  let current: TreeNode | undefined = node.parent;
  while (current) {
    if (current.type === 'class_declaration' || current.type === 'class_definition') {
      const nameNode = current.children.find((c: TreeNode) => c.type === 'identifier' || c.type === 'type_identifier');
      if (nameNode) {
        return { name: nameNode.text, type: 'class' };
      }
    }
    current = current.parent;
  }
  return null;
}

/**
 * Chunk by lines (fallback when AST not available)
 */
function chunkByLines(
  filePath: string,
  content: string,
  language: string,
  options: ChunkOptions
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split('\n');
  const totalLines = lines.length;

  let currentStart = 0;

  while (currentStart < totalLines) {
    const currentEnd = Math.min(currentStart + options.targetChunkLines, totalLines);
    const chunkLines = lines.slice(currentStart, currentEnd);
    const chunkContent = chunkLines.join('\n');

    if (chunkContent.trim()) {
      chunks.push({
        id: generateChunkId(filePath, currentStart + 1, currentEnd),
        path: filePath,
        content: chunkContent,
        type: 'block',
        name: `block_${currentStart + 1}`,
        startLine: currentStart + 1,
        endLine: currentEnd,
        language,
        embeddingStatus: 'pending',
        hash: hashContent(chunkContent),
        metadata: {
          exports: [],
          imports: [],
          dependencies: [],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Move to next chunk with overlap
    currentStart = currentEnd - options.overlapLines;
    if (currentStart <= chunks[chunks.length - 1]?.startLine - 1) {
      currentStart = currentEnd; // No overlap if already covered
    }
  }

  return chunks;
}

/**
 * Merge smallest chunks to meet limit
 */
function mergeSmallChunks(chunks: CodeChunk[], maxChunks: number): CodeChunk[] {
  if (chunks.length <= maxChunks) {
    return chunks;
  }

  // Sort by size (smallest first)
  const sorted = [...chunks].sort((a, b) => a.content.length - b.content.length);
  
  // Keep largest chunks
  const toKeep = sorted.slice(-maxChunks);
  
  // Sort back by line number
  return toKeep.sort((a, b) => a.startLine - b.startLine);
}

/**
 * Generate unique chunk ID
 */
function generateChunkId(filePath: string, startLine: number, endLine: number): string {
  const hash = crypto.createHash('md5');
  hash.update(`${filePath}:${startLine}-${endLine}`);
  return hash.digest('hex').slice(0, 12);
}

/**
 * Hash content for change detection
 */
function hashContent(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Chunk multiple files in parallel
 */
export async function chunkFiles(
  files: Array<{ path: string; content: string }>,
  options?: Partial<ChunkOptions>
): Promise<CodeChunk[]> {
  const allChunks: CodeChunk[] = [];

  // Process in batches of 10
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(file => chunkFile(file.path, file.content, options))
    );
    for (const chunks of results) {
      allChunks.push(...chunks);
    }
  }

  return allChunks;
}

/**
 * Get language from file extension
 */
export function getLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || 'unknown';
}

/**
 * Check if file should be indexed
 */
export function shouldIndexFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return INDEXABLE_EXTENSIONS.includes(ext as typeof INDEXABLE_EXTENSIONS[number]);
}
