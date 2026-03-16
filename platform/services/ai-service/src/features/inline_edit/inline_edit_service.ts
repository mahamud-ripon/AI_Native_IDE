/**
 * Inline Edit Service
 * 
 * Handles inline code editing operations on selected code ranges.
 */

import * as crypto from 'crypto';
import {
  InlineEditRequest,
  InlineEditResult,
  InlineEditOperation,
  InlineEditStatus,
  InlineEditConfig,
  InlineEditMetrics,
  CodeSelection,
  CodeDiff,
  DiffLine,
  EditPreview,
  EditHistoryEntry,
  INLINE_EDIT_DEFAULTS,
  OPERATION_PROMPTS,
} from './inline_edit_types.js';
import { WorkspaceFS } from '../../coding/workspace/workspace_fs.js';
import { LLMProvider, LLMMessage } from '../../coding/agent/agent_types.js';
import { getLLMProvider } from '../../coding/agent/plan_generator.js';
import { getTracer } from '../../observability/agent_tracing.js';
import { recordTokenUsage } from '../../observability/token_usage.js';

/**
 * Inline Edit Service
 */
export class InlineEditService {
  private config: Required<InlineEditConfig>;
  private provider: LLMProvider | null = null;
  private history: Map<string, EditHistoryEntry[]> = new Map();

  constructor(config?: Partial<InlineEditConfig>) {
    this.config = { ...INLINE_EDIT_DEFAULTS, ...config } as Required<InlineEditConfig>;
    this.provider = getLLMProvider();
  }

