/**
 * Workspace File System
 * 
 * The only interface for agents to interact with project files.
 * Enforces safety constraints and provides audit logging.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  FileEntry,
  SearchResult,
  PatchResult,
  WorkspaceConfig,
  ReadFileOptions,
  WriteFileOptions,
  SearchOptions,
  WorkspaceStats,
  FileChangeListener,
  DEFAULT_WORKSPACE_CONFIG,
  WorkspaceSafetyError,
  FileNotFoundError,
} from './workspace_types.js';
import { DiffEngine, ApplyResult, PatchError } from '../patch/index.js';

/**
 * Workspace File System
 * 
 * Provides safe, audited access to project files for AI agents.
 */
export class WorkspaceFS {
  private config: WorkspaceConfig;
  private diffEngine: DiffEngine | null = null;
  private listeners: FileChangeListener[] = [];
  private fileCache: Map<string, { content: string; hash: string; timestamp: number }> = new Map();
  private cacheTtlMs = 60000; // 1 minute cache

  constructor(config: Partial<WorkspaceConfig> = {}) {
    this.config = { ...DEFAULT_WORKSPACE_CONFIG, ...config };
  }

  /**
   * Set diff engine for applyPatch operations
   */
  setDiffEngine(engine: DiffEngine): void {
    this.diffEngine = engine;
  }

  /**
   * Add file change listener
   */
  addChangeListener(listener: FileChangeListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove file change listener
   */
  removeChangeListener(listener: FileChangeListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Emit file change event to listeners
   */
  private async emitChange(event: Parameters<FileChangeListener>[0]): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  /**
   * Check if content is binary
   */
  private isBinary(content: string): boolean {
    // Check for null bytes or high ratio of non-printable characters
    const buffer = Buffer.from(content, 'utf-8');
    
    // Check first 8KB for binary signatures
    const checkLength = Math.min(buffer.length, 8192);
    for (let i = 0; i < checkLength; i++) {
      // Null byte is a strong indicator of binary
      if (buffer[i] === 0) {
        return true;
      }
    }
    
    // Check for high ratio of non-printable characters
    let nonPrintable = 0;
    for (let i = 0; i < checkLength; i++) {
      const byte = buffer[i];
      // Allow common control characters: tab (9), newline (10), carriage return (13)
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
        nonPrintable++;
      }
      // Also count DEL and above as potentially binary (except for extended UTF-8)
      if (byte === 127) {
        nonPrintable++;
      }
    }
    
    // If more than 30% non-printable, likely binary
    return nonPrintable / checkLength > 0.3;
  }

  /**
   * Invalidate cache for a specific file
   */
  invalidateCache(filePath: string): void {
    const resolvedPath = this.resolvePath(filePath);
    this.fileCache.delete(resolvedPath);
  }

  /**
   * Invalidate cache for all files in a directory
   */
  async invalidateCacheDirectory(dirPath: string): Promise<void> {
    const resolvedDir = this.resolvePath(dirPath);
    
    for (const cachedPath of this.fileCache.keys()) {
      if (cachedPath.startsWith(resolvedDir)) {
        this.fileCache.delete(cachedPath);
      }
    }
  }

  /**
   * Resolve and validate path
   */
  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.config.rootPath, filePath);
    
    // Ensure path is within workspace
    if (!resolved.startsWith(this.config.rootPath)) {
      throw new WorkspaceSafetyError(
        `Path traversal detected: ${filePath}`,
        'path_ignored'
      );
    }

