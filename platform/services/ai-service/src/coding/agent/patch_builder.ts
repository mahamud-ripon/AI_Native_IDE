/**
 * Patch Builder
 * 
 * Generates unified diff patches from edit plans.
 * Uses LLM to generate actual code changes based on instructions.
 */

import * as crypto from 'crypto';
import {
  FileEditPlan,
  EditPlan,
  LLMMessage,
  LLMProvider,
  AGENT_DEFAULTS,
} from './agent_types.js';
import { getLLMProvider } from './plan_generator.js';
import { WorkspaceFS } from '../workspace/workspace_fs.js';

/**
 * Generated patch
 */
export interface GeneratedPatch {
  id: string;
  editId: string;
  path: string;
  patch: string;
  originalContent: string;
  targetContent: string;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Patch Builder
 */
export class PatchBuilder {
  private provider: LLMProvider | null;
  private workspace: WorkspaceFS | null = null;
  private maxPatchLines: number;

  constructor(options?: {
    provider?: LLMProvider;
    workspace?: WorkspaceFS;
    maxPatchLines?: number;
  }) {
    this.provider = options?.provider ?? getLLMProvider();
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
   * Build patches from edit plan
   */
  async build(editPlan: EditPlan): Promise<GeneratedPatch[]> {
    const patches: GeneratedPatch[] = [];

    for (const edit of editPlan.edits) {
      try {
        const patch = await this.buildPatch(edit);
        if (patch) {
          patches.push(patch);
        }
      } catch (error) {
        console.error(`Failed to build patch for ${edit.path}:`, error);
      }
    }

    return patches;
  }

  /**
   * Build single patch from file edit
   */
  async buildPatch(edit: FileEditPlan): Promise<GeneratedPatch | null> {
    // Get original content
    let originalContent = edit.originalContent ?? '';
    if (!originalContent && this.workspace) {
      try {
        originalContent = await this.workspace.readFile(edit.path);
      } catch {
        // File doesn't exist, will be created
        originalContent = '';
      }
    }

    // Generate target content based on operation
    let targetContent: string;

    switch (edit.operation) {
      case 'create':
        targetContent = await this.generateNewFile(edit);
        break;

      case 'modify':
        targetContent = await this.generateModifiedFile(edit, originalContent);
        break;

      case 'delete':
        // If the file doesn't exist, skip this delete (nothing to delete)
        if (!originalContent) {
          console.warn(`[PatchBuilder] Skipping delete for non-existent file: ${edit.path}`);
          return null;
        }
        targetContent = '';
        break;

      case 'rename':
        targetContent = originalContent;
        break;

      default:
        return null;
    }

    // Generate unified diff
    const patch = this.generateUnifiedDiff(
      edit.path,
      originalContent,
      targetContent
    );

    // Check patch size
    const patchLines = patch.split('\n').length;
    if (patchLines > this.maxPatchLines) {
      console.warn(`Patch for ${edit.path} exceeds max lines (${patchLines} > ${this.maxPatchLines})`);
    }

    // Count changes
    const { added, removed } = this.countChanges(patch);

    return {
      id: this.generatePatchId(),
      editId: edit.id,
      path: edit.path,
      patch,
      originalContent,
      targetContent,
      linesAdded: added,
      linesRemoved: removed,
    };
  }

  /**
   * Generate new file content
   */
  private async generateNewFile(edit: FileEditPlan): Promise<string> {
    if (!this.provider) {
      return `// ${edit.instructions}`;
    }

    const systemPrompt = `You are an expert code generator. Generate clean, production-ready code.

## Rules
1. Include necessary imports
2. Follow language conventions
3. Add helpful comments
4. Keep code focused and minimal`;

    const contextPrompt = this.buildContextPrompt(edit, {
      heading: '## Context',
      maxChunks: 2,
      maxCharsPerChunk: 450,
    });

    const userPrompt = `## Task
Create a new file: ${edit.path}

## Instructions
${edit.instructions}
${contextPrompt}

Generate the complete file content.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.provider.complete(messages, {
      temperature: 0.2,
      maxTokens: 1600,
    });

    // Extract code from response
    return this.extractCode(response.content);
  }

  /**
   * Generate modified file content
   */
  private async generateModifiedFile(
    edit: FileEditPlan,
    originalContent: string
  ): Promise<string> {
    if (!this.provider) {
      return originalContent;
    }

    const systemPrompt = `You are an expert code editor. Modify code according to instructions.

## Rules
1. Preserve existing code structure
2. Only make requested changes
3. Maintain code style consistency
4. Keep imports organized

## Output
Return the COMPLETE modified file, not just the changes.`;

    const contextPrompt = this.buildContextPrompt(edit, {
      heading: '## Context Code',
      maxChunks: 3,
      maxCharsPerChunk: 350,
    });

    const userPrompt = `## File
${edit.path}

## Current Content
\`\`\`
${originalContent}
\`\`\`

## Modification Instructions
${edit.instructions}
${contextPrompt}

Return the complete modified file.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.provider.complete(messages, {
      temperature: 0.2,
      maxTokens: this.getModifyFileMaxTokens(originalContent),
    });

    return this.extractCode(response.content);
  }

  private buildContextPrompt(
    edit: FileEditPlan,
    options: {
      heading: string;
      maxChunks: number;
      maxCharsPerChunk: number;
    },
  ): string {
    if (edit.contextChunks.length === 0) {
      return '';
    }

    const chunks = edit.contextChunks
      .slice(0, options.maxChunks)
      .map(chunk => `### ${chunk.path}\n\`\`\`\n${chunk.content.slice(0, options.maxCharsPerChunk)}\n\`\`\``)
      .join('\n\n');

    return `\n${options.heading}\n${chunks}`;
  }

  private getModifyFileMaxTokens(originalContent: string): number {
    const estimatedOutputTokens = Math.ceil(originalContent.length / 4) + 400;
    return Math.min(3200, Math.max(1200, estimatedOutputTokens));
  }

  /**
   * Extract code from LLM response
   */
  private extractCode(content: string): string {
    // Try to extract code block
    const codeMatch = content.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeMatch) {
      return codeMatch[1].trim();
    }

    // No code block, return as-is
    return content.trim();
  }

