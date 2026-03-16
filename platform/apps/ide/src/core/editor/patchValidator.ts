/**
 * Patch Validator
 *
 * Validates AI-generated patches before application to prevent file corruption.
 * Ensures patches apply cleanly and safely.
 *
 * Validation checks:
 * - Target file exists
 * - Patch offsets are valid
 * - File not modified since patch generation
 * - No overlapping edits
 * - Patch applies cleanly (dry-run)
 *
 * Architecture:
 *   PatchPreviewPanel
 *        │
 *   PatchValidator ← THIS MODULE
 *        │
 *   EditorManager.applyPatch()
 */

import { editorManager, TextPatch } from './editorManager';

// ========================================
// TYPES
// ========================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  canForceApply: boolean;
}

export interface ValidationError {
  code: string;
  message: string;
  line?: number;
  details?: Record<string, unknown>;
}

export interface ValidationWarning {
  code: string;
  message: string;
  line?: number;
  details?: Record<string, unknown>;
}

export interface PatchContext {
  projectId: string;
  filePath: string;
  patch: TextPatch;
  currentContent?: string;
  patchGeneratedAt?: number;
  lastModifiedAt?: number;
}

// ========================================
// VALIDATOR CLASS
// ========================================

class PatchValidator {
  /**
   * Validate a patch before application
   */
  validate(context: PatchContext): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Check if target file exists
    const fileExists = this.checkFileExists(context);
    if (!fileExists) {
      errors.push({
        code: 'FILE_NOT_FOUND',
        message: `Target file does not exist: ${context.filePath}`,
      });
    }

    // 1b. Check file version (conflict detection)
    if (context.patch.fileVersion || context.patch.modelVersionId || context.patch.contentHash) {
      const versionCheck = this.checkFileVersion(context);
      if (!versionCheck.valid) {
        errors.push({
          code: 'FILE_VERSION_MISMATCH',
          message: versionCheck.reason ?? 'File was modified since patch generation',
          details: {
            expectedVersion: context.patch.fileVersion,
            expectedModelVersionId: context.patch.modelVersionId,
          },
        });
      }
    }

    // 2. Check if file was modified since patch generation
    if (context.patchGeneratedAt && context.lastModifiedAt) {
      if (context.lastModifiedAt > context.patchGeneratedAt) {
        warnings.push({
          code: 'FILE_MODIFIED',
          message: 'File was modified after patch was generated',
          details: {
            patchGeneratedAt: context.patchGeneratedAt,
            lastModifiedAt: context.lastModifiedAt,
          },
        });
      }
    }

    // 3. Validate patch offsets
    const offsetResult = this.validateOffsets(context);
    if (!offsetResult.valid) {
      errors.push(...offsetResult.errors);
    }
    warnings.push(...offsetResult.warnings);

    // 4. Check for overlapping edits
    const overlapResult = this.checkOverlappingEdits(context);
    if (!overlapResult.valid) {
      errors.push(...overlapResult.errors);
    }

    // 5. Dry-run patch application
    const dryRunResult = this.dryRunApply(context);
    if (!dryRunResult.valid) {
      errors.push(...dryRunResult.errors);
    }
    warnings.push(...dryRunResult.warnings);

