/**
 * Agent Stream Publisher
 * 
 * Publishes agent streaming events to Redis for real-time delivery.
 * Used by step executor to stream agent responses to connected clients.
 */

import {
  publishAgentStream,
  publishWorkflowEvent,
} from './redis_stream_bridge.js';

// Types
export interface StreamStartPayload {
  agentName: string;
  taskType: string;
  modelHint?: string;
  prompt: string;
}

export interface StreamChunkPayload {
  content: string;
  isDelta: boolean;
  metadata?: {
    tokensGenerated?: number;
    latencyMs?: number;
  };
}

export interface StreamEndPayload {
  fullContent: string;
  totalTokensIn: number;
  totalTokensOut: number;
  costUsd: number;
  durationMs: number;
  finishReason: 'complete' | 'stop' | 'error';
}

export interface StepUpdatePayload {
  stepName: string;
  agentName: string;
  status: 'started' | 'running' | 'completed' | 'failed';
  progress?: number;
  message?: string;
}

/**
 * Publish agent stream start event
 */
export async function publishStreamStart(params: {
  connectionId?: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  stepRunId: string;
  agentName: string;
  payload: StreamStartPayload;
}): Promise<void> {
  await publishAgentStream({
    type: 'agent.stream.start',
    connectionId: params.connectionId || '',
    userId: params.userId,
    projectId: params.projectId,
    workflowRunId: params.workflowRunId,
    stepRunId: params.stepRunId,
    agentName: params.agentName,
    payload: {
      agentName: params.payload.agentName,
      taskType: params.payload.taskType,
      modelHint: params.payload.modelHint,
      prompt: params.payload.prompt,
    },
  });
}

/**
 * Publish agent stream chunk event
 */
export async function publishStreamChunk(params: {
  connectionId?: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  stepRunId: string;
  agentName: string;
  payload: StreamChunkPayload;
}): Promise<void> {
  await publishAgentStream({
    type: 'agent.stream.chunk',
    connectionId: params.connectionId || '',
    userId: params.userId,
    projectId: params.projectId,
    workflowRunId: params.workflowRunId,
    stepRunId: params.stepRunId,
    agentName: params.agentName,
    payload: {
      content: params.payload.content,
      isDelta: params.payload.isDelta,
      metadata: params.payload.metadata,
    },
  });
}

/**
 * Publish agent stream end event
 */
export async function publishStreamEnd(params: {
  connectionId?: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  stepRunId: string;
  agentName: string;
  payload: StreamEndPayload;
}): Promise<void> {
  await publishAgentStream({
    type: 'agent.stream.end',
    connectionId: params.connectionId || '',
    userId: params.userId,
    projectId: params.projectId,
    workflowRunId: params.workflowRunId,
    stepRunId: params.stepRunId,
    agentName: params.agentName,
    payload: {
      fullContent: params.payload.fullContent,
      totalTokensIn: params.payload.totalTokensIn,
      totalTokensOut: params.payload.totalTokensOut,
      costUsd: params.payload.costUsd,
      durationMs: params.payload.durationMs,
      finishReason: params.payload.finishReason,
    },
  });
}

/**
 * Publish workflow step update event
 */
export async function publishStepUpdate(params: {
  connectionId?: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  stepRunId: string;
  payload: StepUpdatePayload;
}): Promise<void> {
  await publishWorkflowEvent({
    type: 'workflow.step.started',
    connectionId: params.connectionId,
    userId: params.userId,
    projectId: params.projectId,
    workflowRunId: params.workflowRunId,
    stepRunId: params.stepRunId,
    payload: {
      stepName: params.payload.stepName,
      agentName: params.payload.agentName,
      status: params.payload.status,
      progress: params.payload.progress,
      message: params.payload.message,
    },
  });
}

/**
 * Publish workflow step completed event
 */
export async function publishStepCompleted(params: {
  connectionId?: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  stepRunId: string;
  stepName: string;
  agentName: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}): Promise<void> {
  await publishWorkflowEvent({
    type: 'workflow.step.completed',
    connectionId: params.connectionId,
    userId: params.userId,
    projectId: params.projectId,
    workflowRunId: params.workflowRunId,
    stepRunId: params.stepRunId,
    payload: {
      stepName: params.stepName,
      agentName: params.agentName,
      durationMs: params.durationMs,
      tokensIn: params.tokensIn,
      tokensOut: params.tokensOut,
      costUsd: params.costUsd,
    },
  });
}

/**
 * Publish workflow step failed event
 */
export async function publishStepFailed(params: {
  connectionId?: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  stepRunId: string;
  stepName: string;
  agentName: string;
  error: string;
  retryCount: number;
  willRetry: boolean;
}): Promise<void> {
  await publishWorkflowEvent({
    type: 'workflow.step.failed',
    connectionId: params.connectionId,
    userId: params.userId,
    projectId: params.projectId,
    workflowRunId: params.workflowRunId,
    stepRunId: params.stepRunId,
    payload: {
      stepName: params.stepName,
      agentName: params.agentName,
      error: params.error,
      retryCount: params.retryCount,
      willRetry: params.willRetry,
    },
  });
}

/**
 * Publish workflow run completed event
 */
export async function publishWorkflowCompleted(params: {
  connectionId?: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  workflowName: string;
  totalSteps: number;
  totalDurationMs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}): Promise<void> {
  await publishWorkflowEvent({
    type: 'workflow.run.completed',
    connectionId: params.connectionId,
    userId: params.userId,
    projectId: params.projectId,
    workflowRunId: params.workflowRunId,
    payload: {
      workflowName: params.workflowName,
      totalSteps: params.totalSteps,
      totalDurationMs: params.totalDurationMs,
      totalTokensIn: params.totalTokensIn,
      totalTokensOut: params.totalTokensOut,
      totalCostUsd: params.totalCostUsd,
    },
  });
}

/**
 * Publish workflow run failed event
 */
export async function publishWorkflowFailed(params: {
  connectionId?: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  workflowName: string;
  error: string;
  failedStep: number;
  stepName?: string;
}): Promise<void> {
  await publishWorkflowEvent({
    type: 'workflow.run.failed',
    connectionId: params.connectionId,
    userId: params.userId,
    projectId: params.projectId,
    workflowRunId: params.workflowRunId,
    payload: {
      workflowName: params.workflowName,
      error: params.error,
      failedStep: params.failedStep,
      stepName: params.stepName,
    },
  });
}
