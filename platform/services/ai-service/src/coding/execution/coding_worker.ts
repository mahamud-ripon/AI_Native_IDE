/**
 * Coding Worker
 * 
 * Integrates with the Workflow Engine to process coding tasks.
 * Acts as a worker that consumes coding jobs from the workflow system.
 */

import {
  CodingTaskRequest,
  CodingTaskResult,
  TaskProgressEvent,
  TaskOrchestratorConfig,
} from './execution_types.js';
import { TaskOrchestrator, getTaskOrchestrator } from './task_orchestrator.js';
import { WorkspaceFS } from '../workspace/workspace_fs.js';

// Workflow integration types (matching existing workflow engine)
interface WorkflowJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  createdAt: Date;
}

interface WorkflowResult {
  jobId: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

// Job type for coding tasks
export const CODING_JOB_TYPE = 'coding_task';

/**
 * Coding Worker
 * 
 * Processes coding jobs from the workflow engine.
 */
export class CodingWorker {
  private orchestrator: TaskOrchestrator;
  private workspaces: Map<string, WorkspaceFS> = new Map();
  private running: boolean = false;
  private onProgress?: (event: TaskProgressEvent) => void;

  constructor(options?: {
    orchestratorConfig?: Partial<TaskOrchestratorConfig>;
    onProgress?: (event: TaskProgressEvent) => void;
  }) {
    this.orchestrator = getTaskOrchestrator();
    this.onProgress = options?.onProgress;

    if (options?.onProgress) {
      this.orchestrator.setProgressCallback(options.onProgress);
    }
  }

  /**
   * Register a workspace
   */
  registerWorkspace(workspaceId: string, workspace: WorkspaceFS): void {
    this.workspaces.set(workspaceId, workspace);
    this.orchestrator.registerWorkspace(workspaceId, workspace);
  }

  /**
   * Unregister a workspace
   */
  unregisterWorkspace(workspaceId: string): void {
    this.workspaces.delete(workspaceId);
    this.orchestrator.unregisterWorkspace(workspaceId);
  }

  /**
   * Process a workflow job
   */
  async processJob(job: WorkflowJob): Promise<WorkflowResult> {
    const startTime = Date.now();

    // Validate job type
    if (job.type !== CODING_JOB_TYPE) {
      return {
        jobId: job.id,
        success: false,
        error: `Unknown job type: ${job.type}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Extract coding task request from payload
    const request = this.extractRequest(job);
    if (!request) {
      return {
        jobId: job.id,
        success: false,
        error: 'Invalid job payload',
        durationMs: Date.now() - startTime,
      };
    }

    // Check workspace exists
    const workspace = this.workspaces.get(request.workspaceId);
    if (!workspace) {
      return {
        jobId: job.id,
        success: false,
        error: `Workspace not found: ${request.workspaceId}`,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Run the coding task
      const result = await this.orchestrator.runTask(request);

      return {
        jobId: job.id,
        success: result.success,
        result: {
          taskId: result.taskId,
          status: result.status,
          filesChanged: result.agentResult?.filesChanged ?? [],
          summary: result.agentResult?.summary ?? '',
          metrics: result.metrics,
          snapshotId: result.snapshotId,
        },
        error: result.error?.message,
        durationMs: result.metrics.totalDurationMs,
      };
    } catch (error) {
      return {
        jobId: job.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Process multiple jobs in sequence
   */
  async processJobs(jobs: WorkflowJob[]): Promise<WorkflowResult[]> {
    const results: WorkflowResult[] = [];

    for (const job of jobs) {
      const result = await this.processJob(job);
      results.push(result);
    }

    return results;
  }

  /**
   * Start the worker (for polling-based integration)
   */
  start(): void {
    this.running = true;
  }

  /**
   * Stop the worker
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Create a coding job from a request
   */
  createJob(request: Omit<CodingTaskRequest, 'id' | 'createdAt'>): WorkflowJob {
    return {
      id: request.workspaceId + '-' + Date.now(),
      type: CODING_JOB_TYPE,
      payload: {
        workspaceId: request.workspaceId,
        prompt: request.prompt,
        userId: request.userId,
        options: request.options,
        metadata: request.metadata,
      },
      priority: 5, // Normal priority
      createdAt: new Date(),
    };
  }

  /**
   * Extract coding task request from workflow job
   */
  private extractRequest(job: WorkflowJob): CodingTaskRequest | null {
    const { payload } = job;

    if (!payload.workspaceId || !payload.prompt || !payload.userId) {
      return null;
    }

    return {
      id: job.id,
      workspaceId: payload.workspaceId as string,
      prompt: payload.prompt as string,
      userId: payload.userId as string,
      options: payload.options as CodingTaskRequest['options'],
      metadata: payload.metadata as Record<string, unknown>,
      createdAt: job.createdAt,
    };
  }

  /**
   * Get active task count
   */
  getActiveTaskCount(): number {
    return this.orchestrator.getActiveTaskCount();
  }
}

// Singleton instance
let defaultWorker: CodingWorker | null = null;

/**
 * Get default coding worker
 */
export function getCodingWorker(): CodingWorker {
  if (!defaultWorker) {
    defaultWorker = new CodingWorker();
  }
  return defaultWorker;
}

/**
 * Create coding worker
 */
export function createCodingWorker(options?: {
  orchestratorConfig?: Partial<TaskOrchestratorConfig>;
  onProgress?: (event: TaskProgressEvent) => void;
}): CodingWorker {
  return new CodingWorker(options);
}

/**
 * Process coding job helper
 */
export async function processCodingJob(
  job: WorkflowJob,
  workspace: WorkspaceFS
): Promise<WorkflowResult> {
  const worker = getCodingWorker();
  
  // Extract workspace ID from job
  const workspaceId = job.payload.workspaceId as string;
  worker.registerWorkspace(workspaceId, workspace);
  
  return worker.processJob(job);
}

/**
 * Create coding task helper
 */
export function createCodingJob(
  workspaceId: string,
  prompt: string,
  userId: string,
  options?: CodingTaskRequest['options']
): WorkflowJob {
  const worker = getCodingWorker();
  return worker.createJob({ workspaceId, prompt, userId, options });
}
