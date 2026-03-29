/**
 * Code Agent
 * 
 * Main orchestrator for AI coding operations.
 * Coordinates planning, editing, patch building, verification, and application.
 */

import * as crypto from 'crypto';
import {
  AgentResult,
  AgentConfig,
  AgentMetrics,
  AgentError,
  AgentProgressEvent,
  AgentStage,
  CodePlan,
  EditPlan,
  LLMProvider,
  LLMMessage,
  AGENT_DEFAULTS,
  AgentExecutionError,
} from './agent_types.js';
import { PlanGenerator, createPlanGenerator } from './plan_generator.js';
import { EditPlanner, createEditPlanner } from './edit_planner.js';
import { PatchBuilder, GeneratedPatch, createPatchBuilder } from './patch_builder.js';
import { VerificationEngine, createVerificationEngine } from './verification_engine.js';
import { ToolRouter, createToolRouter } from './tool_router.js';
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import { getContextBuilder } from '../context/project_context_builder.js';
import { getCodeIndex } from '../retrieval/code_index.js';
import { ProjectContext } from '../context/context_types.js';
import { SearchResult } from '../retrieval/retrieval_types.js';

// Progress callback type
export type ProgressCallback = (event: AgentProgressEvent) => void;

/**
 * Code Agent
 */
export class CodeAgent {
  private config: Required<AgentConfig>;
  private workspace: WorkspaceFS | null = null;
  private planGenerator: PlanGenerator;
  private editPlanner: EditPlanner;
  private patchBuilder: PatchBuilder;
  private verificationEngine: VerificationEngine;
  private toolRouter: ToolRouter;
  private onProgress?: ProgressCallback;
  private agentId: string;

  constructor(options?: {
    config?: Partial<AgentConfig>;
    provider?: LLMProvider;
    workspace?: WorkspaceFS;
    onProgress?: ProgressCallback;
  }) {
    this.config = { ...AGENT_DEFAULTS, ...options?.config } as Required<AgentConfig>;

    // Initialize task-scoped components to avoid provider/workspace leakage
    this.planGenerator = createPlanGenerator({
      provider: options?.provider,
      maxIterations: this.config.maxIterations,
    });
    this.editPlanner = createEditPlanner({
      provider: options?.provider,
    });
    this.patchBuilder = createPatchBuilder({
      provider: options?.provider,
      workspace: options?.workspace,
      maxPatchLines: this.config.maxPatchLines,
    });
    this.verificationEngine = createVerificationEngine({
      workspace: options?.workspace,
      maxPatchLines: this.config.maxPatchLines,
    });
    this.toolRouter = createToolRouter(options?.workspace);

    // Set workspace if provided
    if (options?.workspace) {
      this.setWorkspace(options.workspace);
    }

    this.onProgress = options?.onProgress;
    this.agentId = this.generateAgentId();
  }

  /**
   * Set workspace
   */
  setWorkspace(workspace: WorkspaceFS): void {
    this.workspace = workspace;
    this.patchBuilder.setWorkspace(workspace);
    this.verificationEngine.setWorkspace(workspace);
    this.toolRouter.setWorkspace(workspace);
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.onProgress = callback;
  }

