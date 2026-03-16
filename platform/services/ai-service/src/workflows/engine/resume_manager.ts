/**
 * Resume Manager
 * 
 * Handles checkpoint creation and recovery for workflow crash resilience.
 */

import { prisma } from '@workspace/database';
import { CheckpointType } from '@workspace/database';
import type { WorkflowState } from '../types.js';

// Use shared prisma instance from @workspace/database

const MAX_CHECKPOINTS_PER_WORKFLOW = 50;
const MAX_STATE_SIZE_BYTES = 256 * 1024; // 256KB

/**
 * Create a checkpoint for a workflow run
 */
export async function createCheckpoint(
  workflowRunId: string,
  stepIndex: number,
  stepName: string,
  output: unknown,
  type: CheckpointType = CheckpointType.post_step
): Promise<string> {
  // Load current workflow state
  const workflowRun = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
  });

  if (!workflowRun) {
    throw new Error(`Workflow run ${workflowRunId} not found`);
  }

  // Build state snapshot
  const currentState = workflowRun.contextJson as unknown as WorkflowState;
  const state: WorkflowState = {
    ...currentState,
    timestamp: new Date().toISOString(),
    progress: {
      ...currentState.progress,
      currentStep: stepIndex,
      completedSteps: type === CheckpointType.post_step
        ? [...currentState.progress.completedSteps, stepIndex]
        : currentState.progress.completedSteps,
    },
  };

  // Check state size
  const stateSize = JSON.stringify(state).length;
  let stateS3Key: string | undefined;

  if (stateSize > MAX_STATE_SIZE_BYTES) {
    // TODO: Upload to S3 and store reference
    // For now, truncate large outputs
    stateS3Key = `checkpoints/${workflowRunId}/${stepIndex}-${Date.now()}.json`;
    console.warn(`State size ${stateSize} exceeds limit, should upload to S3: ${stateS3Key}`);
  }

  // Create checkpoint
  const checkpoint = await prisma.checkpoint.create({
    data: {
      workflowRunId,
      type,
      stepIndex,
      stepName,
      stateJson: JSON.parse(JSON.stringify(state)),
      stateS3Key,
    },
  });

  // Enforce max checkpoints limit
  await enforceMaxCheckpoints(workflowRunId);

  // Update workflow context
  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: {
      contextJson: JSON.parse(JSON.stringify(state)),
    },
  });

  return checkpoint.id;
}

/**
 * Load the latest checkpoint for a workflow run
 */
export async function loadLatestCheckpoint(workflowRunId: string): Promise<WorkflowState | null> {
  const checkpoint = await prisma.checkpoint.findFirst({
    where: { workflowRunId },
    orderBy: { createdAt: 'desc' },
  });

  if (!checkpoint) {
    return null;
  }

  // If state is in S3, load from there
  if (checkpoint.stateS3Key) {
    // TODO: Load from S3
    console.warn(`State in S3 not implemented: ${checkpoint.stateS3Key}`);
  }

  return checkpoint.stateJson as unknown as WorkflowState;
}

/**
 * Restore workflow state from checkpoint
 */
export async function restoreState(workflowRunId: string): Promise<WorkflowState | null> {
  const checkpoint = await loadLatestCheckpoint(workflowRunId);

  if (!checkpoint) {
    // Return current workflow context if no checkpoint
    const workflowRun = await prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
    });

    return workflowRun?.contextJson as unknown as WorkflowState ?? null;
  }

  // Restore context from checkpoint
  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: {
      contextJson: JSON.parse(JSON.stringify(checkpoint)),
    },
  });

  return checkpoint;
}

/**
 * Get checkpoint at specific step
 */
export async function getCheckpointAtStep(
  workflowRunId: string,
  stepIndex: number
): Promise<WorkflowState | null> {
  const checkpoint = await prisma.checkpoint.findFirst({
    where: {
      workflowRunId,
      stepIndex,
    },
    orderBy: { createdAt: 'desc' },
  });

  return checkpoint?.stateJson as unknown as WorkflowState ?? null;
}

/**
 * Delete old checkpoints to enforce limit
 */
async function enforceMaxCheckpoints(workflowRunId: string): Promise<void> {
  const checkpoints = await prisma.checkpoint.findMany({
    where: { workflowRunId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (checkpoints.length > MAX_CHECKPOINTS_PER_WORKFLOW) {
    const toDelete = checkpoints.slice(MAX_CHECKPOINTS_PER_WORKFLOW);
    
    await prisma.checkpoint.deleteMany({
      where: {
        id: { in: toDelete.map((c: { id: string }) => c.id) },
      },
    });
  }
}

/**
 * Clear all checkpoints for a workflow run
 */
export async function clearCheckpoints(workflowRunId: string): Promise<void> {
  await prisma.checkpoint.deleteMany({
    where: { workflowRunId },
  });
}
