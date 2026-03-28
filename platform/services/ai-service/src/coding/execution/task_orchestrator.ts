/**
 * Task Orchestrator
 * 
 * Orchestrates coding tasks with timeout enforcement, retries,
 * progress streaming, and integration with the workflow engine.
 */

import {
  CodingTaskRequest,
  CodingTaskResult,
  CodingTaskOptions,
  TaskStatus,
  TaskError,
  TaskMetrics,
  TaskProgressEvent,
  TaskOrchestratorConfig,
  TASK_ORCHESTRATOR_DEFAULTS,
  TASK_ERRORS,
  TaskExecutionError,
} from './execution_types.js';
import type { TaskModeDecision } from './execution_types.js';
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import { createCodeAgent } from '../agent/code_agent.js';
import type { CodeAgent, ProgressCallback } from '../agent/code_agent.js';
import { DirectAgent } from '../agent/direct_agent.js';
import { GatewayLLMProvider } from '../agent/llm_adapter.js';
import { getModeRouter } from '../agent/mode_router.js';
import type { AgentMode } from '../agent/mode_router.js';
import { ToolRouter } from '../agent/tool_router.js';
import { RollbackManager, getRollbackManager } from './rollback_manager.js';
import { PatchSandbox, getPatchSandbox } from './patch_sandbox.js';
import { GeneratedPatch } from '../agent/patch_builder.js';
import { callPythonAgent } from '../../python_agents/client.js';

// Active task tracking
interface ActiveTask {
  request: CodingTaskRequest;
  status: TaskStatus;
  startTime: Date;
  snapshotId?: string;
  abortController: AbortController;
}

/**
 * Task Orchestrator
 */
export class TaskOrchestrator {
  private config: Required<TaskOrchestratorConfig>;
  private activeTasks: Map<string, ActiveTask> = new Map();
  private rollbackManager: RollbackManager;
  private sandbox: PatchSandbox;
  private workspaces: Map<string, WorkspaceFS> = new Map();

  constructor(config?: Partial<TaskOrchestratorConfig>) {
    this.config = { ...TASK_ORCHESTRATOR_DEFAULTS, ...config } as Required<TaskOrchestratorConfig>;
    this.rollbackManager = getRollbackManager();
    this.sandbox = getPatchSandbox();
  }

  /**
   * Register a workspace
   */
  registerWorkspace(workspaceId: string, workspace: WorkspaceFS): void {
    this.workspaces.set(workspaceId, workspace);
  }

  /**
   * Unregister a workspace
   */
  unregisterWorkspace(workspaceId: string): void {
    this.workspaces.delete(workspaceId);
  }