  /**
   * Generate unified diff
   */
  private generateUnifiedDiff(
    path: string,
    original: string,
    target: string
  ): string {
    const originalLines = original.split('\n');
    const targetLines = target.split('\n');

    // Simple diff generation
    // For production, use a proper diff library like 'diff'
    const diff: string[] = [];

    // Detect delete operation (target is empty, original has content)
    const isDelete = original.length > 0 && target.length === 0;

    if (isDelete) {
      // Proper git-format delete diff header
      diff.push(`deleted file mode 100644`);
      diff.push(`--- a/${path}`);
      diff.push(`+++ /dev/null`);

      // All original lines are removed
      const lines = originalLines.length;
      if (lines > 0) {
        diff.push(`@@ -1,${lines} +0,0 @@`);
        for (const line of originalLines) {
          diff.push(`-${line}`);
        }
      }
    } else {
      // Header for create/modify
      diff.push(`--- a/${path}`);
      diff.push(`+++ b/${path}`);

      // Find changes using simple LCS approximation
      const changes = this.computeDiff(originalLines, targetLines);

      for (const change of changes) {
        diff.push(`@@ -${change.oldStart},${change.oldCount} +${change.newStart},${change.newCount} @@`);

        for (const line of change.removed) {
          diff.push(`-${line}`);
        }
        for (const line of change.added) {
          diff.push(`+${line}`);
        }
        for (const line of change.context) {
          diff.push(` ${line}`);
        }
      }
    }

    return diff.join('\n');
  }

  /**
   * Compute diff between two arrays of lines
   */
  private computeDiff(
    oldLines: string[],
    newLines: string[]
  ): Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    removed: string[];
    added: string[];
    context: string[];
  }> {
    const changes: Array<{
      oldStart: number;
      oldCount: number;
      newStart: number;
      newCount: number;
      removed: string[];
      added: string[];
      context: string[];
    }> = [];

    // Simple line-by-line comparison
    // This is a simplified diff - production would use Myers diff algorithm
    let oldIdx = 0;
    let newIdx = 0;
    let changeStart = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      const oldLine = oldLines[oldIdx];
      const newLine = newLines[newIdx];

      if (oldLine === newLine) {
        // Lines match, advance both
        oldIdx++;
        newIdx++;
      } else {
        // Found a difference
        const oldStart = oldIdx + 1;
        const newStart = newIdx + 1;

        const removed: string[] = [];
        const added: string[] = [];

        // Collect removed lines
        while (oldIdx < oldLines.length && oldLines[oldIdx] !== newLine) {
          removed.push(oldLines[oldIdx]);
          oldIdx++;
        }

        // Collect added lines
        while (newIdx < newLines.length && newLines[newIdx] !== oldLine) {
          added.push(newLines[newIdx]);
          newIdx++;
        }

        // Add context (surrounding lines)
        const context: string[] = [];
        const contextSize = 3;
        for (let i = Math.max(0, oldIdx - contextSize); i < oldIdx; i++) {
          context.push(oldLines[i]);
        }

        if (removed.length > 0 || added.length > 0) {
          changes.push({
            oldStart,
            oldCount: removed.length || 1,
            newStart,
            newCount: added.length || 1,
            removed,
            added,
            context,
          });
        }
      }
    }

    // If no changes but files differ, return full file replacement
    if (changes.length === 0 && oldLines.length !== newLines.length) {
      changes.push({
        oldStart: 1,
        oldCount: oldLines.length,
        newStart: 1,
        newCount: newLines.length,
        removed: oldLines,
        added: newLines,
        context: [],
      });
    }

    return changes;
  }

  /**
   * Count added and removed lines in patch
   */
  private countChanges(patch: string): { added: number; removed: number } {
    const lines = patch.split('\n');
    let added = 0;
    let removed = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        added++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removed++;
      }
    }

    return { added, removed };
  }

  /**
   * Generate patch ID
   */
  private generatePatchId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`patch-${Date.now()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultBuilder: PatchBuilder | null = null;

/**
 * Get default patch builder
 */
export function getPatchBuilder(): PatchBuilder {
  if (!defaultBuilder) {
    defaultBuilder = new PatchBuilder();
  }
  return defaultBuilder;
}

/**
 * Create patch builder
 */
export function createPatchBuilder(options?: {
  provider?: LLMProvider;
  workspace?: WorkspaceFS;
  maxPatchLines?: number;
}): PatchBuilder {
  return new PatchBuilder(options);
}

/**
 * Build patches helper
 */
export async function buildPatches(editPlan: EditPlan): Promise<GeneratedPatch[]> {
  const builder = getPatchBuilder();
  return builder.build(editPlan);
}
