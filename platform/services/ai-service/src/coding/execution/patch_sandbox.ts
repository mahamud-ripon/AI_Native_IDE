/**
 * Patch Sandbox
 * 
 * Validates patches before application using syntax checks,
 * type checking, linting, and dependency validation.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import {
  SandboxResult,
  SandboxCheckResult,
  SandboxError,
  SandboxWarning,
  SandboxCheckType,
  SandboxConfig,
  SANDBOX_DEFAULTS,
  SANDBOX_ERRORS,
  SandboxValidationError,
} from './execution_types.js';
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import { GeneratedPatch } from '../agent/patch_builder.js';
import { parsePatch } from '../patch/diff_parser.js';

/**
 * Patch Sandbox
 */
export class PatchSandbox {
  private config: Required<SandboxConfig>;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...SANDBOX_DEFAULTS, ...config } as Required<SandboxConfig>;
  }

  /**
   * Validate a single patch
   */
  async validatePatch(
    workspace: WorkspaceFS,
    patch: GeneratedPatch
  ): Promise<SandboxResult> {
    return this.validatePatches(workspace, [patch]);
  }

  /**
   * Validate multiple patches
   */
  async validatePatches(
    workspace: WorkspaceFS,
    patches: GeneratedPatch[]
  ): Promise<SandboxResult> {
    const startTime = Date.now();
    const checks: SandboxCheckResult[] = [];
    const errors: SandboxError[] = [];
    const warnings: SandboxWarning[] = [];

    for (const checkType of this.config.enabledChecks) {
      const checkResult = await this.runCheck(workspace, patches, checkType);
      checks.push(checkResult);

      // Collect errors and warnings
      if (!checkResult.passed) {
        // Run check-specific error collection
        const checkErrors = await this.collectErrors(workspace, patches, checkType);
        errors.push(...checkErrors.errors);
        warnings.push(...checkErrors.warnings);

        // Fail fast if configured
        if (this.config.failFast && errors.length > 0) {
          break;
        }
      }
    }

    return {
      valid: errors.length === 0,
      checks,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Validate raw patch string
   */
  async validateRawPatch(
    workspace: WorkspaceFS,
    patchContent: string
  ): Promise<SandboxResult> {
    // Parse the patch first
    const parsed = parsePatch(patchContent);

    if (!parsed.files || parsed.files.length === 0) {
      return {
        valid: false,
        checks: [],
        errors: [{
          type: 'syntax',
          code: SANDBOX_ERRORS.SYNTAX_ERROR,
          message: 'Invalid patch format: no file changes found',
          severity: 'error',
        }],
        warnings: [],
        durationMs: 0,
      };
    }

    // Convert to GeneratedPatch format for validation
    const patches: GeneratedPatch[] = [];

    for (const file of parsed.files) {
      patches.push({
        id: `parsed-${file.newPath}`,
        editId: '',
        path: file.newPath || file.oldPath || '',
        patch: patchContent,
        originalContent: '',
        targetContent: '',
        linesAdded: file.hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === 'add').length, 0),
        linesRemoved: file.hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === 'remove').length, 0),
      });
    }

    return this.validatePatches(workspace, patches);
  }

  /**
   * Run a specific check
   */
  private async runCheck(
    workspace: WorkspaceFS,
    patches: GeneratedPatch[],
    checkType: SandboxCheckType
  ): Promise<SandboxCheckResult> {
    const startTime = Date.now();

    try {
      switch (checkType) {
        case 'syntax':
          return await this.checkSyntax(workspace, patches);

        case 'typecheck':
          return await this.checkTypes(workspace, patches);

        case 'lint':
          return await this.checkLint(workspace, patches);

        case 'dependency':
          return await this.checkDependencies(workspace, patches);

        case 'test':
          return await this.runTests(workspace, patches);

        case 'build':
          return await this.runBuild(workspace, patches);

        default:
          return {
            type: checkType,
            passed: true,
            durationMs: 0,
            errorCount: 0,
            warningCount: 0,
          };
      }
    } catch (error) {
      return {
        type: checkType,
        passed: false,
        durationMs: Date.now() - startTime,
        output: error instanceof Error ? error.message : 'Unknown error',
        errorCount: 1,
        warningCount: 0,
      };
    }
  }

  /**
   * Check syntax validity
   */
  private async checkSyntax(
    workspace: WorkspaceFS,
    patches: GeneratedPatch[]
  ): Promise<SandboxCheckResult> {
    const startTime = Date.now();
    let errorCount = 0;
    let warningCount = 0;

    for (const patch of patches) {
      if (!patch.targetContent) continue;

      const ext = path.extname(patch.path).toLowerCase();
      const syntaxResult = this.validateFileSyntax(ext, patch.targetContent);

      if (!syntaxResult.valid) {
        errorCount += syntaxResult.errors.length;
        warningCount += syntaxResult.warnings.length;
      }
    }

    return {
      type: 'syntax',
      passed: errorCount === 0,
      durationMs: Date.now() - startTime,
      errorCount,
      warningCount,
    };
  }

  /**
   * Validate file syntax by extension
   */
  private validateFileSyntax(
    ext: string,
    content: string
  ): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':
        // Check balanced braces
        const braceCount = (content.match(/{/g) || []).length - (content.match(/}/g) || []).length;
        if (braceCount !== 0) {
          errors.push('Unbalanced braces');
        }

        // Check balanced brackets
        const bracketCount = (content.match(/\[/g) || []).length - (content.match(/]/g) || []).length;
        if (bracketCount !== 0) {
          errors.push('Unbalanced brackets');
        }

        // Check balanced parentheses
        const parenCount = (content.match(/\(/g) || []).length - (content.match(/\)/g) || []).length;
        if (parenCount !== 0) {
          errors.push('Unbalanced parentheses');
        }

        // Check for template literal issues
        const templateCount = (content.match(/`/g) || []).length;
        if (templateCount % 2 !== 0) {
          errors.push('Unbalanced template literals');
        }
        break;

      case '.json':
        try {
          JSON.parse(content);
        } catch (e) {
          errors.push(`Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}`);
        }
        break;

      case '.py':
        // Check indentation consistency
        const lines = content.split('\n');
        for (let i = 1; i < lines.length; i++) {
          const prevIndent = lines[i - 1].length - lines[i - 1].trimStart().length;
          const currIndent = lines[i].length - lines[i].trimStart().length;

          // Simple check: indent should be multiple of 4
          if (currIndent % 4 !== 0 && lines[i].trim().length > 0) {
            warnings.push(`Line ${i + 1}: Non-standard indentation`);
          }
        }
        break;
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Check types using TypeScript compiler
   */
  private async checkTypes(
    workspace: WorkspaceFS,
    patches: GeneratedPatch[]
  ): Promise<SandboxCheckResult> {
    const startTime = Date.now();

    // Check if there are TypeScript files
    const tsFiles = patches.filter(p =>
      p.path.endsWith('.ts') || p.path.endsWith('.tsx')
    );

    if (tsFiles.length === 0) {
      return {
        type: 'typecheck',
        passed: true,
        durationMs: 0,
        errorCount: 0,
        warningCount: 0,
        output: 'No TypeScript files to check',
      };
    }

    // Run typecheck command
    try {
      const result = await this.runCommand(
        workspace,
        this.config.typecheckCommand,
        this.config.timeoutMs
      );

      return {
        type: 'typecheck',
        passed: result.exitCode === 0,
        durationMs: Date.now() - startTime,
        output: result.output,
        errorCount: result.exitCode === 0 ? 0 : 1,
        warningCount: 0,
      };
    } catch (error) {
      return {
        type: 'typecheck',
        passed: false,
        durationMs: Date.now() - startTime,
        output: error instanceof Error ? error.message : 'Typecheck failed',
        errorCount: 1,
        warningCount: 0,
      };
    }
  }

  /**
   * Check lint using ESLint
   */
  private async checkLint(
    workspace: WorkspaceFS,
    patches: GeneratedPatch[]
  ): Promise<SandboxCheckResult> {
    const startTime = Date.now();

    // Check if there are lintable files
    const lintableFiles = patches.filter(p =>
      p.path.endsWith('.ts') || p.path.endsWith('.tsx') ||
      p.path.endsWith('.js') || p.path.endsWith('.jsx')
    );

    if (lintableFiles.length === 0) {
      return {
        type: 'lint',
        passed: true,
        durationMs: 0,
        errorCount: 0,
        warningCount: 0,
        output: 'No lintable files',
      };
    }

    try {
      const result = await this.runCommand(
        workspace,
        this.config.lintCommand,
        this.config.timeoutMs
      );

      return {
        type: 'lint',
        passed: result.exitCode === 0,
        durationMs: Date.now() - startTime,
        output: result.output,
        errorCount: result.exitCode === 0 ? 0 : 1,
        warningCount: 0,
      };
    } catch (error) {
      return {
        type: 'lint',
        passed: false,
        durationMs: Date.now() - startTime,
        output: error instanceof Error ? error.message : 'Lint failed',
        errorCount: 1,
        warningCount: 0,
      };
    }
  }

  /**
   * Check dependencies
   */
  private async checkDependencies(
    workspace: WorkspaceFS,
    patches: GeneratedPatch[]
  ): Promise<SandboxCheckResult> {
    const startTime = Date.now();
    let errorCount = 0;
    let warningCount = 0;

    // Extract imports from target content
    for (const patch of patches) {
      if (!patch.targetContent) continue;

      const imports = this.extractImports(patch.targetContent);

      for (const imp of imports) {
        // Check if import is relative
        if (imp.startsWith('.')) {
          // Could validate relative imports exist
          // For now, just count
          warningCount++;
        }
      }
    }

    return {
      type: 'dependency',
      passed: errorCount === 0,
      durationMs: Date.now() - startTime,
      errorCount,
      warningCount,
    };
  }

  /**
   * Run tests
   */
  private async runTests(
    workspace: WorkspaceFS,
    patches: GeneratedPatch[]
  ): Promise<SandboxCheckResult> {
    const startTime = Date.now();

    try {
      const result = await this.runCommand(
        workspace,
        this.config.testCommand,
        this.config.timeoutMs * 2 // Tests may take longer
      );

      return {
        type: 'test',
        passed: result.exitCode === 0,
        durationMs: Date.now() - startTime,
        output: result.output,
        errorCount: result.exitCode === 0 ? 0 : 1,
        warningCount: 0,
      };
    } catch (error) {
      return {
        type: 'test',
        passed: false,
        durationMs: Date.now() - startTime,
        output: error instanceof Error ? error.message : 'Tests failed',
        errorCount: 1,
        warningCount: 0,
      };
    }
  }

  /**
   * Run build
   */
  private async runBuild(
    workspace: WorkspaceFS,
    patches: GeneratedPatch[]
  ): Promise<SandboxCheckResult> {
    const startTime = Date.now();

    try {
      const result = await this.runCommand(
        workspace,
        this.config.buildCommand,
        this.config.timeoutMs * 2
      );

      return {
        type: 'build',
        passed: result.exitCode === 0,
        durationMs: Date.now() - startTime,
        output: result.output,
        errorCount: result.exitCode === 0 ? 0 : 1,
        warningCount: 0,
      };
    } catch (error) {
      return {
        type: 'build',
        passed: false,
        durationMs: Date.now() - startTime,
        output: error instanceof Error ? error.message : 'Build failed',
        errorCount: 1,
        warningCount: 0,
      };
    }
  }

  /**
   * Collect errors for a specific check
   */
  private async collectErrors(
    workspace: WorkspaceFS,
    patches: GeneratedPatch[],
    checkType: SandboxCheckType
  ): Promise<{ errors: SandboxError[]; warnings: SandboxWarning[] }> {
    const errors: SandboxError[] = [];
    const warnings: SandboxWarning[] = [];

    for (const patch of patches) {
      if (!patch.targetContent) continue;

      const ext = path.extname(patch.path).toLowerCase();

      if (checkType === 'syntax') {
        const result = this.validateFileSyntax(ext, patch.targetContent);

        for (const err of result.errors) {
          errors.push({
            type: 'syntax',
            code: SANDBOX_ERRORS.SYNTAX_ERROR,
            message: err,
            file: patch.path,
            severity: 'error',
          });
        }

        for (const warn of result.warnings) {
          warnings.push({
            type: 'syntax',
            code: 'SYNTAX_WARNING',
            message: warn,
            file: patch.path,
          });
        }
      }
    }

    return { errors, warnings };
  }

  /**
   * Extract imports from code
   */
  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  /**
   * Run a command in the workspace
   */
  private async runCommand(
    workspace: WorkspaceFS,
    command: string,
    timeoutMs: number
  ): Promise<{ exitCode: number; output: string }> {
    const workspacePath = workspace.getConfig().rootPath;

    // For now, return a simulated result
    // In production, this would use child_process.spawn
    // with proper timeout and output capture

    return new Promise((resolve) => {
      // Simulate command execution
      setTimeout(() => {
        // Default to success for now
        // Real implementation would run actual commands
        resolve({
          exitCode: 0,
          output: `Command: ${command}\nStatus: simulated success`,
        });
      }, 100);
    });
  }
}

// Singleton instance
let defaultSandbox: PatchSandbox | null = null;

/**
 * Get default patch sandbox
 */
export function getPatchSandbox(): PatchSandbox {
  if (!defaultSandbox) {
    defaultSandbox = new PatchSandbox();
  }
  return defaultSandbox;
}

/**
 * Create patch sandbox
 */
export function createPatchSandbox(config?: Partial<SandboxConfig>): PatchSandbox {
  return new PatchSandbox(config);
}

/**
 * Validate patch helper
 */
export async function validatePatch(
  workspace: WorkspaceFS,
  patch: GeneratedPatch
): Promise<SandboxResult> {
  const sandbox = getPatchSandbox();
  return sandbox.validatePatch(workspace, patch);
}

/**
 * Validate patches helper
 */
export async function validatePatches(
  workspace: WorkspaceFS,
  patches: GeneratedPatch[]
): Promise<SandboxResult> {
  const sandbox = getPatchSandbox();
  return sandbox.validatePatches(workspace, patches);
}