  /**
   * Run a coding task
   */
  async runTask(request: CodingTaskRequest): Promise<CodingTaskResult> {
    const startTime = Date.now();
    const metrics: TaskMetrics = this.createEmptyMetrics();

    // Get workspace
    const workspace = this.workspaces.get(request.workspaceId);
    if (!workspace) {
      return this.createErrorResult(
        request,
        TASK_ERRORS.WORKSPACE_NOT_FOUND,
        `Workspace not found: ${request.workspaceId}`,
        'planning',
        metrics,
        startTime
      );
    }

    // Create abort controller
    const abortController = new AbortController();

    // Track active task
    const activeTask: ActiveTask = {
      request,
      status: 'pending',
      startTime: new Date(),
      abortController,
    };
    this.activeTasks.set(request.id, activeTask);

    // Merge options with defaults
    const options: Required<CodingTaskOptions> = {
      timeoutMs: request.options?.timeoutMs ?? this.config.defaultTimeoutMs,
      maxRetries: request.options?.maxRetries ?? this.config.maxRetries,
      enableRollback: request.options?.enableRollback ?? this.config.enableRollback,
      enableSandbox: request.options?.enableSandbox ?? this.config.enableSandbox,
      sandboxChecks: request.options?.sandboxChecks ?? ['syntax', 'typecheck', 'lint'],
      maxFilesModified: request.options?.maxFilesModified ?? 10,
      dryRun: request.options?.dryRun ?? false,
      streamProgress: request.options?.streamProgress ?? true,
    };

    let snapshotId: string | undefined;
    let agentResult: Awaited<ReturnType<CodeAgent['run']>> | undefined;
    let sandboxResult: Awaited<ReturnType<PatchSandbox['validatePatches']>> | undefined;
    let rollbackPerformed = false;
    let modeUsed: AgentMode = 'direct';
    let modeDecision: TaskModeDecision | undefined;

    try {
      // ========================================
      // Stage 1: Mode routing (config-driven)
      // ========================================
      activeTask.status = 'running';
      this.emitProgress(request.id, 'running', 0.1, 'Analyzing task...');

      const modeRouter = getModeRouter();
      const routingToolRouter = new ToolRouter(workspace);
      const decision = await modeRouter.decide(request.prompt, {
        userSelectedMode: request.mode,
        taskComplexity: request.routing?.complexity,
        toolIntent: request.routing?.toolIntent,
        availableTools: routingToolRouter.getToolNames(),
        activeFile: request.workspaceContext?.activeFile ?? null,
        openTabs: request.workspaceContext?.openTabs,
        contextFiles: request.routing?.contextFiles,
      });
      modeUsed = decision.mode;
      modeDecision = decision;

      // Override model config with user's selection if provided
      if (request.modelHint) {
        const [provider] = request.modelHint.split('/');
        if (provider) {
          // Keep the full hint so the gateway/router can re-parse it correctly
          decision.modelConfig = { provider, model: request.modelHint };
          decision.reason = `user_selected_${provider}`;
        }
      }

      console.log(
        `[TaskOrchestrator] Mode decision: ${decision.mode} (${decision.reason}) complexity=${decision.complexity} ` +
        `model: ${decision.modelConfig.provider}/${decision.modelConfig.model} maxTurns: ${decision.maxTurns} ` +
        `tools=${decision.selectedTools.join(',')}`
      );
      this.emitProgress(request.id, 'running', 0.12,
        `Mode: ${decision.mode} (${decision.reason})`,
        undefined,
        {
          complexity: decision.complexity,
          selectedTools: decision.selectedTools,
          model: `${decision.modelConfig.provider}/${decision.modelConfig.model}`,
        },
        decision,
      );

      // ========================================
      // Stage 2: Create snapshot for rollback
      // ========================================
      if (options.enableRollback) {
        this.emitProgress(request.id, 'running', 0.15, 'Creating rollback snapshot...');
        snapshotId = await this.rollbackManager.createSnapshot(
          workspace,
          request.id,
          `Before task: ${request.prompt.slice(0, 50)}`
        );
        activeTask.snapshotId = snapshotId;
      }

      // ========================================
      // Stage 3: Run agent (mode-specific)
      // ========================================
      const agentStartTime = Date.now();

      if (decision.mode === 'multi_agent') {
        // Mode 3: Delegate to Python LangGraph agents
        this.emitProgress(request.id, 'running', 0.2, 'Running multi-agent pipeline...');

        try {
          const pythonResult = await callPythonAgent({
            user_prompt: request.prompt,
            project_id: request.metadata?.projectId as string || request.workspaceId,
          });

          agentResult = {
            success: pythonResult.status === 'completed',
            plan: null as any,
            patches: [],
            filesChanged: Object.keys(pythonResult.result?.backend_output?.create_files || {})
              .concat(Object.keys(pythonResult.result?.frontend_output?.create_files || {})),
            summary: pythonResult.result?.architect_output?.architecture_description
              || 'Multi-agent task completed',
            metrics: {
              totalSteps: 0,
              completedSteps: 0,
              filesRead: 0,
              filesModified: 0,
              patchesGenerated: 0,
              patchesApplied: 0,
              contextTokens: 0,
              executionTimeMs: Date.now() - agentStartTime,
              llmCalls: 0,
            },
            error: pythonResult.errors?.length ? {
              stage: 'failed' as const,
              message: pythonResult.errors.join('; '),
              recoverable: true,
            } : undefined,
          };
        } catch (pythonError) {
          // Python agents unavailable — check admin fallback config
          const { getConfigService } = await import('../../config/config_service.js');
          const configService = getConfigService();
          const fallback = await configService.getConfig<string>('ai.mode3.fallback', 'mode2');

          if (fallback === 'mode2') {
            this.emitProgress(request.id, 'running', 0.2,
              'Python agents unavailable, falling back to Plan & Execute mode...');

            const progressCallback: ProgressCallback = (event) => {
              if (options.streamProgress) {
                this.emitProgress(request.id, 'running', 0.2 + event.progress * 0.5, event.message, event);
              }
            };

            const agent = createCodeAgent({
              workspace,
              onProgress: progressCallback,
              provider: new GatewayLLMProvider(decision.modelConfig.model),
            });
            const timeoutGuard = this.createTimeoutGuard(options.timeoutMs, abortController);
            try {
              agentResult = await Promise.race([agent.run(request.prompt), timeoutGuard.promise]);
            } finally {
              timeoutGuard.cancel();
            }
          } else {
            // Admin chose to return error
            throw new TaskExecutionError(
              `AI agents service unavailable: ${pythonError instanceof Error ? pythonError.message : 'Unknown error'}`,
              TASK_ERRORS.EXECUTION_FAILED,
              'execution',
              true
            );
          }
        }
      } else if (decision.mode === 'direct') {
        // Mode 1: Direct tool-calling loop (simple tasks)
        this.emitProgress(request.id, 'running', 0.2, 'Running direct chat...');

        const progressCallback = (event: any) => {
          if (options.streamProgress) {
            this.emitProgress(request.id, 'running', 0.2 + event.progress * 0.5, event.message, event);
          }
        };

        const directAgent = new DirectAgent({
          workspace,
          onProgress: progressCallback,
          maxTurns: decision.maxTurns,
          abortSignal: abortController.signal,
          workspaceContext: request.workspaceContext,
        });

        const timeoutGuard = this.createTimeoutGuard(options.timeoutMs, abortController);
        try {
          agentResult = await Promise.race([
            directAgent.run(request.prompt, decision.modelConfig),
            timeoutGuard.promise,
          ]);
        } finally {
          timeoutGuard.cancel();
        }
      } else {
        // Mode 2: Plan & Execute pipeline (complex tasks)
        this.emitProgress(request.id, 'running', 0.2, 'Running AI agent pipeline...');

        const progressCallback: ProgressCallback = (event) => {
          if (options.streamProgress) {
            this.emitProgress(request.id, 'running', 0.2 + event.progress * 0.5, event.message, event);
          }
        };

        const agent = createCodeAgent({
          workspace,
          onProgress: progressCallback,
          provider: new GatewayLLMProvider(decision.modelConfig.model),
        });

        const timeoutGuard = this.createTimeoutGuard(options.timeoutMs, abortController);
        try {
          agentResult = await Promise.race([
            agent.run(request.prompt),
            timeoutGuard.promise,
          ]);
        } finally {
          timeoutGuard.cancel();
        }
      }

      metrics.executionMs = Date.now() - agentStartTime;

      if (!agentResult.success) {
        throw new TaskExecutionError(
          agentResult.error?.message ?? 'Agent execution failed',
          TASK_ERRORS.EXECUTION_FAILED,
          'execution',
          agentResult.error?.recoverable ?? false
        );
      }

      // Stage 4: Sandbox validation
      if (options.enableSandbox && agentResult.patches.length > 0) {
        activeTask.status = 'validating';
        this.emitProgress(request.id, 'validating', 0.7, 'Validating patches...');

        const sandboxStartTime = Date.now();

        // Convert patches to GeneratedPatch format for sandbox
        const patches: GeneratedPatch[] = agentResult.filesChanged.map((path, i) => ({
          id: `patch-${i}`,
          editId: '',
          path,
          patch: agentResult!.patches[i] ?? '',
          originalContent: '',
          targetContent: '',
          linesAdded: 0,
          linesRemoved: 0,
        }));

        sandboxResult = await this.sandbox.validatePatches(workspace, patches);
        metrics.validationMs = Date.now() - sandboxStartTime;

        if (!sandboxResult.valid) {
          const errorMessages = sandboxResult.errors.map(e => e.message).join('; ');
          throw new TaskExecutionError(
            `Validation failed: ${errorMessages}`,
            TASK_ERRORS.SANDBOX_FAILED,
            'validation',
            true
          );
        }
      }

      // Stage 5: Apply patches (if not dry run)
      if (!options.dryRun && agentResult.patches.length > 0) {
        activeTask.status = 'applying';
        this.emitProgress(request.id, 'applying', 0.9, 'Applying patches...');

        const applyStartTime = Date.now();

        for (const patch of agentResult.patches) {
          try {
            await workspace.applyPatch(patch);
          } catch (error) {
            throw new TaskExecutionError(
              `Failed to apply patch: ${error instanceof Error ? error.message : 'Unknown error'}`,
              TASK_ERRORS.APPLICATION_FAILED,
              'application',
              false
            );
          }
        }

        metrics.applicationMs = Date.now() - applyStartTime;
      }

      // Stage 6: Complete
      activeTask.status = 'completed';
      this.emitProgress(request.id, 'completed', 1.0, 'Task completed successfully');

      metrics.filesModified = agentResult.filesChanged.length;
      metrics.linesAdded = agentResult.metrics.filesModified ?? 0;
      metrics.linesRemoved = 0;

      return {
        taskId: request.id,
        success: true,
        status: 'completed',
        modeUsed,
        modeDecision,
        agentResult,
        sandboxResult,
        snapshotId,
        metrics: {
          ...metrics,
          totalDurationMs: Date.now() - startTime,
        },
        completedAt: new Date(),
      };
    } catch (error) {
      const taskError = error instanceof TaskExecutionError
        ? error
        : abortController.signal.aborted && abortController.signal.reason instanceof TaskExecutionError
          ? abortController.signal.reason
        : new TaskExecutionError(
            error instanceof Error ? error.message : 'Unknown error',
            TASK_ERRORS.EXECUTION_FAILED,
            'execution'
          );

      // Attempt rollback if enabled
      if (options.enableRollback && snapshotId) {
        this.emitProgress(request.id, 'failed', 0.95, 'Rolling back changes...');
        try {
          const rollbackResult = await this.rollbackManager.restoreSnapshot(workspace, snapshotId);
          rollbackPerformed = rollbackResult.success;
        } catch {
          // Rollback failed
        }
      }

      activeTask.status = taskError.code === TASK_ERRORS.TIMEOUT
        ? 'timeout'
        : taskError.code === TASK_ERRORS.CANCELLED
          ? 'cancelled'
          : rollbackPerformed
            ? 'rolled_back'
            : 'failed';
      this.emitProgress(request.id, activeTask.status, 0, taskError.message);

      return {
        taskId: request.id,
        success: false,
        status: activeTask.status,
        modeUsed,
        modeDecision,
        agentResult,
        snapshotId,
        rollbackPerformed,
        error: {
          code: taskError.code,
          message: taskError.message,
          stage: taskError.stage,
          recoverable: taskError.recoverable,
        },
        metrics: {
          ...metrics,
          totalDurationMs: Date.now() - startTime,
        },
        completedAt: new Date(),
      };
    } finally {
      this.activeTasks.delete(request.id);
    }
  }

