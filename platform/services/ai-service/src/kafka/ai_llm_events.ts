import { Kafka, Producer } from 'kafkajs';
import { config } from '../config.js';
import type { LLMProvider } from '../llm/types.js';

let producer: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (!producer) {
    const kafka = new Kafka({
      clientId: 'ai-service-llm',
      brokers: config.kafkaBrokers.split(','),
    });
    producer = kafka.producer();
    await producer.connect();
  }
  return producer;
}

export type LLMCallCompletedEvent = {
  requestId: string;
  workflowId: string;
  projectId: string;
  userId?: string;
  orgId?: string;
  agentName: string;
  stepName: string;
  provider: LLMProvider;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  cacheHit: boolean;
  costUsd: number;
  timestamp: string;
};

export type LLMCallFailedEvent = {
  requestId: string;
  workflowId: string;
  projectId: string;
  userId?: string;
  orgId?: string;
  agentName: string;
  stepName: string;
  provider: LLMProvider;
  model: string;
  error: string;
  retryable: boolean;
  timestamp: string;
};

export async function emitLlmCallCompleted(
  event: LLMCallCompletedEvent
): Promise<void> {
  try {
    const kafkaProducer = await getProducer();

    await kafkaProducer.send({
      topic: 'ai.llm.call.completed',
      messages: [
        {
          key: event.requestId,
          value: JSON.stringify({
            ...event,
            timestamp: event.timestamp ?? new Date().toISOString(),
          }),
        },
      ],
    });
  } catch (error) {
    console.error('Failed to emit LLM call completed event:', error);
  }
}

export async function emitLlmCallFailed(
  event: LLMCallFailedEvent
): Promise<void> {
  try {
    const kafkaProducer = await getProducer();

    await kafkaProducer.send({
      topic: 'ai.llm.call.failed',
      messages: [
        {
          key: event.requestId,
          value: JSON.stringify({
            ...event,
            timestamp: event.timestamp ?? new Date().toISOString(),
          }),
        },
      ],
    });
  } catch (error) {
    console.error('Failed to emit LLM call failed event:', error);
  }
}

export async function disconnectLlmKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
}
