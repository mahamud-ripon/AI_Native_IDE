/**
 * Workspace Types
 * 
 * Type definitions for the Workspace File System.
 * This is the only interface for agents to interact with project files.
 */

// File entry metadata
export interface FileEntry {
  path: string;
  type: 'file' | 'directory';
  size: number;
  extension: string;
  lastModified: Date;
  isReadOnly?: boolean;
}

// Search result
export interface SearchResult {
  path: string;
  line: number;
  column: number;
  match: string;
  context: string; // surrounding lines
  type: 'keyword' | 'symbol' | 'import' | 'export';
}

// Patch result
export interface PatchResult {
  success: boolean;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
  errors?: PatchError[];
  warnings?: string[];
}

// Patch error
export interface PatchError {
  file: string;
  line?: number;
  message: string;
  type: 'conflict' | 'invalid_format' | 'file_not_found' | 'permission_denied' | 'path_ignored';
}

// Workspace configuration
export interface WorkspaceConfig {
  rootPath: string;
  maxFileSizeBytes: number;
  maxFilesPerRead: number;
  maxFilesPerWrite: number;
  allowedExtensions: string[];
  ignoredPaths: string[];
  readOnlyPaths: string[];
}

// File read options
export interface ReadFileOptions {
  encoding?: BufferEncoding;
  startLine?: number;
  endLine?: number;
}

// Write file options
export interface WriteFileOptions {
  createDirectories?: boolean;
  overwrite?: boolean;
  backup?: boolean;
}

// Search options
export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  filePattern?: string;
  maxResults?: number;
  includeContext?: boolean;
  contextLines?: number;
}

// Workspace statistics
export interface WorkspaceStats {
  totalFiles: number;
  totalDirectories: number;
  totalSizeBytes: number;
  byExtension: Record<string, number>;
  largestFiles: Array<{ path: string; size: number }>;
}

// File change event
export interface FileChangeEvent {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  oldPath?: string;
  timestamp: Date;
  content?: string;
}

// File change listener
export type FileChangeListener = (event: FileChangeEvent) => void | Promise<void>;

// Default configuration
export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  rootPath: '',
  maxFileSizeBytes: 2 * 1024 * 1024, // 2MB
  maxFilesPerRead: 20,
  maxFilesPerWrite: 10,
  allowedExtensions: [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.json', '.jsonc',
    '.md', '.mdx',
    '.yaml', '.yml',
    '.css', '.scss', '.less',
    '.html', '.htm',
    '.py', '.pyw',
    '.go', '.mod', '.sum',
    '.rs', '.toml',
    '.java', '.kt', '.kts',
    '.c', '.cpp', '.h', '.hpp',
    '.sh', '.bash', '.zsh',
    '.env', '.env.local', '.env.example',
    '.gitignore', '.dockerignore', '.editorconfig',
    '.txt', '.log',
  ],
  ignoredPaths: [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
    '.cache',
    '__pycache__',
    '.venv',
    'venv',
    'target',
    'vendor',
    '.ai-ide',
  ],
  readOnlyPaths: [],
};

// Safety violation error
export class WorkspaceSafetyError extends Error {
  constructor(
    message: string,
    public readonly violation: 'file_too_large' | 'too_many_files' | 'extension_not_allowed' | 'path_ignored' | 'read_only' | 'path_traversal',
    public readonly data?: any
  ) {
    super(message);
    this.name = 'WorkspaceSafetyError';
  }
}

// File not found error
export class FileNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`File not found: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

// Patch application error
export class PatchApplicationError extends Error {
  constructor(
    message: string,
    public readonly errors: PatchError[]
  ) {
    super(message);
    this.name = 'PatchApplicationError';
  }
}
