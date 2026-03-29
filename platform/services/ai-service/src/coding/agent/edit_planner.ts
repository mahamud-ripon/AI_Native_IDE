/**
 * Edit Planner
 * 
 * Transforms execution plans into precise file edit instructions.
 * Uses code retrieval to gather context for each edit.
 */

import * as crypto from 'crypto';
import {
  CodePlan,
  PlanStep,
  FileEditPlan,
  EditPlan,
  EditOperation,
  LLMMessage,
  LLMProvider,
} from './agent_types.js';
import { getLLMProvider } from './plan_generator.js';
import { ProjectContext } from '../context/context_types.js';
import { CodeChunk, SearchResult, SearchOptions } from '../retrieval/retrieval_types.js';
import { getCodeIndex } from '../retrieval/code_index.js';

/**
 * Edit Planner
 */
export class EditPlanner {
  private provider: LLMProvider | null;
  private codeIndex: ReturnType<typeof getCodeIndex>;

  constructor(options?: { provider?: LLMProvider }) {
    this.provider = options?.provider ?? getLLMProvider();
    this.codeIndex = getCodeIndex();
  }

  /**
   * Generate edit plans from code plan
   */
  async plan(
    plan: CodePlan,
    context: ProjectContext
  ): Promise<EditPlan> {
    const edits: FileEditPlan[] = [];
    const fileSteps = this.combineFileModificationSteps(plan.steps);

    // Process each step that involves file modification
    for (const step of fileSteps) {
      const edit = await this.planStepEdit(step, plan, context);
      if (edit) {
        edits.push(edit);
      }
    }

    // Validate and deduplicate edits
    const uniqueEdits = this.deduplicateEdits(edits);

    return {
      id: this.generateEditPlanId(),
      planId: plan.id,
      edits: uniqueEdits,
      createdAt: new Date(),
    };
  }

  /**
   * Plan edit for a single step
   */
  private async planStepEdit(
    step: PlanStep,
    plan: CodePlan,
    context: ProjectContext
  ): Promise<FileEditPlan | null> {
    if (!step.file) {
      return null;
    }

    // Determine operation type
    const operation = this.getOperationFromAction(step.action);

    // Gather context chunks for the file
    const contextChunks = await this.gatherContextChunks(step, plan, context, operation);

    // Get original content if modifying
    let originalContent: string | undefined;
    if (operation === 'modify' || operation === 'delete') {
      originalContent = await this.getFileContent(step.file, context);
    }

    // Generate edit instructions
    const instructions = await this.generateEditInstructions(
      step,
      plan,
      operation,
      contextChunks
    );

    return {
      id: this.generateFileEditId(step.file, step.step),
      path: step.file,
      operation,
      instructions,
      contextChunks,
      originalContent,
    };
  }