  /**
   * Set LLM provider
   */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  /**
   * Perform inline edit
   */
  async edit(request: InlineEditRequest, workspace?: WorkspaceFS): Promise<InlineEditResult> {
    const startTime = Date.now();
    const tracer = getTracer();

    // Start trace
    const traceId = tracer.startAgentTrace({
      agentId: 'inline-edit',
      workspaceId: request.workspaceId,
      userId: request.userId,
      prompt: request.instruction,
    });

    try {
      // Validate selection
      if (request.selection.content.split('\n').length > this.config.maxSelectionLines) {
        throw new Error(`Selection exceeds maximum lines (${this.config.maxSelectionLines})`);
      }

      // Build prompt
      const messages = this.buildEditPrompt(request);

      // Get LLM response
      if (!this.provider) {
        throw new Error('LLM provider not configured');
      }

      const response = await this.provider.complete(messages, {
        temperature: request.options?.temperature ?? 0.2,
        maxTokens: request.options?.maxTokens ?? 2000,
      });

      const tokensUsed = response.usage?.totalTokens ?? 0;

      // Parse response
      const { modifiedCode, explanation, patch } = this.parseEditResponse(
        response.content,
        request.selection
      );

      // Build diff
      const diff = this.buildDiff(request.selection.content, modifiedCode);

      // Determine status
      let status: InlineEditStatus = 'preview';
      if (request.options?.autoApply && workspace) {
        // Check confidence for auto-apply
        const confidence = this.estimateConfidence(modifiedCode, request.selection.content);
        if (confidence >= this.config.autoApplyThreshold) {
          status = 'applied';
          // Apply the edit
          await this.applyEdit(workspace, request.selection, modifiedCode);
        }
      }

      // Record LLM call
      tracer.recordLLMCall(traceId, {
        model: 'default',
        provider: 'default',
        promptTokens: tokensUsed,
        completionTokens: 0,
        totalTokens: tokensUsed,
        durationMs: Date.now() - startTime,
        success: true,
        cached: false,
      });

      // Record token usage
      recordTokenUsage({
        workspaceId: request.workspaceId,
        userId: request.userId,
        provider: 'default',
        model: 'default',
        promptTokens: tokensUsed,
        completionTokens: 0,
      });

      // Add to history
      this.addToHistory({
        id: this.generateId(),
        workspaceId: request.workspaceId,
        userId: request.userId,
        path: request.selection.path,
        operation: request.operation ?? this.config.defaultOperation,
        timestamp: new Date(),
        success: true,
        linesChanged: diff.additions.length + diff.deletions.length,
      });

      // End trace
      tracer.endAgentTrace(traceId, true);

      const metrics: InlineEditMetrics = {
        tokensUsed,
        latencyMs: Date.now() - startTime,
        linesAdded: diff.additions.length,
        linesRemoved: diff.deletions.length,
        linesUnchanged: diff.unchanged.length,
      };

      return {
        id: this.generateId(),
        requestId: request.id,
        success: true,
        status,
        originalCode: request.selection.content,
        modifiedCode,
        patch,
        diff,
        explanation,
        metrics,
      };
    } catch (error) {
      tracer.endAgentTrace(traceId, false, error instanceof Error ? error.message : 'Unknown error');

      return {
        id: this.generateId(),
        requestId: request.id,
        success: false,
        status: 'failed',
        originalCode: request.selection.content,
        modifiedCode: request.selection.content,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          tokensUsed: 0,
          latencyMs: Date.now() - startTime,
          linesAdded: 0,
          linesRemoved: 0,
          linesUnchanged: request.selection.content.split('\n').length,
        },
      };
    }
  }

  /**
   * Preview edit without applying
   */
  async preview(request: InlineEditRequest): Promise<EditPreview> {
    const result = await this.edit(request);

    return {
      id: this.generateId(),
      requestId: request.id,
      original: result.originalCode,
      modified: result.modifiedCode,
      diff: result.diff!,
      explanation: result.explanation ?? '',
      confidence: this.estimateConfidence(result.modifiedCode, result.originalCode),
      suggestions: this.generateSuggestions(result.modifiedCode),
    };
  }

  /**
   * Apply edit to workspace
   */
  async applyEdit(
    workspace: WorkspaceFS,
    selection: CodeSelection,
    modifiedCode: string
  ): Promise<void> {
    // Read current file
    const content = await workspace.readFile(selection.path);
    const lines = content.split('\n');

    // Replace selected lines
    const newLines = modifiedCode.split('\n');
    lines.splice(
      selection.startLine - 1,
      selection.endLine - selection.startLine + 1,
      ...newLines
    );

    // Write back
    await workspace.writeFile(selection.path, lines.join('\n'));
  }

  /**
   * Build edit prompt
   */
  private buildEditPrompt(request: InlineEditRequest): LLMMessage[] {
    const operation = request.operation ?? this.config.defaultOperation;
    const operationPrompt = OPERATION_PROMPTS[operation];

    const systemPrompt = `You are an expert code editor. ${operationPrompt}

## Rules
1. Only modify the selected code, nothing else
2. Preserve the existing code style and conventions
3. Return the modified code in a code block
4. Provide a brief explanation of changes
5. If the instruction is unclear, make reasonable assumptions

## Output Format
\`\`\`[language]
[modified code]
\`\`\`

**Explanation:** [brief explanation of changes]`;

    const userPrompt = `## File: ${request.selection.path}
## Language: ${request.selection.language}
## Lines: ${request.selection.startLine}-${request.selection.endLine}

### Selected Code
\`\`\`${request.selection.language}
${request.selection.content}
\`\`\`

### Instruction
${request.instruction}

Please modify the selected code according to the instruction.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Parse edit response from LLM
   */
  private parseEditResponse(
    response: string,
    selection: CodeSelection
  ): { modifiedCode: string; explanation: string; patch?: string } {
    // Extract code block
    const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
    const modifiedCode = codeMatch ? codeMatch[1].trim() : selection.content;

    // Extract explanation
    const explanationMatch = response.match(/\*\*Explanation:\*\*\s*(.+?)(?:\n\n|$)/i);
    const explanation = explanationMatch ? explanationMatch[1].trim() : '';

    // Generate unified diff
    const patch = this.generatePatch(selection.path, selection.content, modifiedCode);

    return { modifiedCode, explanation, patch };
  }

  /**
   * Build diff between original and modified
   */
  private buildDiff(original: string, modified: string): CodeDiff {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    const additions: DiffLine[] = [];
    const deletions: DiffLine[] = [];
    const unchanged: DiffLine[] = [];

    // Simple line-by-line diff
    const maxLen = Math.max(originalLines.length, modifiedLines.length);

    for (let i = 0; i < maxLen; i++) {
      const origLine = originalLines[i];
      const modLine = modifiedLines[i];

      if (origLine === undefined) {
        additions.push({ lineNumber: i + 1, content: modLine, type: 'add' });
      } else if (modLine === undefined) {
        deletions.push({ lineNumber: i + 1, content: origLine, type: 'remove' });
      } else if (origLine !== modLine) {
        deletions.push({ lineNumber: i + 1, content: origLine, type: 'remove' });
        additions.push({ lineNumber: i + 1, content: modLine, type: 'add' });
      } else {
        unchanged.push({ lineNumber: i + 1, content: origLine, type: 'context' });
      }
    }

    const summary = `+${additions.length} -${deletions.length} lines`;

    return { additions, deletions, unchanged, summary };
  }

  /**
   * Generate unified diff patch
   */
  private generatePatch(path: string, original: string, modified: string): string {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    const lines: string[] = [];
    lines.push(`--- a/${path}`);
    lines.push(`+++ b/${path}`);
    lines.push(`@@ -1,${originalLines.length} +1,${modifiedLines.length} @@`);

    // Simple diff output
    for (const line of originalLines) {
      lines.push(`-${line}`);
    }
    for (const line of modifiedLines) {
      lines.push(`+${line}`);
    }

    return lines.join('\n');
  }

  /**
   * Estimate confidence of edit
   */
  private estimateConfidence(modified: string, original: string): number {
    // Simple heuristic: more changes = lower confidence
    const originalLines = original.split('\n').length;
    const modifiedLines = modified.split('\n').length;

    const changeRatio = Math.abs(modifiedLines - originalLines) / Math.max(originalLines, 1);

    // Higher change ratio = lower confidence
    return Math.max(0.5, 1 - changeRatio * 0.5);
  }

  /**
   * Generate suggestions for improvement
   */
  private generateSuggestions(code: string): string[] {
    const suggestions: string[] = [];

    // Check for common issues
    if (!code.includes('//') && !code.includes('/*')) {
      suggestions.push('Consider adding comments for clarity');
    }

    if (code.includes('any') && code.includes('TypeScript')) {
      suggestions.push('Consider using more specific types instead of any');
    }

    if (code.split('\n').length > 20) {
      suggestions.push('Consider extracting into smaller functions');
    }

    return suggestions;
  }

  /**
   * Add entry to history
   */
  private addToHistory(entry: EditHistoryEntry): void {
    const key = `${entry.workspaceId}:${entry.path}`;
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }
    this.history.get(key)!.push(entry);
  }

  /**
   * Get edit history for file
   */
  getHistory(workspaceId: string, path?: string): EditHistoryEntry[] {
    if (path) {
      return this.history.get(`${workspaceId}:${path}`) ?? [];
    }

    // Return all history for workspace
    const entries: EditHistoryEntry[] = [];
    for (const [key, value] of this.history) {
      if (key.startsWith(workspaceId)) {
        entries.push(...value);
      }
    }
    return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`edit-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultService: InlineEditService | null = null;

/**
 * Get default inline edit service
 */
export function getInlineEditService(): InlineEditService {
  if (!defaultService) {
    defaultService = new InlineEditService();
  }
  return defaultService;
}

/**
 * Create inline edit service
 */
export function createInlineEditService(config?: Partial<InlineEditConfig>): InlineEditService {
  return new InlineEditService(config);
}

/**
 * Perform inline edit helper
 */
export async function performInlineEdit(
  request: InlineEditRequest,
  workspace?: WorkspaceFS
): Promise<InlineEditResult> {
  return getInlineEditService().edit(request, workspace);
}

/**
 * Preview inline edit helper
 */
export async function previewInlineEdit(request: InlineEditRequest): Promise<EditPreview> {
  return getInlineEditService().preview(request);
}
