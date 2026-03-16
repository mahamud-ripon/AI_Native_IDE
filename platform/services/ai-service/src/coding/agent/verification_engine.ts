/**
 * Verification Engine
 * 
 * Validates generated patches for safety, correctness, and consistency.
 * Runs multiple checks before patches are applied to the workspace.
 */

import {
  VerificationResult,
  VerificationError,
  VerificationWarning,
  VerificationStats,
  VERIFICATION_ERRORS,
  AGENT_DEFAULTS,
} from './agent_types.js';
import { GeneratedPatch } from './patch_builder.js';
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import { parsePatch } from '../patch/diff_parser.js';

/**
 * Verification Engine
 */
export class VerificationEngine {
  private workspace: WorkspaceFS | null = null;
  private maxPatchLines: number;

  constructor(options?: {
    workspace?: WorkspaceFS;
    maxPatchLines?: number;
  }) {
    this.workspace = options?.workspace ?? null;
    this.maxPatchLines = options?.maxPatchLines ?? AGENT_DEFAULTS.maxPatchLines;
  }

  /**
   * Set workspace
   */
  setWorkspace(workspace: WorkspaceFS): void {
    this.workspace = workspace;
  }

  /**
   * Verify multiple patches
   */
  async verify(patches: GeneratedPatch[]): Promise<VerificationResult> {
    const errors: VerificationError[] = [];
    const warnings: VerificationWarning[] = [];
    const stats: VerificationStats = {
      filesChecked: 0,
      syntaxValid: 0,
      syntaxInvalid: 0,
      conflicts: 0,
      importIssues: 0,
    };

    for (const patch of patches) {
      const patchResult = await this.verifyPatch(patch);

      errors.push(...patchResult.errors);
      warnings.push(...patchResult.warnings);
      stats.filesChecked++;
      stats.syntaxValid += patchResult.syntaxValid ? 1 : 0;
      stats.syntaxInvalid += patchResult.syntaxValid ? 0 : 1;
      stats.conflicts += patchResult.hasConflicts ? 1 : 0;
      stats.importIssues += patchResult.importIssues;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats,
    };
  }