  /**
   * Gather context chunks for edit
   */
  private async gatherContextChunks(
    step: PlanStep,
    plan: CodePlan,
    context: ProjectContext,
    operation: EditOperation
  ): Promise<CodeChunk[]> {
    if (operation === 'delete') {
      return [];
    }

    const chunks: CodeChunk[] = [];

    // 1. Get chunks from relevant files in context
    const candidateFiles = operation === 'create'
      ? context.relevantFiles.slice(0, 2)
      : context.relevantFiles.filter(file => file.path === step.file).slice(0, 1);

    for (const file of candidateFiles) {
      const content = await this.getFileContent(file.path, context);
      if (content) {
        chunks.push({
          id: `context-${file.path}`,
          path: file.path,
          content: content.slice(0, 1200),
          type: 'block',
          name: file.path.split('/').pop() || file.path,
          startLine: 1,
          endLine: content.split('\n').length,
          language: context.language || 'unknown',
          embeddingStatus: 'pending',
          hash: '',
          metadata: { exports: [], imports: [], dependencies: [] },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    // 2. Search for related code when modifying existing files
    if (this.provider && operation === 'modify') {
      try {
        const searchOptions: SearchOptions = {
          mode: 'hybrid',
          maxResults: 5,
          minScore: 0.5,
        };

        const results = await this.codeIndex.search(
          `${step.description} ${plan.goal}`,
          searchOptions
        );

        for (const result of results) {
          if (result.chunk.path !== step.file) {
            chunks.push(result.chunk);
          }
        }
      } catch {
        // Search failed, continue without
      }
    }

    return chunks.slice(0, 10); // Limit context chunks
  }

  /**
   * Generate edit instructions using LLM
   */
  private async generateEditInstructions(
    step: PlanStep,
    plan: CodePlan,
    operation: EditOperation,
    contextChunks: CodeChunk[]
  ): Promise<string> {
    if (this.shouldUseDirectInstructions(step, operation)) {
      return step.description;
    }

    const provider = this.provider;
    if (!provider) {
      return step.description;
    }

    const systemPrompt = `You are an expert code editor. Generate precise edit instructions.

## Output Format
Provide clear, step-by-step instructions for the edit:
1. What to add/change/remove
2. Where in the file (line numbers or context markers)
3. Any imports or dependencies needed

Keep instructions concise and actionable.`;

    const userPrompt = `## Task
${step.description}

## Goal
${plan.goal}

## File
${step.file}

## Operation
${step.action}

## Context Code
${contextChunks
  .slice(0, 3)
  .map(c => `### ${c.path}:${c.startLine}-${c.endLine}\n\`\`\`\n${c.content.slice(0, 350)}\n\`\`\`\n`)
  .join('\n')}

Generate edit instructions for this file.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      const response = await provider.complete(messages, {
        temperature: 0.2,
        maxTokens: 700,
      });

      return response.content;
    } catch {
      return step.description;
    }
  }

  /**
   * Get file content from context or workspace
   */
  private async getFileContent(
    filePath: string,
    context: ProjectContext
  ): Promise<string | undefined> {
    // Check relevant files in context
    const relevantFile = context.relevantFiles.find(f => f.path === filePath);
    if (relevantFile?.content) {
      return relevantFile.content;
    }

    // Try to read from code index
    try {
      const chunks = this.codeIndex.getChunksByPath(filePath);
      if (chunks.length > 0) {
        return chunks.map(c => c.content).join('\n');
      }
    } catch {
      // Not indexed
    }

    return undefined;
  }

  /**
   * Check if step involves file modification
   */
  private isFileModificationStep(step: PlanStep): boolean {
    return ['create_file', 'modify_file', 'delete_file', 'rename_file'].includes(step.action);
  }

  /**
   * Collapse multiple plan steps that touch the same file into one edit-plan step.
   */
  private combineFileModificationSteps(steps: PlanStep[]): PlanStep[] {
    const combined = new Map<string, PlanStep>();
    const passthrough: PlanStep[] = [];

    for (const step of steps) {
      if (!this.isFileModificationStep(step)) {
        continue;
      }

      if (!step.file) {
        passthrough.push(step);
        continue;
      }

      const existing = combined.get(step.file);
      if (!existing) {
        combined.set(step.file, {
          ...step,
          dependencies: [...(step.dependencies ?? [])],
        });
        continue;
      }

      existing.action = this.mergeAction(existing.action, step.action);
      existing.step = Math.min(existing.step, step.step);
      existing.description = this.mergeDescriptions(existing.description, step.description);
      existing.dependencies = this.mergeDependencies(existing.dependencies, step.dependencies);
      existing.estimatedComplexity = this.mergeComplexity(
        existing.estimatedComplexity,
        step.estimatedComplexity,
      );
    }

    return [...combined.values(), ...passthrough].sort((a, b) => a.step - b.step);
  }

  private mergeAction(current: PlanStep['action'], incoming: PlanStep['action']): PlanStep['action'] {
    const priority: Record<PlanStep['action'], number> = {
      delete_file: 4,
      rename_file: 3,
      create_file: 2,
      modify_file: 1,
      search_code: 0,
      read_file: 0,
    };

    return priority[incoming] > priority[current] ? incoming : current;
  }

  private mergeDescriptions(current: string, incoming: string): string {
    const unique = Array.from(
      new Set(
        [current, incoming]
          .flatMap(description => description.split('\n'))
          .map(description => description.trim())
          .filter(Boolean),
      ),
    );

    if (unique.length <= 1) {
      return unique[0] ?? current;
    }

    return unique.map((description, index) => `${index + 1}. ${description}`).join('\n');
  }

  private mergeDependencies(
    current?: number[],
    incoming?: number[],
  ): number[] {
    return Array.from(new Set([...(current ?? []), ...(incoming ?? [])])).sort((a, b) => a - b);
  }

  private mergeComplexity(
    current?: PlanStep['estimatedComplexity'],
    incoming?: PlanStep['estimatedComplexity'],
  ): PlanStep['estimatedComplexity'] {
    const weight: Record<NonNullable<PlanStep['estimatedComplexity']>, number> = {
      low: 1,
      medium: 2,
      high: 3,
    };

    if (!current) {
      return incoming;
    }

    if (!incoming) {
      return current;
    }

    return weight[incoming] > weight[current] ? incoming : current;
  }

  private shouldUseDirectInstructions(step: PlanStep, operation: EditOperation): boolean {
    if (!this.provider) {
      return true;
    }

    if (operation === 'delete' || operation === 'rename') {
      return true;
    }

    if (operation === 'create') {
      return step.estimatedComplexity !== 'high';
    }

    return step.estimatedComplexity === 'low'
      && !step.description.includes('\n')
      && step.description.length <= 180;
  }

  /**
   * Get operation type from action
   */
  private getOperationFromAction(action: string): EditOperation {
    const mapping: Record<string, EditOperation> = {
      create_file: 'create',
      modify_file: 'modify',
      delete_file: 'delete',
      rename_file: 'rename',
    };
    return mapping[action] || 'modify';
  }

  /**
   * Deduplicate edits by path
   */
  private deduplicateEdits(edits: FileEditPlan[]): FileEditPlan[] {
    const byPath = new Map<string, FileEditPlan>();

    for (const edit of edits) {
      const existing = byPath.get(edit.path);
      if (!existing) {
        byPath.set(edit.path, edit);
      } else {
        // Merge instructions
        existing.instructions = `${existing.instructions}\n\n${edit.instructions}`;
        // Merge context chunks
        for (const chunk of edit.contextChunks) {
          if (!existing.contextChunks.find(c => c.id === chunk.id)) {
            existing.contextChunks.push(chunk);
          }
        }
      }
    }

    return Array.from(byPath.values());
  }

  /**
   * Generate edit plan ID
   */
  private generateEditPlanId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`edit-${Date.now()}`);
    return hash.digest('hex').slice(0, 12);
  }

  /**
   * Generate file edit ID
   */
  private generateFileEditId(path: string, step: number): string {
    const hash = crypto.createHash('md5');
    hash.update(`${path}-${step}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultPlanner: EditPlanner | null = null;

/**
 * Get default edit planner
 */
export function getEditPlanner(): EditPlanner {
  if (!defaultPlanner) {
    defaultPlanner = new EditPlanner();
  }
  return defaultPlanner;
}

/**
 * Create edit planner
 */
export function createEditPlanner(options?: { provider?: LLMProvider }): EditPlanner {
  return new EditPlanner(options);
}

/**
 * Plan edits helper
 */
export async function planEdits(
  plan: CodePlan,
  context: ProjectContext
): Promise<EditPlan> {
  const planner = getEditPlanner();
  return planner.plan(plan, context);
}