  /**
   * Cancel a running task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const activeTask = this.activeTasks.get(taskId);
    if (!activeTask) {
      return false;
    }

    activeTask.abortController.abort(
      new TaskExecutionError('Task cancelled', TASK_ERRORS.CANCELLED, 'execution')
    );
    activeTask.status = 'cancelled';

    // Attempt rollback if snapshot exists
    if (activeTask.snapshotId) {
      const workspace = this.workspaces.get(activeTask.request.workspaceId);
      if (workspace) {
        try {
          await this.rollbackManager.restoreSnapshot(workspace, activeTask.snapshotId);
        } catch {
          // Rollback failed
        }
      }
    }

    this.activeTasks.delete(taskId);
    return true;
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.activeTasks.get(taskId)?.status;
  }

  /**
   * Get active task count
   */
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Set progress callback
   */
  setProgressCallback(
    callback: (event: TaskProgressEvent) => void
  ): void {
    this.progressCallback = callback;
  }

  private progressCallback?: (event: TaskProgressEvent) => void;

  /**
   * Emit progress event
   */
  private emitProgress(
    taskId: string,
    status: TaskStatus,
    progress: number,
    message: string,
    agentProgress?: unknown,
    details?: Record<string, unknown>,
    modeDecision?: TaskModeDecision,
  ): void {
    if (this.progressCallback) {
      this.progressCallback({
        taskId,
        status,
        progress,
        stage: status,
        message,
        agentProgress: agentProgress as undefined,
        details,
        modeDecision,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Create empty metrics
   */
  private createEmptyMetrics(): TaskMetrics {
    return {
      totalDurationMs: 0,
      planningMs: 0,
      executionMs: 0,
      validationMs: 0,
      applicationMs: 0,
      retries: 0,
      filesModified: 0,
      linesAdded: 0,
      linesRemoved: 0,
    };
  }

  /**
   * Create a timeout promise
   */
  private createTimeoutGuard(timeoutMs: number, abortController?: AbortController): {
    promise: Promise<never>;
    cancel: () => void;
  } {
    let timeoutId: NodeJS.Timeout | undefined;

    return {
      promise: new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new TaskExecutionError('Task timeout', TASK_ERRORS.TIMEOUT, 'execution', true);
          abortController?.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      }),
      cancel: () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      },
    };
  }

  /**
   * Create error result
   */
  private createErrorResult(
    request: CodingTaskRequest,
    code: string,
    message: string,
    stage: TaskError['stage'],
    metrics: TaskMetrics,
    startTime: number
  ): CodingTaskResult {
    return {
      taskId: request.id,
      success: false,
      status: 'failed',
      error: {
        code,
        message,
        stage,
        recoverable: false,
      },
      metrics: {
        ...metrics,
        totalDurationMs: Date.now() - startTime,
      },
      completedAt: new Date(),
    };
  }
}

// Singleton instance
let defaultOrchestrator: TaskOrchestrator | null = null;

/**
 * Get default task orchestrator
 */
export function getTaskOrchestrator(): TaskOrchestrator {
  if (!defaultOrchestrator) {
    defaultOrchestrator = new TaskOrchestrator();
  }
  return defaultOrchestrator;
}

/**
 * Create task orchestrator
 */
export function createTaskOrchestrator(
  config?: Partial<TaskOrchestratorConfig>
): TaskOrchestrator {
  return new TaskOrchestrator(config);
}

/**
 * Run task helper
 */
export async function runCodingTask(
  request: CodingTaskRequest,
  workspace: WorkspaceFS
): Promise<CodingTaskResult> {
  const orchestrator = getTaskOrchestrator();
  orchestrator.registerWorkspace(request.workspaceId, workspace);
  return orchestrator.runTask(request);
}
