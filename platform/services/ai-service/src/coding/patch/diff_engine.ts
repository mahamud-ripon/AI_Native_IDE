/**
 * Diff Engine
 * 
 * Core engine for validating and applying unified diffs.
 * Supports multi-file patches with atomic application.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parsePatch } from './diff_parser.js';
import {
  ParsedPatch,
  FilePatch,
  Hunk,
  PatchLine,
  ValidationResult,
  ApplyResult,
  FileApplyResult,
  Conflict,
  PatchError,
  PatchLimits,
  DEFAULT_PATCH_LIMITS,
  PatchSafetyError,
  PatchApplyError,
} from './diff_types.js';

/**
 * Diff Engine
 * 
 * Handles validation and application of unified diffs.
 */
export class DiffEngine {
  private limits: PatchLimits;

  constructor(limits: Partial<PatchLimits> = {}) {
    this.limits = { ...DEFAULT_PATCH_LIMITS, ...limits };
  }

  /**
   * Parse patch content
   */
  parse(patchContent: string): ParsedPatch {
    return parsePatch(patchContent, this.limits);
  }

  /**
   * Validate patch can be applied to workspace
   */
  async validate(workspaceRoot: string, patchContent: string): Promise<ValidationResult> {
    const errors: PatchError[] = [];
    const conflicts: Conflict[] = [];
    const warnings: string[] = [];
    let linesAdded = 0;
    let linesRemoved = 0;

    try {
      const parsed = this.parse(patchContent);

      for (const file of parsed.files) {
        const filePath = file.newPath || file.oldPath;
        if (!filePath) continue;

        const resolvedPath = path.resolve(workspaceRoot, filePath);

        // Check file exists for modify/delete operations
        const fileExists = await this.fileExists(resolvedPath);

        if (file.operation === 'modify' && !fileExists) {
          conflicts.push({
            file: filePath,
            hunkIndex: 0,
            type: 'file_not_found',
            message: `File not found: ${filePath}`,
          });
          continue;
        }

        if (file.operation === 'create' && fileExists) {
          warnings.push(`File already exists, will be overwritten: ${filePath}`);
        }

        // Validate hunks for modify operations
        if (file.operation === 'modify' && fileExists) {
          const content = await fs.readFile(resolvedPath, 'utf-8');
          const fileConflicts = this.validateFile(content, file);
          conflicts.push(...fileConflicts);
        }

        linesAdded += this.countAddedLines(file);
        linesRemoved += this.countRemovedLines(file);
      }

      return {
        valid: conflicts.length === 0,
        conflicts,
        warnings,
        stats: {
          filesAffected: parsed.files.length,
          linesAdded,
          linesRemoved,
        },
      };
    } catch (error) {
      if (error instanceof PatchSafetyError) {
        return {
          valid: false,
          conflicts: [],
          warnings: [],
          stats: { filesAffected: 0, linesAdded: 0, linesRemoved: 0 },
        };
      }
      throw error;
    }
  }