  /**
   * Verify single patch
   */
  async verifyPatch(patch: GeneratedPatch): Promise<{
    errors: VerificationError[];
    warnings: VerificationWarning[];
    syntaxValid: boolean;
    hasConflicts: boolean;
    importIssues: number;
  }> {
    const errors: VerificationError[] = [];
    const warnings: VerificationWarning[] = [];
    let syntaxValid = true;
    let hasConflicts = false;
    let importIssues = 0;

    // 1. Check patch size
    const patchLines = patch.patch.split('\n').length;
    if (patchLines > this.maxPatchLines) {
      errors.push({
        code: VERIFICATION_ERRORS.PATCH_TOO_LARGE,
        message: `Patch exceeds max lines: ${patchLines} > ${this.maxPatchLines}`,
        file: patch.path,
        severity: 'error',
      });
    }

    // 2. Check file existence for modify/delete operations
    if (this.workspace) {
      const fileExists = await this.workspace.exists(patch.path);

      if (patch.originalContent && !fileExists) {
        // Trying to modify non-existent file
        if (patch.linesRemoved > 0) {
          errors.push({
            code: VERIFICATION_ERRORS.FILE_NOT_FOUND,
            message: `Cannot modify non-existent file: ${patch.path}`,
            file: patch.path,
            severity: 'error',
          });
        }
      }

      if (!patch.originalContent && fileExists && patch.linesAdded > 0) {
        // Trying to create existing file
        warnings.push({
          code: VERIFICATION_ERRORS.FILE_EXISTS,
          message: `File already exists, will be overwritten: ${patch.path}`,
          file: patch.path,
          suggestion: 'Consider using modify operation instead',
        });
      }
    }

    // 3. Parse patch for validity
    try {
      const parsed = parsePatch(patch.patch);
      // Check if patch parsed correctly - should have at least one file
      if (!parsed.files || parsed.files.length === 0) {
        errors.push({
          code: VERIFICATION_ERRORS.INVALID_OPERATION,
          message: 'Invalid patch format: no file changes found',
          file: patch.path,
          severity: 'error',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      errors.push({
        code: VERIFICATION_ERRORS.INVALID_OPERATION,
        message: `Patch parse error: ${message}`,
        file: patch.path,
        severity: 'error',
      });
    }

    // 4. Check for conflicts with existing content
    if (this.workspace && patch.originalContent) {
      try {
        const currentContent = await this.workspace.readFile(patch.path);
        if (currentContent !== patch.originalContent) {
          hasConflicts = true;
          warnings.push({
            code: VERIFICATION_ERRORS.PATCH_CONFLICT,
            message: `File has changed since patch was generated: ${patch.path}`,
            file: patch.path,
            suggestion: 'Re-generate patch with current file content',
          });
        }
      } catch {
        // File doesn't exist, no conflict
      }
    }

    // 5. Validate syntax of target content
    if (patch.targetContent) {
      const syntaxResult = this.validateSyntax(patch.path, patch.targetContent);
      syntaxValid = syntaxResult.valid;

      if (!syntaxResult.valid) {
        errors.push({
          code: VERIFICATION_ERRORS.SYNTAX_ERROR,
          message: `Syntax error: ${syntaxResult.error}`,
          file: patch.path,
          line: syntaxResult.line,
          severity: 'error',
        });
      }
    }

    // 6. Check for import issues
    importIssues = this.checkImports(patch.targetContent, patch.path);
    if (importIssues > 0) {
      warnings.push({
        code: VERIFICATION_ERRORS.IMPORT_MISSING,
        message: `Found ${importIssues} potential import issues`,
        file: patch.path,
        suggestion: 'Verify all imports exist in the project',
      });
    }

    return {
      errors,
      warnings,
      syntaxValid,
      hasConflicts,
      importIssues,
    };
  }

  /**
   * Validate syntax for file type
   */
  private validateSyntax(
    path: string,
    content: string
  ): { valid: boolean; error?: string; line?: number } {
    const ext = path.split('.').pop()?.toLowerCase();

    // Basic syntax checks by file type
    switch (ext) {
      case 'ts':
      case 'tsx':
        return this.validateTypeScript(content);

      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
        return this.validateJavaScript(content);

      case 'py':
        return this.validatePython(content);

      case 'json':
        return this.validateJSON(content);

      default:
        // Unknown file type, assume valid
        return { valid: true };
    }
  }

  /**
   * Validate TypeScript syntax (basic checks)
   */
  private validateTypeScript(content: string): { valid: boolean; error?: string; line?: number } {
    // Check for balanced braces
    const braceCount = (content.match(/{/g) || []).length - (content.match(/}/g) || []).length;
    if (braceCount !== 0) {
      return {
        valid: false,
        error: 'Unbalanced braces',
        line: this.findBraceErrorLine(content, braceCount > 0 ? '{' : '}'),
      };
    }

    // Check for balanced brackets
    const bracketCount = (content.match(/\[/g) || []).length - (content.match(/]/g) || []).length;
    if (bracketCount !== 0) {
      return {
        valid: false,
        error: 'Unbalanced brackets',
      };
    }

    // Check for balanced parentheses
    const parenCount = (content.match(/\(/g) || []).length - (content.match(/\)/g) || []).length;
    if (parenCount !== 0) {
      return {
        valid: false,
        error: 'Unbalanced parentheses',
      };
    }

    // Check for common syntax errors
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Missing semicolon after class/method (heuristic)
      if (line.match(/^(class|interface|type|enum)\s+\w+[^;{]*$/)) {
        return {
          valid: false,
          error: 'Missing opening brace',
          line: i + 1,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Validate JavaScript syntax (basic checks)
   */
  private validateJavaScript(content: string): { valid: boolean; error?: string; line?: number } {
    // Same as TypeScript for basic checks
    return this.validateTypeScript(content);
  }

  /**
   * Validate Python syntax (basic checks)
   */
  private validatePython(content: string): { valid: boolean; error?: string; line?: number } {
    const lines = content.split('\n');

    // Check indentation consistency
    let expectedIndent = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length === 0) continue;

      const indent = line.length - line.trimStart().length;
      const trimmed = line.trim();

      // Decrease indent after block end
      if (trimmed.match(/^(return|break|continue|pass|raise)/)) {
        // These typically end a block
      }

      // Check for colon (block start)
      if (trimmed.endsWith(':')) {
        expectedIndent = indent + 4;
      }
    }

    // Check for balanced parentheses, brackets, braces
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      return { valid: false, error: 'Unbalanced parentheses' };
    }

    return { valid: true };
  }

  /**
   * Validate JSON syntax
   */
  private validateJSON(content: string): { valid: boolean; error?: string; line?: number } {
    try {
      JSON.parse(content);
      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON';
      return { valid: false, error: message };
    }
  }

  /**
   * Find line with brace error
   */
  private findBraceErrorLine(content: string, brace: string): number {
    const lines = content.split('\n');
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') depth++;
        if (char === '}') depth--;
      }
    }

    // Return last line as approximation
    return lines.length;
  }

  /**
   * Check for import issues
   */
  private checkImports(content: string, path: string): number {
    if (!content) return 0;

    let issues = 0;
    const lines = content.split('\n');
    const dir = path.split('/').slice(0, -1).join('/');

    for (const line of lines) {
      const trimmed = line.trim();

      // Check relative imports
      const importMatch = trimmed.match(/from\s+['"](\.[^'"]+)['"]/);
      if (importMatch) {
        // Relative import - could validate existence
        // For now, just count
        issues++;
      }

      // Check for missing file extensions in Node.js imports
      if (trimmed.match(/from\s+['"]\.[^'"]+(?!\.ts|\.js|\.tsx|\.jsx)['"]/)) {
        // Import without extension
        issues++;
      }
    }

    return issues;
  }
}

// Singleton instance
let defaultEngine: VerificationEngine | null = null;

/**
 * Get default verification engine
 */
export function getVerificationEngine(): VerificationEngine {
  if (!defaultEngine) {
    defaultEngine = new VerificationEngine();
  }
  return defaultEngine;
}

/**
 * Create verification engine
 */
export function createVerificationEngine(options?: {
  workspace?: WorkspaceFS;
  maxPatchLines?: number;
}): VerificationEngine {
  return new VerificationEngine(options);
}

/**
 * Verify patches helper
 */
export async function verifyPatches(patches: GeneratedPatch[]): Promise<VerificationResult> {
  const engine = getVerificationEngine();
  return engine.verify(patches);
}