    // Determine if patch can be force-applied
    const canForceApply = errors.length === 0 || 
      (errors.length === 1 && errors[0].code === 'FILE_MODIFIED');

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      canForceApply,
    };
  }

  /**
   * Validate multiple patches
   */
  validateBatch(contexts: PatchContext[]): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>();

    // Check for conflicts between patches
    const filePatches = new Map<string, PatchContext[]>();
    for (const ctx of contexts) {
      const key = ctx.filePath;
      const existing = filePatches.get(key) ?? [];
      existing.push(ctx);
      filePatches.set(key, existing);
    }

    // Validate each patch
    for (const ctx of contexts) {
      const result = this.validate(ctx);
      
      // Add inter-patch conflict warnings
      const sameFilePatches = filePatches.get(ctx.filePath) ?? [];
      if (sameFilePatches.length > 1) {
        result.warnings.push({
          code: 'MULTIPLE_PATCHES',
          message: `Multiple patches target the same file (${sameFilePatches.length} patches)`,
          details: {
            patchIds: sameFilePatches.map(p => p.patch.patchId),
          },
        });
      }

      results.set(ctx.patch.patchId, result);
    }

    return results;
  }

  // ========================================
  // VALIDATION CHECKS
  // ========================================

  /**
   * Check if target file exists
   */
  private checkFileExists(context: PatchContext): boolean {
    const model = editorManager.getModel(context.projectId, context.filePath);
    if (model) return true;

    // Check if we have content
    if (context.currentContent !== undefined) {
      return true;
    }

    return false;
  }

  /**
   * Check file version for conflict detection
   */
  private checkFileVersion(context: PatchContext): { valid: boolean; reason?: string } {
    const { patch, projectId, filePath } = context;

    // Check file version
    if (patch.fileVersion !== undefined) {
      const versionResult = editorManager.verifyFileVersion(
        projectId,
        filePath,
        patch.fileVersion,
        patch.modelVersionId
      );
      if (!versionResult.valid) {
        return versionResult;
      }
    }

    // Check model version ID
    if (patch.modelVersionId !== undefined) {
      const model = editorManager.getModel(projectId, filePath);
      if (!model) {
        return { valid: false, reason: 'Model not found' };
      }
      const currentVersion = model.getVersionId();
      if (currentVersion !== patch.modelVersionId) {
        return {
          valid: false,
          reason: `Model version mismatch: expected ${patch.modelVersionId}, current is ${currentVersion}`,
        };
      }
    }

    // Check content hash
    if (patch.contentHash !== undefined) {
      const hashResult = editorManager.verifyContentHash(projectId, filePath, patch.contentHash);
      if (!hashResult.valid) {
        return hashResult;
      }
    }

    return { valid: true };
  }

  /**
   * Validate patch offsets are within file bounds
   */
  private validateOffsets(context: PatchContext): {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const { patch } = context;
    const content = context.currentContent ?? 
      editorManager.getFileContent(context.projectId, context.filePath) ?? '';

    if (!content) {
      return { valid: true, errors: [], warnings: [] };
    }

    const lines = content.split('\n');
    const lineCount = lines.length;

    // Check start line
    if (patch.startLine < 1) {
      errors.push({
        code: 'INVALID_START_LINE',
        message: `Invalid start line: ${patch.startLine}. Line numbers start at 1.`,
        line: patch.startLine,
      });
    }

    // Check end line
    if (patch.endLine > lineCount + 1) {
      errors.push({
        code: 'INVALID_END_LINE',
        message: `End line ${patch.endLine} exceeds file length (${lineCount} lines)`,
        line: patch.endLine,
      });
    }

    // Check if start > end
    if (patch.startLine > patch.endLine) {
      errors.push({
        code: 'INVALID_RANGE',
        message: `Start line ${patch.startLine} is greater than end line ${patch.endLine}`,
        line: patch.startLine,
      });
    }

    // Check column offsets
    if (patch.startColumn < 1) {
      errors.push({
        code: 'INVALID_START_COLUMN',
        message: `Invalid start column: ${patch.startColumn}. Columns start at 1.`,
        line: patch.startLine,
      });
    }

    if (patch.endLine >= 1 && patch.endLine <= lineCount) {
      const endLineLength = lines[patch.endLine - 1]?.length ?? 0;
      if (patch.endColumn > endLineLength + 1) {
        warnings.push({
          code: 'COLUMN_BEYOND_LINE',
          message: `End column ${patch.endColumn} is beyond line ${patch.endLine} length (${endLineLength})`,
          line: patch.endLine,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check for overlapping edits with existing patches
   */
  private checkOverlappingEdits(context: PatchContext): {
    valid: boolean;
    errors: ValidationError[];
  } {
    const errors: ValidationError[] = [];

    // Get patch history for this file
    const history = editorManager.getPatchHistory(context.filePath);
    
    // Check if this patch overlaps with any applied patches
    for (const appliedPatch of history) {
      if (this.rangesOverlap(
        context.patch.startLine,
        context.patch.endLine,
        appliedPatch.startLine,
        appliedPatch.endLine
      )) {
        errors.push({
          code: 'OVERLAPPING_EDIT',
          message: `Patch overlaps with previously applied patch ${appliedPatch.patchId}`,
          line: context.patch.startLine,
          details: {
            newPatch: {
              start: context.patch.startLine,
              end: context.patch.endLine,
            },
            existingPatch: {
              id: appliedPatch.patchId,
              start: appliedPatch.startLine,
              end: appliedPatch.endLine,
            },
          },
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if two line ranges overlap
   */
  private rangesOverlap(
    start1: number,
    end1: number,
    start2: number,
    end2: number
  ): boolean {
    return start1 <= end2 && start2 <= end1;
  }

  /**
   * Dry-run patch application to verify it applies cleanly
   */
  private dryRunApply(context: PatchContext): {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const { patch } = context;
    const content = context.currentContent ?? 
      editorManager.getFileContent(context.projectId, context.filePath);

    if (!content) {
      // File doesn't exist - patch will create it
      warnings.push({
        code: 'NEW_FILE',
        message: 'Patch will create a new file',
      });
      return { valid: true, errors: [], warnings };
    }

    // Validate old text if provided
    if (patch.oldText) {
      const lines = content.split('\n');
      
      // Extract the text at the specified range
      const startLineIdx = Math.max(0, patch.startLine - 1);
      const endLineIdx = Math.min(lines.length - 1, patch.endLine - 1);
      
      const actualText = lines.slice(startLineIdx, endLineIdx + 1).join('\n');
      
      if (actualText !== patch.oldText) {
        // Check if it's a whitespace difference
        const normalizedActual = actualText.replace(/\s+/g, ' ').trim();
        const normalizedOld = patch.oldText.replace(/\s+/g, ' ').trim();
        
        if (normalizedActual === normalizedOld) {
          warnings.push({
            code: 'WHITESPACE_MISMATCH',
            message: 'Patch old text matches except for whitespace differences',
            line: patch.startLine,
          });
        } else {
          errors.push({
            code: 'OLD_TEXT_MISMATCH',
            message: 'Patch old text does not match file content at specified range',
            line: patch.startLine,
            details: {
              expected: patch.oldText.substring(0, 100),
              actual: actualText.substring(0, 100),
            },
          });
        }
      }
    }

    // Simulate applying the patch
    try {
      const lines = content.split('\n');
      const newLines = this.simulatePatchApply(lines, patch);
      
      // Check if result is valid
      if (newLines === null) {
        errors.push({
          code: 'APPLY_FAILED',
          message: 'Failed to simulate patch application',
          line: patch.startLine,
        });
      }
    } catch (error) {
      errors.push({
        code: 'APPLY_ERROR',
        message: `Error simulating patch: ${error instanceof Error ? error.message : 'Unknown error'}`,
        line: patch.startLine,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Simulate applying a patch to lines array
   */
  private simulatePatchApply(
    lines: string[],
    patch: TextPatch
  ): string[] | null {
    try {
      const result = [...lines];
      
      // Convert to 0-indexed
      const startIdx = patch.startLine - 1;
      const endIdx = patch.endLine - 1;
      
      // Handle insertion at end of file
      if (startIdx >= lines.length) {
        result.push(patch.newText);
        return result;
      }
      
      // Handle replacement
      const before = result.slice(0, startIdx);
      const after = result.slice(endIdx + 1);
      
      return [...before, patch.newText, ...after].filter(l => l !== undefined);
    } catch {
      return null;
    }
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  /**
   * Quick validation check (returns boolean only)
   */
  isValid(context: PatchContext): boolean {
    return this.validate(context).valid;
  }

  /**
   * Check if patch can be force-applied despite warnings
   */
  canForceApply(context: PatchContext): boolean {
    return this.validate(context).canForceApply;
  }

  /**
   * Get validation summary message
   */
  getSummary(result: ValidationResult): string {
    if (result.valid) {
      if (result.warnings.length > 0) {
        return `Valid with ${result.warnings.length} warning(s)`;
      }
      return 'Valid';
    }

    const errorCount = result.errors.length;
    const warningCount = result.warnings.length;
    
    let summary = `Invalid: ${errorCount} error(s)`;
    if (warningCount > 0) {
      summary += `, ${warningCount} warning(s)`;
    }
    
    return summary;
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const patchValidator = new PatchValidator();

// ========================================
// CONVENIENCE FUNCTIONS
// ========================================

/**
 * Validate a single patch
 */
export function validatePatch(
  projectId: string,
  filePath: string,
  patch: TextPatch,
  options?: {
    currentContent?: string;
    patchGeneratedAt?: number;
    lastModifiedAt?: number;
  }
): ValidationResult {
  return patchValidator.validate({
    projectId,
    filePath,
    patch,
    ...options,
  });
}

/**
 * Validate multiple patches
 */
export function validatePatches(
  patches: Array<{
    projectId: string;
    filePath: string;
    patch: TextPatch;
  }>
): Map<string, ValidationResult> {
  return patchValidator.validateBatch(
    patches.map(p => ({
      projectId: p.projectId,
      filePath: p.filePath,
      patch: p.patch,
    }))
  );
}

/**
 * Quick check if patch is valid
 */
export function isPatchValid(
  projectId: string,
  filePath: string,
  patch: TextPatch
): boolean {
  return patchValidator.isValid({
    projectId,
    filePath,
    patch,
  });
}

export default patchValidator;