  /**
   * Apply patch to workspace (atomic operation)
   */
  async apply(workspaceRoot: string, patchContent: string): Promise<ApplyResult> {
    const parsed = this.parse(patchContent);
    const results: FileApplyResult[] = [];
    const errors: PatchError[] = [];
    const warnings: string[] = [];
    const stagedWrites: Map<string, string> = new Map();
    const stagedDeletes: Set<string> = new Set();

    // Phase 1: Validate and stage all changes
    for (const file of parsed.files) {
      const filePath = file.newPath || file.oldPath;
      if (!filePath) continue;

      try {
        const result = await this.stageFileChange(
          workspaceRoot,
          file,
          stagedWrites,
          stagedDeletes
        );
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          file: filePath,
          message,
          type: 'apply_error',
        });
        results.push({
          path: filePath,
          operation: file.operation,
          linesAdded: 0,
          linesRemoved: 0,
          success: false,
          error: message,
        });
      }
    }

    // Phase 2: If any errors, abort
    if (errors.length > 0) {
      return {
        success: false,
        filesChanged: results,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        errors,
        warnings,
      };
    }

    // Phase 3: Apply all changes atomically
    try {
      // Delete files first
      for (const deletePath of stagedDeletes) {
        await fs.unlink(deletePath);
      }

      // Write/overwrite files
      for (const [writePath, content] of stagedWrites) {
        const dir = path.dirname(writePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(writePath, content, 'utf-8');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply changes';
      return {
        success: false,
        filesChanged: results,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        errors: [{ file: '', message, type: 'file_error' }],
        warnings,
      };
    }

    // Calculate totals
    const totalLinesAdded = results.reduce((sum, r) => sum + r.linesAdded, 0);
    const totalLinesRemoved = results.reduce((sum, r) => sum + r.linesRemoved, 0);

    return {
      success: true,
      filesChanged: results,
      totalLinesAdded,
      totalLinesRemoved,
      errors: [],
      warnings,
    };
  }

  /**
   * Stage file change for atomic application
   */
  private async stageFileChange(
    workspaceRoot: string,
    file: FilePatch,
    stagedWrites: Map<string, string>,
    stagedDeletes: Set<string>
  ): Promise<FileApplyResult> {
    const filePath = file.newPath || file.oldPath;
    if (!filePath) {
      throw new Error('No file path in patch');
    }

    const resolvedPath = path.resolve(workspaceRoot, filePath);
    const fileExists = await this.fileExists(resolvedPath);

    switch (file.operation) {
      case 'create': {
        const content = this.buildNewFileContent(file);
        stagedWrites.set(resolvedPath, content);
        return {
          path: filePath,
          operation: 'create',
          linesAdded: this.countAddedLines(file),
          linesRemoved: 0,
          success: true,
        };
      }

      case 'delete': {
        stagedDeletes.add(resolvedPath);
        return {
          path: filePath,
          operation: 'delete',
          linesAdded: 0,
          linesRemoved: this.countRemovedLines(file),
          success: true,
        };
      }

      case 'rename': {
        if (!file.oldPath || !file.newPath) {
          throw new Error('Rename operation requires both old and new paths');
        }
        const oldResolved = path.resolve(workspaceRoot, file.oldPath);
        const content = await fs.readFile(oldResolved, 'utf-8');
        stagedDeletes.add(oldResolved);
        stagedWrites.set(resolvedPath, content);
        return {
          path: filePath,
          operation: 'rename',
          linesAdded: 0,
          linesRemoved: 0,
          success: true,
        };
      }

      case 'modify':
      default: {
        if (!fileExists) {
          throw new Error(`File not found: ${filePath}`);
        }
        const originalContent = await fs.readFile(resolvedPath, 'utf-8');
        const newContent = this.applyToFile(originalContent, file);
        stagedWrites.set(resolvedPath, newContent);
        return {
          path: filePath,
          operation: 'modify',
          linesAdded: this.countAddedLines(file),
          linesRemoved: this.countRemovedLines(file),
          success: true,
        };
      }
    }
  }

  /**
   * Validate file hunks against content
   */
  private validateFile(content: string, file: FilePatch): Conflict[] {
    const conflicts: Conflict[] = [];
    const lines = content.split('\n');

    for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
      const hunk = file.hunks[hunkIndex];
      const hunkConflicts = this.validateHunk(lines, hunk, hunkIndex, file.newPath || file.oldPath || '');
      conflicts.push(...hunkConflicts);
    }

    return conflicts;
  }

  /**
   * Validate a single hunk against file lines
   */
  private validateHunk(
    fileLines: string[],
    hunk: Hunk,
    hunkIndex: number,
    filePath: string
  ): Conflict[] {
    const conflicts: Conflict[] = [];
    const startLine = hunk.oldStart - 1; // Convert to 0-indexed

    // Check if start line is valid
    if (startLine < 0 || startLine > fileLines.length) {
      conflicts.push({
        file: filePath,
        hunkIndex,
        type: 'line_missing',
        message: `Hunk starts at invalid line ${hunk.oldStart}`,
      });
      return conflicts;
    }

    // Verify context lines match
    let lineOffset = 0;
    for (let i = 0; i < hunk.lines.length; i++) {
      const patchLine = hunk.lines[i];

      if (patchLine.type === 'context') {
        const fileLineIndex = startLine + lineOffset;
        
        if (fileLineIndex >= fileLines.length) {
          conflicts.push({
            file: filePath,
            hunkIndex,
            lineIndex: i,
            type: 'line_missing',
            expectedContent: patchLine.content,
            actualContent: '',
            message: `Context line ${fileLineIndex + 1} does not exist in file`,
          });
        } else {
          const fileLine = fileLines[fileLineIndex];
          if (!this.linesMatch(fileLine, patchLine.content)) {
            // Check if already applied
            const alreadyApplied = this.checkAlreadyApplied(fileLines, startLine, hunk);
            if (alreadyApplied) {
              conflicts.push({
                file: filePath,
                hunkIndex,
                lineIndex: i,
                type: 'already_applied',
                message: 'Hunk appears to have already been applied',
              });
              return conflicts;
            }

            conflicts.push({
              file: filePath,
              hunkIndex,
              lineIndex: i,
              type: 'context_mismatch',
              expectedContent: patchLine.content,
              actualContent: fileLine,
              message: `Context mismatch at line ${fileLineIndex + 1}`,
            });
          }
        }
        lineOffset++;
      } else if (patchLine.type === 'remove') {
        const fileLineIndex = startLine + lineOffset;
        
        if (fileLineIndex < fileLines.length) {
          const fileLine = fileLines[fileLineIndex];
          if (!this.linesMatch(fileLine, patchLine.content)) {
            conflicts.push({
              file: filePath,
              hunkIndex,
              lineIndex: i,
              type: 'context_mismatch',
              expectedContent: patchLine.content,
              actualContent: fileLine,
              message: `Expected to remove "${patchLine.content}" but found "${fileLine}"`,
            });
          }
        }
        lineOffset++;
      }
      // 'add' lines don't consume file lines
    }

    return conflicts;
  }

  /**
   * Check if hunk was already applied
   */
  private checkAlreadyApplied(fileLines: string[], startLine: number, hunk: Hunk): boolean {
    // Look for the added lines in the file
    const addedLines = hunk.lines.filter(l => l.type === 'add');
    if (addedLines.length === 0) return false;

    // Check if added lines exist at expected position
    const expectedPosition = startLine + hunk.lines.filter(l => l.type === 'remove').length;
    
    for (let i = 0; i < addedLines.length; i++) {
      const fileIndex = expectedPosition + i;
      if (fileIndex >= fileLines.length) return false;
      if (!this.linesMatch(fileLines[fileIndex], addedLines[i].content)) return false;
    }

    return true;
  }

  /**
   * Apply patch to file content
   */
  private applyToFile(content: string, file: FilePatch): string {
    const lines = content.split('\n');

    // Apply hunks in reverse order to preserve line numbers
    const sortedHunks = [...file.hunks].sort((a, b) => b.oldStart - a.oldStart);

    for (const hunk of sortedHunks) {
      this.applyHunk(lines, hunk);
    }

    return lines.join('\n');
  }

  /**
   * Apply a single hunk to lines array
   */
  private applyHunk(lines: string[], hunk: Hunk): void {
    const startLine = hunk.oldStart - 1;
    let lineIndex = startLine;

    // Remove old lines
    const removeCount = hunk.lines.filter(l => l.type === 'remove').length;
    lines.splice(startLine, removeCount);

    // Insert new lines
    const addLines = hunk.lines.filter(l => l.type === 'add').map(l => l.content);
    lines.splice(startLine, 0, ...addLines);
  }

  /**
   * Build new file content from create operation
   */
  private buildNewFileContent(file: FilePatch): string {
    const lines: string[] = [];

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') {
          lines.push(line.content);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if two lines match (with whitespace tolerance)
   */
  private linesMatch(line1: string, line2: string): boolean {
    // Exact match
    if (line1 === line2) return true;

    // Trimmed match (whitespace tolerance)
    if (line1.trim() === line2.trim()) return true;

    return false;
  }

  /**
   * Count added lines in file patch
   */
  private countAddedLines(file: FilePatch): number {
    return file.hunks.reduce((sum, hunk) => {
      return sum + hunk.lines.filter(l => l.type === 'add').length;
    }, 0);
  }

  /**
   * Count removed lines in file patch
   */
  private countRemovedLines(file: FilePatch): number {
    return file.hunks.reduce((sum, hunk) => {
      return sum + hunk.lines.filter(l => l.type === 'remove').length;
    }, 0);
  }

  /**
   * Generate unified diff between two contents
   */
  generateDiff(oldContent: string, newContent: string, filePath: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const hunks = this.findHunks(oldLines, newLines);

    const parts: string[] = [];
    parts.push(`--- a/${filePath}`);
    parts.push(`+++ b/${filePath}`);

    for (const hunk of hunks) {
      parts.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
      
      for (const line of hunk.lines) {
        if (line.type === 'context') {
          parts.push(` ${line.content}`);
        } else if (line.type === 'add') {
          parts.push(`+${line.content}`);
        } else if (line.type === 'remove') {
          parts.push(`-${line.content}`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Find hunks between old and new content
   */
  private findHunks(oldLines: string[], newLines: string[]): Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: PatchLine[];
  }> {
    const hunks: Array<{
      oldStart: number;
      oldCount: number;
      newStart: number;
      newCount: number;
      lines: PatchLine[];
    }> = [];

    // Simple diff algorithm using LCS
    const lcs = this.findLCS(oldLines, newLines);
    
    let oldIndex = 0;
    let newIndex = 0;
    let lcsIndex = 0;

    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      // Find start of change
      while (
        oldIndex < oldLines.length &&
        newIndex < newLines.length &&
        lcsIndex < lcs.length &&
        oldLines[oldIndex] === lcs[lcsIndex] &&
        newLines[newIndex] === lcs[lcsIndex]
      ) {
        oldIndex++;
        newIndex++;
        lcsIndex++;
      }

      if (oldIndex >= oldLines.length && newIndex >= newLines.length) break;

      // Collect changes
      const hunkLines: PatchLine[] = [];
      let removeCount = 0;
      let addCount = 0;

      // Add context before
      const contextStart = Math.max(0, oldIndex - 3);
      for (let i = contextStart; i < oldIndex; i++) {
        hunkLines.push({ type: 'context', content: oldLines[i] });
      }

      // Remove lines
      while (
        oldIndex < oldLines.length &&
        (lcsIndex >= lcs.length || oldLines[oldIndex] !== lcs[lcsIndex])
      ) {
        hunkLines.push({ type: 'remove', content: oldLines[oldIndex] });
        oldIndex++;
        removeCount++;
      }

      // Add lines
      while (
        newIndex < newLines.length &&
        (lcsIndex >= lcs.length || newLines[newIndex] !== lcs[lcsIndex])
      ) {
        hunkLines.push({ type: 'add', content: newLines[newIndex] });
        newIndex++;
        addCount++;
      }

      // Add context after
      let contextEnd = oldIndex + 3;
      while (oldIndex < oldLines.length && oldIndex < contextEnd) {
        hunkLines.push({ type: 'context', content: oldLines[oldIndex] });
        oldIndex++;
        newIndex++;
        lcsIndex++;
      }

      if (hunkLines.length > 0) {
        hunks.push({
          oldStart: contextStart + 1,
          oldCount: removeCount + (oldIndex - contextStart),
          newStart: contextStart + 1,
          newCount: addCount + (newIndex - contextStart - removeCount),
          lines: hunkLines,
        });
      }
    }

    return hunks;
  }

  /**
   * Find Longest Common Subsequence
   */
  private findLCS(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to find LCS
    const lcs: string[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        lcs.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }
}

// Singleton instance
let defaultEngine: DiffEngine | null = null;

/**
 * Get default diff engine instance
 */
export function getDiffEngine(): DiffEngine {
  if (!defaultEngine) {
    defaultEngine = new DiffEngine();
  }
  return defaultEngine;
}

/**
 * Create diff engine with custom limits
 */
export function createDiffEngine(limits: Partial<PatchLimits>): DiffEngine {
  return new DiffEngine(limits);
}