    return resolved;
  }

  /**
   * Check if path is ignored
   */
  private isIgnored(filePath: string): boolean {
    const relativePath = path.relative(this.config.rootPath, filePath);
    return this.config.ignoredPaths.some(ignored => 
      relativePath.startsWith(ignored) || relativePath.includes(`/${ignored}/`)
    );
  }

  /**
   * Check if path is read-only
   */
  private isReadOnly(filePath: string): boolean {
    return this.config.readOnlyPaths.some(roPath => 
      filePath.startsWith(path.resolve(this.config.rootPath, roPath))
    );
  }

  /**
   * Check if extension is allowed
   */
  private isExtensionAllowed(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.config.allowedExtensions.includes(ext) || ext === '';
  }

  /**
   * Check file size
   */
  private async checkFileSize(filePath: string): Promise<number> {
    const stat = await fs.stat(filePath);
    if (stat.size > this.config.maxFileSizeBytes) {
      throw new WorkspaceSafetyError(
        `File too large: ${filePath} (${stat.size} bytes, max ${this.config.maxFileSizeBytes})`,
        'file_too_large'
      );
    }
    return stat.size;
  }

  /**
   * Read file content
   */
  async readFile(filePath: string, options: ReadFileOptions = {}): Promise<string> {
    const resolvedPath = this.resolvePath(filePath);

    // Check if ignored
    if (this.isIgnored(resolvedPath)) {
      throw new WorkspaceSafetyError(
        `Path is ignored: ${filePath}`,
        'path_ignored'
      );
    }

    // Check file exists
    try {
      await fs.access(resolvedPath);
    } catch {
      throw new FileNotFoundError(filePath);
    }

    // Check extension
    if (!this.isExtensionAllowed(resolvedPath)) {
      throw new WorkspaceSafetyError(
        `Extension not allowed: ${path.extname(filePath)}`,
        'extension_not_allowed'
      );
    }

    // Check file size
    await this.checkFileSize(resolvedPath);

    // Check cache
    const cached = this.fileCache.get(resolvedPath);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      let content = cached.content;
      
      // Handle line range
      if (options.startLine !== undefined || options.endLine !== undefined) {
        const lines = content.split('\n');
        const start = options.startLine ?? 0;
        const end = options.endLine ?? lines.length;
        content = lines.slice(start, end).join('\n');
      }
      
      return content;
    }

    // Read file
    const encoding = options.encoding ?? 'utf-8';
    let content = await fs.readFile(resolvedPath, encoding);

    // Check for binary content
    if (this.isBinary(content)) {
      throw new WorkspaceSafetyError(
        `Binary files not supported: ${filePath}`,
        'extension_not_allowed'
      );
    }

    // Update cache
    const hash = crypto.createHash('md5').update(content).digest('hex');
    this.fileCache.set(resolvedPath, {
      content,
      hash,
      timestamp: Date.now(),
    });

    // Handle line range
    if (options.startLine !== undefined || options.endLine !== undefined) {
      const lines = content.split('\n');
      const start = options.startLine ?? 0;
      const end = options.endLine ?? lines.length;
      content = lines.slice(start, end).join('\n');
    }

    return content;
  }

  /**
   * Read multiple files
   */
  async readFiles(filePaths: string[], options: ReadFileOptions = {}): Promise<Map<string, string>> {
    if (filePaths.length > this.config.maxFilesPerRead) {
      throw new WorkspaceSafetyError(
        `Too many files requested: ${filePaths.length} (max ${this.config.maxFilesPerRead})`,
        'too_many_files'
      );
    }

    const results = new Map<string, string>();
    
    await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const content = await this.readFile(filePath, options);
          results.set(filePath, content);
        } catch (error) {
          if (error instanceof FileNotFoundError) {
            // Skip missing files
            return;
          }
          throw error;
        }
      })
    );

    return results;
  }

  /**
   * Write file content
   */
  async writeFile(filePath: string, content: string, options: WriteFileOptions = {}): Promise<void> {
    const resolvedPath = this.resolvePath(filePath);

    // Check if ignored
    if (this.isIgnored(resolvedPath)) {
      throw new WorkspaceSafetyError(
        `Path is ignored: ${filePath}`,
        'path_ignored'
      );
    }

    // Check if read-only
    if (this.isReadOnly(resolvedPath)) {
      throw new WorkspaceSafetyError(
        `Path is read-only: ${filePath}`,
        'read_only'
      );
    }

    // Check extension
    if (!this.isExtensionAllowed(resolvedPath)) {
      throw new WorkspaceSafetyError(
        `Extension not allowed: ${path.extname(filePath)}`,
        'extension_not_allowed'
      );
    }

    // Check content size
    const contentSize = Buffer.byteLength(content, 'utf-8');
    if (contentSize > this.config.maxFileSizeBytes) {
      throw new WorkspaceSafetyError(
        `Content too large: ${contentSize} bytes (max ${this.config.maxFileSizeBytes})`,
        'file_too_large'
      );
    }

    // Create backup if requested
    if (options.backup) {
      try {
        const existingContent = await fs.readFile(resolvedPath, 'utf-8');
        const backupPath = `${resolvedPath}.backup-${Date.now()}`;
        await fs.writeFile(backupPath, existingContent);
      } catch {
        // File doesn't exist, no backup needed
      }
    }

    // Create directories if requested
    if (options.createDirectories) {
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });
    }

    // Check if file exists and overwrite is not allowed
    if (!options.overwrite) {
      try {
        await fs.access(resolvedPath);
        throw new WorkspaceSafetyError(
          `File exists and overwrite not allowed: ${filePath}`,
          'read_only'
        );
      } catch (err) {
        if (err instanceof WorkspaceSafetyError) {
          throw err;
        }
        // File doesn't exist, proceed
      }
    }

    // Write file
    await fs.writeFile(resolvedPath, content, 'utf-8');

    // Invalidate cache
    this.fileCache.delete(resolvedPath);

    // Emit change event
    await this.emitChange({
      type: 'modified',
      path: filePath,
      timestamp: new Date(),
      content,
    });
  }

  /**
   * Apply patch to files (atomic operation)
   */
  async applyPatch(patchContent: string): Promise<PatchResult> {
    if (!this.diffEngine) {
      throw new Error('Diff engine not configured');
    }

    // Use DiffEngine's repository-level apply
    const applyResult = await this.diffEngine.apply(this.config.rootPath, patchContent);

    // Convert to PatchResult format
    const result: PatchResult = {
      success: applyResult.success,
      filesChanged: applyResult.filesChanged.map(f => f.path),
      linesAdded: applyResult.totalLinesAdded,
      linesRemoved: applyResult.totalLinesRemoved,
      linesModified: 0,
      errors: applyResult.errors.map(e => ({
        file: e.file,
        line: e.lineIndex,
        message: e.message,
        type: e.type === 'conflict' ? 'conflict' : 
              e.type === 'apply_error' ? 'invalid_format' : 
              e.type === 'limit_exceeded' ? 'invalid_format' : 'invalid_format',
      })),
      warnings: applyResult.warnings,
    };

    // Invalidate cache for changed files
    for (const file of applyResult.filesChanged) {
      const resolvedPath = this.resolvePath(file.path);
      this.fileCache.delete(resolvedPath);
    }

    // Emit change events
    for (const file of applyResult.filesChanged) {
      if (file.success) {
        await this.emitChange({
          type: 'modified',
          path: file.path,
          timestamp: new Date(),
        });
      }
    }

    return result;
  }

  /**
   * Parse file paths from patch content
   */
  private parsePatchFiles(patchContent: string): string[] {
    const files: string[] = [];
    const lines = patchContent.split('\n');
    
    for (const line of lines) {
      // Match --- a/path or +++ b/path
      const match = line.match(/^[-+]{3}\s+[ab]\/(.+)$/);
      if (match) {
        const filePath = match[1];
        if (!files.includes(filePath)) {
          files.push(filePath);
        }
      }
    }

    return files;
  }

  /**
   * List files in directory
   */
  async listFiles(dirPath?: string): Promise<FileEntry[]> {
    const targetPath = dirPath 
      ? this.resolvePath(dirPath) 
      : this.config.rootPath;

    const entries: FileEntry[] = [];

    const scan = async (currentPath: string): Promise<void> => {
      const items = await fs.readdir(currentPath, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(currentPath, item.name);
        const relativePath = path.relative(this.config.rootPath, itemPath);

        // Skip ignored paths
        if (this.isIgnored(itemPath)) {
          continue;
        }

        if (item.isDirectory()) {
          entries.push({
            path: relativePath,
            type: 'directory',
            size: 0,
            extension: '',
            lastModified: new Date(),
          });
          
          // Recurse into directory
          await scan(itemPath);
        } else if (item.isFile()) {
          // Check extension
          if (!this.isExtensionAllowed(itemPath)) {
            continue;
          }

          try {
            const stat = await fs.stat(itemPath);
            entries.push({
              path: relativePath,
              type: 'file',
              size: stat.size,
              extension: path.extname(item.name).toLowerCase(),
              lastModified: stat.mtime,
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    };

    await scan(targetPath);
    return entries;
  }

  /**
   * Search for text in files
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const maxResults = options.maxResults ?? 100;
    const contextLines = options.contextLines ?? 2;

    // Get all files
    const files = await this.listFiles();
    const fileEntries = files.filter(f => f.type === 'file');

    // Filter by file pattern
    const pattern = options.filePattern 
      ? new RegExp(options.filePattern.replace(/\*/g, '.*'))
      : null;

    for (const file of fileEntries) {
      if (results.length >= maxResults) break;
      if (pattern && !pattern.test(file.path)) continue;

      try {
        const content = await this.readFile(file.path);
        const lines = content.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          if (results.length >= maxResults) break;

          const line = lines[lineNum];
          let matchFound = false;
          let matchText = '';

          if (options.regex) {
            const regex = new RegExp(query, options.caseSensitive ? 'g' : 'gi');
            const match = regex.exec(line);
            if (match) {
              matchFound = true;
              matchText = match[0];
            }
          } else {
            const searchLine = options.caseSensitive ? line : line.toLowerCase();
            const searchQuery = options.caseSensitive ? query : query.toLowerCase();
            
            if (options.wholeWord) {
              const wordRegex = new RegExp(`\\b${escapeRegex(searchQuery)}\\b`, options.caseSensitive ? '' : 'i');
              const match = wordRegex.exec(line);
              if (match) {
                matchFound = true;
                matchText = match[0];
              }
            } else if (searchLine.includes(searchQuery)) {
              matchFound = true;
              matchText = query;
            }
          }

          if (matchFound) {
            // Build context
            const contextStart = Math.max(0, lineNum - contextLines);
            const contextEnd = Math.min(lines.length - 1, lineNum + contextLines);
            const context = lines.slice(contextStart, contextEnd + 1).join('\n');

            // Find column
            const column = line.indexOf(matchText);

            results.push({
              path: file.path,
              line: lineNum + 1,
              column: column + 1,
              match: matchText,
              context,
              type: 'keyword',
            });
          }
        }
      } catch {
        // Skip files we can't read
      }
    }

    return results;
  }

  /**
   * Get workspace statistics
   */
  async getStats(): Promise<WorkspaceStats> {
    const files = await this.listFiles();
    const fileEntries = files.filter(f => f.type === 'file');
    const dirEntries = files.filter(f => f.type === 'directory');

    const byExtension: Record<string, number> = {};
    let totalSize = 0;

    for (const file of fileEntries) {
      totalSize += file.size;
      byExtension[file.extension] = (byExtension[file.extension] || 0) + 1;
    }

    // Get largest files
    const largestFiles = [...fileEntries]
      .sort((a, b) => b.size - a.size)
      .slice(0, 10)
      .map(f => ({ path: f.path, size: f.size }));

    return {
      totalFiles: fileEntries.length,
      totalDirectories: dirEntries.length,
      totalSizeBytes: totalSize,
      byExtension,
      largestFiles,
    };
  }

  /**
   * Check if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(filePath);
    try {
      await fs.access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete file
   */
  async deleteFile(filePath: string): Promise<void> {
    const resolvedPath = this.resolvePath(filePath);

    if (this.isIgnored(resolvedPath)) {
      throw new WorkspaceSafetyError(
        `Path is ignored: ${filePath}`,
        'path_ignored'
      );
    }

    if (this.isReadOnly(resolvedPath)) {
      throw new WorkspaceSafetyError(
        `Path is read-only: ${filePath}`,
        'read_only'
      );
    }

    await fs.unlink(resolvedPath);
    this.fileCache.delete(resolvedPath);

    await this.emitChange({
      type: 'deleted',
      path: filePath,
      timestamp: new Date(),
    });
  }

  /**
   * Create directory
   */
  async createDirectory(dirPath: string): Promise<void> {
    const resolvedPath = this.resolvePath(dirPath);

    if (this.isIgnored(resolvedPath)) {
      throw new WorkspaceSafetyError(
        `Path is ignored: ${dirPath}`,
        'path_ignored'
      );
    }

    await fs.mkdir(resolvedPath, { recursive: true });

    await this.emitChange({
      type: 'created',
      path: dirPath,
      timestamp: new Date(),
    });
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.fileCache.clear();
  }

  /**
   * Get configuration
   */
  getConfig(): WorkspaceConfig {
    return { ...this.config };
  }
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create workspace instance
 */
export function createWorkspace(rootPath: string, config?: Partial<WorkspaceConfig>): WorkspaceFS {
  return new WorkspaceFS({ ...config, rootPath });
}