  /**
   * Run the agent with a prompt
   */
  async run(prompt: string): Promise<AgentResult> {
    const startTime = Date.now();
    const metrics: AgentMetrics = {
      totalSteps: 0,
      completedSteps: 0,
      filesRead: 0,
      filesModified: 0,
      patchesGenerated: 0,
      patchesApplied: 0,
      contextTokens: 0,
      executionTimeMs: 0,
      llmCalls: 0,
    };

    let plan: CodePlan | null = null;
    let editPlan: EditPlan | null = null;
    let patches: GeneratedPatch[] = [];

    try {
      // Stage 1: Initialize
      this.emitProgress('initializing', 0.05, 'Initializing agent...');

      if (!this.workspace) {
        throw new AgentExecutionError(
          'Workspace not configured',
          'initializing',
          'WORKSPACE_NOT_SET'
        );
      }

      // Stage 2: Build context
      this.emitProgress('building_context', 0.1, 'Building project context...');
      const context = await this.buildContext(prompt);
      metrics.contextTokens = context.relevantFiles.reduce(
        (sum, f) => sum + (f.content?.length || 0) / 4,
        0
      );

      // Stage 3: Search for relevant code
      this.emitProgress('searching', 0.2, 'Searching for relevant code...');
      const searchResults = await this.searchCode(prompt);

      // Stage 4: Generate plan
      this.emitProgress('planning', 0.3, 'Generating execution plan...');
      plan = await this.planGenerator.generate(prompt, context, searchResults);
      metrics.totalSteps = plan.steps.length;
      metrics.llmCalls++;

      // Stage 5: Plan edits
      this.emitProgress('editing', 0.5, 'Planning file edits...');
      editPlan = await this.editPlanner.plan(plan, context);
      metrics.llmCalls++;

      // Stage 6: Build patches
      this.emitProgress('building_patch', 0.7, 'Building patches...');
      patches = await this.patchBuilder.build(editPlan);
      metrics.patchesGenerated = patches.length;

      // Stage 7: Verify patches
      if (this.config.enableVerification) {
        this.emitProgress('verifying', 0.8, 'Verifying patches...');
        const verificationResult = await this.verificationEngine.verify(patches);

        if (!verificationResult.valid) {
          const errorMessages = verificationResult.errors.map(e => e.message).join('; ');
          throw new AgentExecutionError(
            `Verification failed: ${errorMessages}`,
            'verifying',
            'VERIFICATION_FAILED',
            true
          );
        }
      }

      // Stage 8: Apply patches
      this.emitProgress('applying', 0.9, 'Applying patches...');
      const applyResults = await this.applyPatches(patches);
      metrics.patchesApplied = applyResults.filter(r => r.success).length;
      metrics.filesModified = new Set(patches.map(p => p.path)).size;

      // Stage 9: Complete
      this.emitProgress('completed', 1.0, 'Task completed successfully');
      metrics.completedSteps = plan.steps.length;

      return {
        success: true,
        plan,
        patches: patches.map(p => p.patch),
        filesChanged: patches.map(p => p.path),
        summary: this.generateSummary(plan, patches),
        metrics: {
          ...metrics,
          executionTimeMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      const agentError = error instanceof AgentExecutionError
        ? error
        : new AgentExecutionError(
            error instanceof Error ? error.message : 'Unknown error',
            'failed',
            'EXECUTION_ERROR',
            false
          );

      this.emitProgress('failed', 0, agentError.message);

      return {
        success: false,
        plan: plan!,
        patches: patches.map(p => p.patch),
        filesChanged: [],
        summary: `Failed: ${agentError.message}`,
        metrics: {
          ...metrics,
          executionTimeMs: Date.now() - startTime,
        },
        error: {
          stage: agentError.stage,
          message: agentError.message,
          recoverable: agentError.recoverable,
        },
      };
    }
  }

  /**
   * Run agent with streaming progress
   */
  async *runStream(prompt: string): AsyncGenerator<AgentProgressEvent, AgentResult, unknown> {
    const startTime = Date.now();
    const metrics: AgentMetrics = this.createEmptyMetrics();

    let plan: CodePlan | null = null;
    let editPlan: EditPlan | null = null;
    let patches: GeneratedPatch[] = [];

    try {
      // Initialize
      yield this.createProgressEvent('initializing', 0.05, 'Initializing...');

      if (!this.workspace) {
        throw new AgentExecutionError('Workspace not configured', 'initializing', 'WORKSPACE_NOT_SET');
      }

      // Build context
      yield this.createProgressEvent('building_context', 0.1, 'Building context...');
      const context = await this.buildContext(prompt);

      // Search
      yield this.createProgressEvent('searching', 0.2, 'Searching...');
      const searchResults = await this.searchCode(prompt);

      // Plan
      yield this.createProgressEvent('planning', 0.3, 'Planning...');
      plan = await this.planGenerator.generate(prompt, context, searchResults);
      metrics.llmCalls++;

      // Edit
      yield this.createProgressEvent('editing', 0.5, 'Planning edits...');
      editPlan = await this.editPlanner.plan(plan, context);
      metrics.llmCalls++;

      // Build patches
      yield this.createProgressEvent('building_patch', 0.7, 'Building patches...');
      patches = await this.patchBuilder.build(editPlan);
      metrics.patchesGenerated = patches.length;

      // Verify
      if (this.config.enableVerification) {
        yield this.createProgressEvent('verifying', 0.8, 'Verifying...');
        await this.verificationEngine.verify(patches);
      }

      // Apply
      yield this.createProgressEvent('applying', 0.9, 'Applying...');
      await this.applyPatches(patches);

      // Complete
      yield this.createProgressEvent('completed', 1.0, 'Completed');

      return {
        success: true,
        plan,
        patches: patches.map(p => p.patch),
        filesChanged: patches.map(p => p.path),
        summary: this.generateSummary(plan, patches),
        metrics: { ...metrics, executionTimeMs: Date.now() - startTime },
      };
    } catch (error) {
      yield this.createProgressEvent('failed', 0, error instanceof Error ? error.message : 'Unknown error');

      return {
        success: false,
        plan: plan!,
        patches: patches.map(p => p.patch),
        filesChanged: [],
        summary: 'Failed',
        metrics: { ...metrics, executionTimeMs: Date.now() - startTime },
        error: {
          stage: 'failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          recoverable: false,
        },
      };
    }
  }

  /**
   * Build project context
   */
  private async buildContext(prompt: string): Promise<ProjectContext> {
    if (!this.workspace) {
      throw new AgentExecutionError('Workspace not configured', 'building_context', 'NO_WORKSPACE');
    }

    const builder = getContextBuilder();
    const result = await builder.buildContext(this.workspace, {
      userPrompt: prompt,
      maxTokens: this.config.contextMaxTokens,
    });

    if (!result.success || !result.context) {
      throw new AgentExecutionError(
        result.error?.message || 'Failed to build context',
        'building_context',
        'CONTEXT_BUILD_FAILED'
      );
    }

    return result.context;
  }

  /**
   * Search for relevant code
   */
  private async searchCode(prompt: string): Promise<SearchResult[]> {
    try {
      const codeIndex = getCodeIndex();
      return codeIndex.search(prompt, {
        mode: 'hybrid',
        maxResults: 10,
        minScore: 0.5,
      });
    } catch {
      return [];
    }
  }

  /**
   * Apply patches to workspace
   */
  private async applyPatches(patches: GeneratedPatch[]): Promise<Array<{ success: boolean; path: string }>> {
    const results: Array<{ success: boolean; path: string }> = [];

    for (const patch of patches) {
      try {
        if (!this.workspace) {
          throw new Error('No workspace');
        }

        // Check if this is a delete operation (original has content, target is empty)
        const isDelete = patch.originalContent && patch.originalContent.length > 0
          && (!patch.targetContent || patch.targetContent.length === 0);

        // Check if file would be created
        const isNewFile = !patch.originalContent || patch.originalContent.length === 0;

        // Apply via workspace. We already have full target content, so direct writes
        // are faster and more reliable than replaying generated diffs.
        if (isDelete) {
          await this.workspace.deleteFile(patch.path);
        } else {
          await this.workspace.writeFile(patch.path, patch.targetContent, {
            createDirectories: isNewFile,
            overwrite: true,
          });
        }

        results.push({ success: true, path: patch.path });
      } catch (error) {
        results.push({ success: false, path: patch.path });
      }
    }

    return results;
  }

  /**
   * Generate summary of changes
   */
  private generateSummary(plan: CodePlan, patches: GeneratedPatch[]): string {
    const lines: string[] = [];

    lines.push(`## Task: ${plan.goal}`);
    lines.push('');
    lines.push('### Changes Made');
    lines.push('');

    for (const patch of patches) {
      lines.push(`- **${patch.path}**: +${patch.linesAdded} -${patch.linesRemoved} lines`);
    }

    lines.push('');
    lines.push(`### Summary`);
    lines.push(`Executed ${plan.steps.length} steps across ${patches.length} files.`);

    return lines.join('\n');
  }

  /**
   * Emit progress event
   */
  private emitProgress(
    stage: AgentStage,
    progress: number,
    message: string
  ): void {
    if (this.onProgress) {
      this.onProgress({
        agentId: this.agentId,
        stage,
        progress,
        message,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Create progress event
   */
  private createProgressEvent(
    stage: AgentStage,
    progress: number,
    message: string
  ): AgentProgressEvent {
    return {
      agentId: this.agentId,
      stage,
      progress,
      message,
      timestamp: new Date(),
    };
  }

  /**
   * Create empty metrics
   */
  private createEmptyMetrics(): AgentMetrics {
    return {
      totalSteps: 0,
      completedSteps: 0,
      filesRead: 0,
      filesModified: 0,
      patchesGenerated: 0,
      patchesApplied: 0,
      contextTokens: 0,
      executionTimeMs: 0,
      llmCalls: 0,
    };
  }

  /**
   * Generate agent ID
   */
  private generateAgentId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`agent-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }

  /**
   * Get agent ID
   */
  getId(): string {
    return this.agentId;
  }

  /**
   * Get configuration
   */
  getConfig(): Required<AgentConfig> {
    return this.config;
  }
}

// Singleton instance
let defaultAgent: CodeAgent | null = null;

/**
 * Get default code agent
 */
export function getCodeAgent(): CodeAgent {
  if (!defaultAgent) {
    defaultAgent = new CodeAgent();
  }
  return defaultAgent;
}

/**
 * Create code agent
 */
export function createCodeAgent(options?: {
  config?: Partial<AgentConfig>;
  provider?: LLMProvider;
  workspace?: WorkspaceFS;
  onProgress?: ProgressCallback;
}): CodeAgent {
  return new CodeAgent(options);
}

/**
 * Run agent helper
 */
export async function runAgent(
  prompt: string,
  workspace: WorkspaceFS,
  options?: {
    config?: Partial<AgentConfig>;
    provider?: LLMProvider;
    onProgress?: ProgressCallback;
  }
): Promise<AgentResult> {
  const agent = createCodeAgent({
    ...options,
    workspace,
  });
  return agent.run(prompt);
}
