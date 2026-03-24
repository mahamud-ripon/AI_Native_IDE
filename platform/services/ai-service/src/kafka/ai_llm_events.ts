import { Producer } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import { config } from '../config.js';
import type { LLMProvider } from '../llm/types.js';

let producer: Producer | null = null;
let isConnecting = false;

export async function getProducer(): Promise<Producer> {
  // If producer exists and has a valid connection, return it
  if (producer) {
    return producer;
  }

  // Prevent concurrent connection attempts
  if (isConnecting) {
    // Wait for existing connection attempt to complete
    while (isConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return producer!;
  }

  isConnecting = true;
  try {
    const kafka = createKafkaClient({ clientId: 'ai-service-llm' });
    producer = kafka.producer();
    
    await producer.connect();
    console.log('[KafkaProducer] Connected successfully');
    
    // Set up disconnect handler to reset producer
    producer.on(producer.events.DISCONNECT, () => {
      console.log('[KafkaProducer] Producer disconnected event received');
      producer = null;
    });
    
    return producer;
  } catch (error) {
    console.error('[KafkaProducer] Failed to connect:', error);
    producer = null;
    throw error;
  } finally {
    isConnecting = false;
  }
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
