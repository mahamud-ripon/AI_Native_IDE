/**
 * Workflow Engine Core Implementation
 * 
 * Main engine for executing resumable AI workflows.
 * Handles workflow lifecycle, step execution, and checkpoint management.
 */

import { prisma } from '@workspace/database';
import { WorkflowRunStatus as DBWorkflowRunStatus, StepRunStatus, CheckpointType } from '@workspace/database';
import type {
  WorkflowEngine,
  StartWorkflowInput,
  StartWorkflowResult,
  ExecuteStepResult,
  ResumeOptions,
  WorkflowRunStatus,
  WorkflowState,
  WorkflowDefinition,
} from '../types.js';
import { getWorkflowRegistry } from '../registry.js';
import { executeStep } from './step_executor.js';
import { createCheckpoint, loadLatestCheckpoint, restoreState } from './resume_manager.js';
import {
  emitWorkflowStarted,
  emitWorkflowCompleted,
  emitWorkflowFailed,
} from '../events/workflow_events.js';

// Use shared prisma instance from lib/prisma.ts
// const prisma is imported from @workspace/database

// Constants
const MAX_CHECKPOINTS_PER_WORKFLOW = 50;
const MAX_STATE_SIZE_BYTES = 256 * 1024; // 256KB

/**
 * Create workflow engine instance
 */
