/**
 * Workflow Event Publisher
 * 
 * Emits Kafka events for workflow observability.
 */

import { getProducer } from '../../kafka/ai_llm_events.js';

// -----------------------------------------------------------------------------
// EVENT TYPES
// -----------------------------------------------------------------------------

export interface WorkflowStartedEvent {
  eventId: string;
  timestamp: string;
  eventType: 'workflow.run.started';
  workflowRunId: string;
  workflowName: string;
  projectId: string;
  userId?: string;
  totalSteps: number;
}

export interface WorkflowCompletedEvent {
  eventId: string;
  timestamp: string;
  eventType: 'workflow.run.completed';
  workflowRunId: string;
  workflowName: string;
  projectId: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}

export interface WorkflowFailedEvent {
  eventId: string;
  timestamp: string;
  eventType: 'workflow.run.failed';
  workflowRunId: string;
  workflowName: string;
  projectId: string;
  errorStep: number;
  errorMessage: string;
}

export interface StepStartedEvent {
  eventId: string;
  timestamp: string;
  eventType: 'workflow.step.started';
  workflowRunId: string;
  stepRunId: string;
  stepIndex: number;
  stepName: string;
  agentName: string;
}

export interface StepCompletedEvent {
  eventId: string;
  timestamp: string;
  eventType: 'workflow.step.completed';
  workflowRunId: string;
  stepRunId: string;
  stepIndex: number;
  stepName: string;
  agentName: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
}

export interface StepFailedEvent {
  eventId: string;
  timestamp: string;
  eventType: 'workflow.step.failed';
  workflowRunId: string;
  stepRunId: string;
  stepIndex: number;
  stepName: string;
  agentName: string;
  errorMessage: string;
}

export interface CheckpointCreatedEvent {
  eventId: string;
  timestamp: string;
  eventType: 'workflow.checkpoint.created';
  workflowRunId: string;
  stepIndex: number;
  stepName: string;
  checkpointType: string;
}

type WorkflowEvent = 
  | WorkflowStartedEvent 
  | WorkflowCompletedEvent 
  | WorkflowFailedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | CheckpointCreatedEvent;

// -----------------------------------------------------------------------------
// EVENT EMITTERS
// -----------------------------------------------------------------------------

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

async function emitEvent(topic: string, event: WorkflowEvent): Promise<void> {
  try {
    const producer = await getProducer();
    await producer.send({
      topic,
      messages: [
        {
          key: event.workflowRunId,
          value: JSON.stringify(event),
        },
      ],
    });
  } catch (error) {
    console.error(`Failed to emit event to ${topic}:`, error);
    // Don't throw - events are non-critical
  }
}

// -----------------------------------------------------------------------------
// PUBLIC API
// -----------------------------------------------------------------------------

export async function emitWorkflowStarted(data: {
  workflowRunId: string;
  workflowName: string;
  projectId: string;
  userId?: string;
  totalSteps: number;
}): Promise<void> {
  const event: WorkflowStartedEvent = {
    eventId: generateEventId(),
    timestamp: getTimestamp(),
    eventType: 'workflow.run.started',
    ...data,
  };
  await emitEvent('workflow.run.started', event);
}

export async function emitWorkflowCompleted(data: {
  workflowRunId: string;
  workflowName: string;
  projectId: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}): Promise<void> {
  const event: WorkflowCompletedEvent = {
    eventId: generateEventId(),
    timestamp: getTimestamp(),
    eventType: 'workflow.run.completed',
    ...data,
  };
  await emitEvent('workflow.run.completed', event);
}

export async function emitWorkflowFailed(data: {
  workflowRunId: string;
  workflowName: string;
  projectId: string;
  errorStep: number;
  errorMessage: string;
}): Promise<void> {
  const event: WorkflowFailedEvent = {
    eventId: generateEventId(),
    timestamp: getTimestamp(),
    eventType: 'workflow.run.failed',
    ...data,
  };
  await emitEvent('workflow.run.failed', event);
}

export async function emitStepStarted(data: {
  workflowRunId: string;
  stepRunId: string;
  stepIndex: number;
  stepName: string;
  agentName: string;
}): Promise<void> {
  const event: StepStartedEvent = {
    eventId: generateEventId(),
    timestamp: getTimestamp(),
    eventType: 'workflow.step.started',
    ...data,
  };
  await emitEvent('workflow.step.started', event);
}

export async function emitStepCompleted(data: {
  workflowRunId: string;
  stepRunId: string;
  stepIndex: number;
  stepName: string;
  agentName: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
}): Promise<void> {
  const event: StepCompletedEvent = {
    eventId: generateEventId(),
    timestamp: getTimestamp(),
    eventType: 'workflow.step.completed',
    ...data,
  };
  await emitEvent('workflow.step.completed', event);
}

export async function emitStepFailed(data: {
  workflowRunId: string;
  stepRunId: string;
  stepIndex: number;
  stepName: string;
  agentName: string;
  errorMessage: string;
}): Promise<void> {
  const event: StepFailedEvent = {
    eventId: generateEventId(),
    timestamp: getTimestamp(),
    eventType: 'workflow.step.failed',
    ...data,
  };
  await emitEvent('workflow.step.failed', event);
}

export async function emitCheckpointCreated(data: {
  workflowRunId: string;
  stepIndex: number;
  stepName: string;
  checkpointType: string;
}): Promise<void> {
  const event: CheckpointCreatedEvent = {
    eventId: generateEventId(),
    timestamp: getTimestamp(),
    eventType: 'workflow.checkpoint.created',
    ...data,
  };
  await emitEvent('workflow.checkpoint.created', event);
}
