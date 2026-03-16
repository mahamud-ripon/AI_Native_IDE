/**
 * Task Orchestrator
 * 
 * Orchestrates coding tasks with timeout enforcement, retries,
 * progress streaming, and integration with the workflow engine.
 */

import * as crypto from 'crypto';
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
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import { CodeAgent, createCodeAgent, ProgressCallback } from '../agent/code_agent.js';
import { RollbackManager, getRollbackManager } from './rollback_manager.js';
import { PatchSandbox, getPatchSandbox } from './patch_sandbox.js';
import { GeneratedPatch } from '../agent/patch_builder.js';

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

    try {
      // Stage 1: Planning
      activeTask.status = 'running';
      this.emitProgress(request.id, 'running', 0.1, 'Starting task...');

      // Stage 2: Create snapshot for rollback
      if (options.enableRollback) {
        this.emitProgress(request.id, 'running', 0.15, 'Creating rollback snapshot...');
        snapshotId = await this.rollbackManager.createSnapshot(
          workspace,
          request.id,
          `Before task: ${request.prompt.slice(0, 50)}`
        );
        activeTask.snapshotId = snapshotId;
      }

      // Stage 3: Run agent
      this.emitProgress(request.id, 'running', 0.2, 'Running AI agent...');
      const agentStartTime = Date.now();

      const progressCallback: ProgressCallback = (event) => {
        if (options.streamProgress) {
          this.emitProgress(request.id, 'running', 0.2 + event.progress * 0.5, event.message, event);
        }
      };

      const agent = createCodeAgent({
        workspace,
        onProgress: progressCallback,
      });

      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TaskExecutionError('Task timeout', TASK_ERRORS.TIMEOUT, 'execution'));
        }, options.timeoutMs);
      });

      // Run agent with timeout
      agentResult = await Promise.race([
        agent.run(request.prompt),
        timeoutPromise,
      ]);

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

      activeTask.status = rollbackPerformed ? 'rolled_back' : 'failed';
      this.emitProgress(request.id, activeTask.status, 0, taskError.message);

      return {
        taskId: request.id,
        success: false,
        status: activeTask.status,
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

    activeTask.abortController.abort();
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
    agentProgress?: unknown
  ): void {
    if (this.progressCallback) {
      this.progressCallback({
        taskId,
        status,
        progress,
        stage: status,
        message,
        agentProgress: agentProgress as undefined,
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