export function createWorkflowEngine(): WorkflowEngine {
  const registry = getWorkflowRegistry();

  /**
   * Start a new workflow execution
   */
  async function startWorkflow(input: StartWorkflowInput): Promise<StartWorkflowResult> {
    // Get workflow definition
    const definition = registry.get(input.workflowName);
    if (!definition) {
      throw new Error(`Workflow "${input.workflowName}" not found in registry`);
    }

    // Create initial state
    const initialState: WorkflowState = {
      stateVersion: 1,
      timestamp: new Date().toISOString(),
      agentMemory: {},
      context: {
        projectId: input.projectId,
        userId: input.userId,
        conversationId: input.conversationId,
        variables: input.initialContext ?? {},
      },
      progress: {
        completedSteps: [],
        failedSteps: [],
        skippedSteps: [],
        currentStep: -1,
      },
    };

    // Create workflow run in database
    const workflowRun = await prisma.workflowRun.create({
      data: {
        projectId: input.projectId,
        workflowName: input.workflowName,
        workflowVersion: definition.version,
        workflowDefinitionJson: JSON.parse(JSON.stringify(definition)),
        status: DBWorkflowRunStatus.pending,
        currentStep: 0,
        totalSteps: definition.steps.length,
        contextJson: JSON.parse(JSON.stringify(initialState)),
        triggeredBy: input.userId,
        triggerType: input.triggerType ?? 'manual',
        parentRunId: input.parentRunId,
      },
    });

    // Emit workflow started event
    await emitWorkflowStarted({
      workflowRunId: workflowRun.id,
      workflowName: input.workflowName,
      projectId: input.projectId,
      userId: input.userId,
      totalSteps: definition.steps.length,
    });

    // Transition to running and start first step
    await prisma.workflowRun.update({
      where: { id: workflowRun.id },
      data: {
        status: DBWorkflowRunStatus.running,
        startedAt: new Date(),
      },
    });

    return {
      workflowRunId: workflowRun.id,
      status: 'running',
      totalSteps: definition.steps.length,
    };
  }

  /**
   * Execute the next pending step in a workflow
   */
  async function executeNextStep(workflowRunId: string): Promise<ExecuteStepResult | null> {
    // Load workflow run
    const workflowRun = await prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      include: { steps: true },
    });

    if (!workflowRun) {
      throw new Error(`Workflow run ${workflowRunId} not found`);
    }

    if (workflowRun.status !== DBWorkflowRunStatus.running) {
      return null; // Not in a state to execute
    }

    // Get definition
    const definition = workflowRun.workflowDefinitionJson as unknown as WorkflowDefinition;

    // Find next step to execute
    const currentStepIndex = workflowRun.currentStep;
    if (currentStepIndex >= definition.steps.length) {
      // Workflow complete
      await completeWorkflow(workflowRunId);
      return null;
    }

    const stepDef = definition.steps[currentStepIndex];

    // Check if step already completed (idempotency)
    const existingStep = workflowRun.steps.find((s: { stepIndex: number; status: string }) => s.stepIndex === currentStepIndex);
    if (existingStep && existingStep.status === StepRunStatus.completed) {
      // Skip to next step
      await prisma.workflowRun.update({
        where: { id: workflowRunId },
        data: { currentStep: currentStepIndex + 1 },
      });
      return executeNextStep(workflowRunId);
    }

    // Execute step
    const result = await executeStep({
      workflowRunId,
      stepIndex: currentStepIndex,
      stepDef,
      state: workflowRun.contextJson as unknown as WorkflowState,
      definition,
    });

    // Handle result
    if (result.status === 'completed') {
      // Update workflow progress
      await prisma.workflowRun.update({
        where: { id: workflowRunId },
        data: {
          currentStep: currentStepIndex + 1,
          totalTokensIn: { increment: result.metrics?.tokensIn ?? 0 },
          totalTokensOut: { increment: result.metrics?.tokensOut ?? 0 },
          totalCostUsd: result.metrics?.costUsd ?? null,
        },
      });

      // Create checkpoint if configured
      if (definition.checkpointAfterStep !== false) {
        await createCheckpoint(workflowRunId, currentStepIndex, stepDef.stepName, result.output);
      }

      // Check if workflow complete
      if (currentStepIndex + 1 >= definition.steps.length) {
        await completeWorkflow(workflowRunId);
      }
    } else if (result.status === 'failed') {
      // Update step with error
      await prisma.workflowRun.update({
        where: { id: workflowRunId },
        data: {
          errorMessage: result.error,
          errorStep: currentStepIndex,
        },
      });

      // Check if step is optional
      if (stepDef.optional) {
        // Skip and continue
        await prisma.workflowRun.update({
          where: { id: workflowRunId },
          data: {
            currentStep: currentStepIndex + 1,
          },
        });
        return executeNextStep(workflowRunId);
      }

      // Fail workflow
      await failWorkflow(workflowRunId, result.error ?? 'Step failed', currentStepIndex);
    }

    return result;
  }

  /**
   * Resume a paused or crashed workflow
   */
  async function resumeWorkflow(workflowRunId: string, options?: ResumeOptions): Promise<void> {
    // Load workflow run
    const workflowRun = await prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
    });

    if (!workflowRun) {
      throw new Error(`Workflow run ${workflowRunId} not found`);
    }

    // Can only resume from paused or failed states
    if (workflowRun.status === DBWorkflowRunStatus.completed) {
      return; // Already complete
    }

    // Load latest checkpoint
    const checkpoint = await loadLatestCheckpoint(workflowRunId);
    let resumeFromStep = options?.fromStep ?? workflowRun.resumeFromStep;

    if (checkpoint && resumeFromStep === undefined) {
      // Derive from checkpoint
      resumeFromStep = checkpoint.progress.currentStep + 1;
    }

    resumeFromStep = resumeFromStep ?? workflowRun.currentStep;

    // Restore state
    const state = checkpoint ?? (workflowRun.contextJson as unknown as WorkflowState);

    // Handle running steps that crashed
    const crashedSteps = await prisma.stepRun.findMany({
      where: {
        workflowRunId,
        status: StepRunStatus.running,
      },
    });

    for (const crashed of crashedSteps) {
      if (options?.retryFailed !== false) {
        // Mark as failed and increment retry
        await prisma.stepRun.update({
          where: { id: crashed.id },
          data: {
            status: StepRunStatus.failed,
            errorMessage: 'Worker crashed during execution',
            retryCount: { increment: 1 },
          },
        });
      }
    }

    // Update workflow to running
    await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: DBWorkflowRunStatus.running,
        resumeFromStep,
        currentStep: resumeFromStep,
        errorMessage: null,
        errorStep: null,
      },
    });

    // Continue execution
    await executeNextStep(workflowRunId);
  }

  /**
   * Cancel a running workflow
   */
  async function cancelWorkflow(workflowRunId: string, reason?: string): Promise<void> {
    await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: DBWorkflowRunStatus.cancelled,
        completedAt: new Date(),
        errorMessage: reason ?? 'Cancelled by user',
      },
    });
  }

  /**
   * Pause a running workflow
   */
  async function pauseWorkflow(workflowRunId: string): Promise<void> {
    await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: DBWorkflowRunStatus.paused,
      },
    });
  }

  /**
   * Get workflow run status
   */
  async function getStatus(workflowRunId: string): Promise<WorkflowRunStatus> {
    const workflowRun = await prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      include: { steps: true },
    });

    if (!workflowRun) {
      throw new Error(`Workflow run ${workflowRunId} not found`);
    }

    const state = workflowRun.contextJson as unknown as WorkflowState;

    return {
      workflowRunId: workflowRun.id,
      workflowName: workflowRun.workflowName,
      status: workflowRun.status.toLowerCase() as WorkflowRunStatus['status'],
      currentStep: workflowRun.currentStep,
      totalSteps: workflowRun.totalSteps,
      completedSteps: state?.progress?.completedSteps ?? [],
      failedSteps: state?.progress?.failedSteps ?? [],
      startedAt: workflowRun.startedAt ?? undefined,
      completedAt: workflowRun.completedAt ?? undefined,
      totalTokensIn: workflowRun.totalTokensIn,
      totalTokensOut: workflowRun.totalTokensOut,
      totalCostUsd: workflowRun.totalCostUsd ? Number(workflowRun.totalCostUsd) : null,
      errorMessage: workflowRun.errorMessage ?? undefined,
      errorStep: workflowRun.errorStep ?? undefined,
    };
  }

  /**
   * Get latest checkpoint
   */
  async function getLatestCheckpoint(workflowRunId: string): Promise<WorkflowState | null> {
    return loadLatestCheckpoint(workflowRunId);
  }

  // Helper: Complete workflow
  async function completeWorkflow(workflowRunId: string): Promise<void> {
    const workflowRun = await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: DBWorkflowRunStatus.completed,
        completedAt: new Date(),
      },
    });

    await emitWorkflowCompleted({
      workflowRunId,
      workflowName: workflowRun.workflowName,
      projectId: workflowRun.projectId ?? '',
      totalTokensIn: workflowRun.totalTokensIn,
      totalTokensOut: workflowRun.totalTokensOut,
      totalCostUsd: workflowRun.totalCostUsd ? Number(workflowRun.totalCostUsd) : 0,
    });
  }

  // Helper: Fail workflow
  async function failWorkflow(workflowRunId: string, error: string, stepIndex: number): Promise<void> {
    const workflowRun = await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: DBWorkflowRunStatus.failed,
        completedAt: new Date(),
        errorMessage: error,
        errorStep: stepIndex,
      },
    });

    await emitWorkflowFailed({
      workflowRunId,
      workflowName: workflowRun.workflowName,
      projectId: workflowRun.projectId ?? '',
      errorStep: stepIndex,
      errorMessage: error,
    });
  }

  return {
    startWorkflow,
    executeNextStep,
    resumeWorkflow,
    cancelWorkflow,
    pauseWorkflow,
    getStatus,
    getLatestCheckpoint,
  };
}

// Singleton instance
let engineInstance: WorkflowEngine | null = null;

/**
 * Get the global workflow engine instance
 */
export function getWorkflowEngine(): WorkflowEngine {
  if (!engineInstance) {
    engineInstance = createWorkflowEngine();
  }
  return engineInstance;
}
