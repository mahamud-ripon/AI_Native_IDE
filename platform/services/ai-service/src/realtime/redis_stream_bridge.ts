/**
 * Redis Stream Bridge
 * 
 * Bridges agent events from Redis Pub/Sub to WebSocket clients.
 * Handles subscription management and message broadcasting.
 */

import Redis from 'ioredis';
import { config } from '../config.js';
import { pubSubRegistry } from './pubsub_registry.js';

// Redis clients
let publisher: Redis | null = null;
let subscriber: Redis | null = null;

// Channel prefixes
const AGENT_STREAM_CHANNEL = 'agent:stream';
const WORKFLOW_EVENT_CHANNEL = 'workflow:event';
const PROJECT_CHANNEL_PREFIX = 'project:';

// Message types
export interface AgentStreamMessage {
  type: 'agent.stream.start' | 'agent.stream.chunk' | 'agent.stream.end';
  connectionId: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  stepRunId: string;
  agentName: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface WorkflowEventMessage {
  type: 'workflow.step.started' | 'workflow.step.completed' | 'workflow.step.failed' | 'workflow.run.completed' | 'workflow.run.failed';
  connectionId?: string;
  userId: string;
  projectId: string;
  workflowRunId: string;
  stepRunId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export type RealtimeMessage = AgentStreamMessage | WorkflowEventMessage;

// Message handler type
export type MessageHandler = (connectionId: string, message: RealtimeMessage) => Promise<void>;

// Active handlers
const messageHandlers = new Map<string, MessageHandler>();

/**
 * Initialize Redis Stream Bridge
 */
export async function initRedisStreamBridge(): Promise<void> {
  if (publisher && subscriber) {
    return;
  }

  // Create publisher client
  publisher = new Redis(config.redisUrl);
  console.log('[RedisStreamBridge] Publisher connected');

  // Create subscriber client
  subscriber = new Redis(config.redisUrl);
  console.log('[RedisStreamBridge] Subscriber connected');

  // Set up message handler
  subscriber.on('message', async (channel: string, message: string) => {
    try {
      const parsedMessage = JSON.parse(message) as RealtimeMessage;
      await handleMessage(channel, parsedMessage);
    } catch (error) {
      console.error('[RedisStreamBridge] Error handling message:', error);
    }
  });

  console.log('[RedisStreamBridge] Initialized');
}

/**
 * Shutdown Redis Stream Bridge
 */
export async function shutdownRedisStreamBridge(): Promise<void> {
  if (publisher) {
    await publisher.quit();
    publisher = null;
  }

  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }

  messageHandlers.clear();
  console.log('[RedisStreamBridge] Shutdown complete');
}

/**
 * Publish agent stream message
 */
export async function publishAgentStream(message: Omit<AgentStreamMessage, 'timestamp'>): Promise<void> {
  if (!publisher) {
    throw new Error('RedisStreamBridge not initialized');
  }

  const fullMessage: AgentStreamMessage = {
    ...message,
    timestamp: Date.now(),
  };

  // Publish to agent stream channel
  await publisher.publish(AGENT_STREAM_CHANNEL, JSON.stringify(fullMessage));

  // Also publish to project-specific channel
  const projectChannel = `${PROJECT_CHANNEL_PREFIX}${message.projectId}`;
  await publisher.publish(projectChannel, JSON.stringify(fullMessage));
}

/**
 * Publish workflow event message
 */
export async function publishWorkflowEvent(message: Omit<WorkflowEventMessage, 'timestamp'>): Promise<void> {
  if (!publisher) {
    throw new Error('RedisStreamBridge not initialized');
  }

  const fullMessage: WorkflowEventMessage = {
    ...message,
    timestamp: Date.now(),
  };

  // Publish to workflow event channel
  await publisher.publish(WORKFLOW_EVENT_CHANNEL, JSON.stringify(fullMessage));

  // Also publish to project-specific channel
  const projectChannel = `${PROJECT_CHANNEL_PREFIX}${message.projectId}`;
  await publisher.publish(projectChannel, JSON.stringify(fullMessage));
}

/**
 * Subscribe to a channel
 */
export async function subscribeToChannel(
  channel: string,
  handler: MessageHandler
): Promise<void> {
  if (!subscriber) {
    throw new Error('RedisStreamBridge not initialized');
  }

  await subscriber.subscribe(channel);
  messageHandlers.set(channel, handler);
  console.log(`[RedisStreamBridge] Subscribed to channel: ${channel}`);
}

/**
 * Unsubscribe from a channel
 */
export async function unsubscribeFromChannel(channel: string): Promise<void> {
  if (!subscriber) {
    return;
  }

  await subscriber.unsubscribe(channel);
  messageHandlers.delete(channel);
  console.log(`[RedisStreamBridge] Unsubscribed from channel: ${channel}`);
}

/**
 * Subscribe to all events for a project
 */
export async function subscribeToProject(
  projectId: string,
  handler: MessageHandler
): Promise<void> {
  const projectChannel = `${PROJECT_CHANNEL_PREFIX}${projectId}`;
  await subscribeToChannel(projectChannel, handler);
}

/**
 * Unsubscribe from project events
 */
export async function unsubscribeFromProject(projectId: string): Promise<void> {
  const projectChannel = `${PROJECT_CHANNEL_PREFIX}${projectId}`;
  await unsubscribeFromChannel(projectChannel);
}

/**
 * Subscribe to all agent streams
 */
export async function subscribeToAgentStreams(handler: MessageHandler): Promise<void> {
  await subscribeToChannel(AGENT_STREAM_CHANNEL, handler);
}

/**
 * Subscribe to all workflow events
 */
export async function subscribeToWorkflowEvents(handler: MessageHandler): Promise<void> {
  await subscribeToChannel(WORKFLOW_EVENT_CHANNEL, handler);
}

/**
 * Handle incoming message from Redis
 */
async function handleMessage(channel: string, message: RealtimeMessage): Promise<void> {
  const handler = messageHandlers.get(channel);
  
  if (!handler) {
    return;
  }

  // Get target connections based on message type
  let targetConnectionIds: string[] = [];

  if ('connectionId' in message && message.connectionId) {
    // Direct message to specific connection
    targetConnectionIds = [message.connectionId];
  } else {
    // Broadcast to all project connections
    targetConnectionIds = await pubSubRegistry.getProjectConnections(message.projectId);
  }

  // Deliver message to each target connection
  for (const connectionId of targetConnectionIds) {
    try {
      await handler(connectionId, message);
    } catch (error) {
      console.error(`[RedisStreamBridge] Error delivering to ${connectionId}:`, error);
    }
  }
}

/**
 * Get bridge status
 */
export function getBridgeStatus(): {
  isInitialized: boolean;
  subscribedChannels: string[];
} {
  return {
    isInitialized: publisher !== null && subscriber !== null,
    subscribedChannels: Array.from(messageHandlers.keys()),
  };
}
