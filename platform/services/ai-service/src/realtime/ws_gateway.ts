/**
 * WebSocket Gateway
 * 
 * Manages WebSocket connections, subscriptions, and message broadcasting.
 * Integrates with Redis Pub/Sub for horizontal scaling.
 */

import WebSocket, { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { randomUUID } from 'crypto';
import { pubSubRegistry, ConnectionInfo } from './pubsub_registry.js';
import {
  initRedisStreamBridge,
  shutdownRedisStreamBridge,
  subscribeToProject,
  unsubscribeFromProject,
  subscribeToAgentStreams,
  subscribeToWorkflowEvents,
  publishAgentStream,
  publishWorkflowEvent,
  RealtimeMessage,
} from './redis_stream_bridge.js';

// Types
interface WebSocketWithMeta extends WebSocket {
  connectionId: string;
  userId: string;
  projectId: string;
  isAlive: boolean;
}

interface IncomingRealtimeMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping' | 'agent.stream.start' | 'agent.stream.chunk' | 'agent.stream.end' 
    | 'execution.subscribe' | 'execution.unsubscribe' | 'execution.replay';
  channel?: string;
  projectId?: string;
  workflowRunId?: string;
  stepRunId?: string;
  agentName?: string;
  payload?: Record<string, unknown>;
  // Execution-specific fields
  taskId?: string;
  workspaceId?: string;
  sinceSequence?: number;
}

// WebSocket server instance
let wss: WebSocketServer | null = null;

// Connection map
const connections = new Map<string, WebSocketWithMeta>();

// Heartbeat interval
const HEARTBEAT_INTERVAL_MS = 30000;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize WebSocket Gateway
 */
export async function initWebSocketGateway(
  server: import('http').Server | import('https').Server
): Promise<void> {
  // Initialize Redis Stream Bridge first
  await initRedisStreamBridge();

  // Create WebSocket server
  wss = new WebSocketServer({ server });

  // Handle new connections
  wss.on('connection', handleConnection);

  // Subscribe to global channels
  await subscribeToAgentStreams(handleRedisMessage);
  await subscribeToWorkflowEvents(handleRedisMessage);

  // Start heartbeat
  heartbeatInterval = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

  console.log('[WebSocketGateway] Initialized');
}

/**
 * Shutdown WebSocket Gateway
 */
export async function shutdownWebSocketGateway(): Promise<void> {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Close all connections
  for (const [connectionId, ws] of connections) {
    ws.close(1001, 'Server shutting down');
    connections.delete(connectionId);
  }

  // Close WebSocket server
  if (wss) {
    await new Promise<void>((resolve) => {
      wss!.close(() => resolve());
    });
    wss = null;
  }

  // Shutdown Redis Stream Bridge
  await shutdownRedisStreamBridge();

  console.log('[WebSocketGateway] Shutdown complete');
}

/**
 * Handle new WebSocket connection
 */
async function handleConnection(
  ws: WebSocket,
  request: IncomingMessage,
  client?: Duplex
): Promise<void> {
  // Extract user info from request (from auth middleware or query params)
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const userId = url.searchParams.get('userId') || 'anonymous';
  const projectId = url.searchParams.get('projectId') || '';

  if (!projectId) {
    ws.close(4001, 'projectId required');
    return;
  }

  // Generate connection ID
  const connectionId = `conn_${randomUUID()}`;

  // Add metadata to WebSocket
  const wsMeta = ws as WebSocketWithMeta;
  wsMeta.connectionId = connectionId;
  wsMeta.userId = userId;
  wsMeta.projectId = projectId;
  wsMeta.isAlive = true;

  // Register connection
  await pubSubRegistry.registerConnection(connectionId, userId, projectId);

  // Subscribe to project channel
  await subscribeToProject(projectId, handleRedisMessage);

  // Store connection
  connections.set(connectionId, wsMeta);

  console.log(`[WebSocketGateway] Connection established: ${connectionId} (user: ${userId}, project: ${projectId})`);

  // Set up message handler
  ws.on('message', (data: Buffer) => handleMessage(wsMeta, data));

  // Set up close handler
  ws.on('close', () => handleClose(wsMeta));

  // Set up error handler
  ws.on('error', (error) => {
    console.error(`[WebSocketGateway] Connection error ${connectionId}:`, error);
  });

  // Set up pong handler for heartbeat
  ws.on('pong', () => {
    wsMeta.isAlive = true;
  });

  // Send connection confirmation
  send(wsMeta, {
    type: 'connection.established',
    connectionId,
    timestamp: Date.now(),
  });
}

/**
 * Handle WebSocket message
 */
async function handleMessage(ws: WebSocketWithMeta, data: Buffer): Promise<void> {
  try {
    const message: IncomingRealtimeMessage = JSON.parse(data.toString());

    // Update activity
    await pubSubRegistry.updateActivity(ws.connectionId);

    switch (message.type) {
      case 'ping':
        send(ws, { type: 'pong', timestamp: Date.now() });
        break;

      case 'subscribe':
        if (message.channel) {
          await pubSubRegistry.subscribe(ws.connectionId, message.channel);
          send(ws, { type: 'subscribed', channel: message.channel });
        }
        break;

      case 'unsubscribe':
        if (message.channel) {
          await pubSubRegistry.unsubscribe(ws.connectionId, message.channel);
          send(ws, { type: 'unsubscribed', channel: message.channel });
        }
        break;

      case 'agent.stream.start':
      case 'agent.stream.chunk':
      case 'agent.stream.end':
        // Publish agent stream event
        await publishAgentStream({
          type: message.type,
          connectionId: ws.connectionId,
          userId: ws.userId,
          projectId: ws.projectId,
          workflowRunId: message.workflowRunId || '',
          stepRunId: message.stepRunId || '',
          agentName: message.agentName || '',
          payload: message.payload || {},
        });
        break;

      case 'execution.subscribe':
        // Subscribe to execution events for a task
        if (message.taskId) {
          const channel = `execution:task:${message.taskId}`;
          await pubSubRegistry.subscribe(ws.connectionId, channel);
          send(ws, { 
            type: 'execution.subscribed', 
            taskId: message.taskId,
            channel,
          });
        } else if (message.workspaceId) {
          // Subscribe to all tasks in workspace
          const channel = `execution:workspace:${message.workspaceId}`;
          await pubSubRegistry.subscribe(ws.connectionId, channel);
          send(ws, { 
            type: 'execution.subscribed', 
            workspaceId: message.workspaceId,
            channel,
          });
        }
        break;

      case 'execution.unsubscribe':
        // Unsubscribe from execution events
        if (message.taskId) {
          const channel = `execution:task:${message.taskId}`;
          await pubSubRegistry.unsubscribe(ws.connectionId, channel);
          send(ws, { 
            type: 'execution.unsubscribed', 
            taskId: message.taskId,
          });
        } else if (message.workspaceId) {
          const channel = `execution:workspace:${message.workspaceId}`;
          await pubSubRegistry.unsubscribe(ws.connectionId, channel);
          send(ws, { 
            type: 'execution.unsubscribed', 
            workspaceId: message.workspaceId,
          });
        }
        break;

      case 'execution.replay':
        // Replay missed events for a task (handled by API, but can be requested via WS)
        if (message.taskId) {
          // This will be handled by the execution event consumer's getEventsSince
          // For now, acknowledge the request
          send(ws, { 
            type: 'execution.replay.ack', 
            taskId: message.taskId,
            sinceSequence: message.sinceSequence || 0,
            message: 'Replay via API: GET /execution/tasks/{taskId}/events',
          });
        }
        break;

      default:
        console.warn(`[WebSocketGateway] Unknown message type: ${(message as { type: string }).type}`);
    }
  } catch (error) {
    console.error('[WebSocketGateway] Error handling message:', error);
    send(ws, { type: 'error', message: 'Failed to process message' });
  }
}

/**
 * Handle WebSocket close
 */
async function handleClose(ws: WebSocketWithMeta): Promise<void> {
  console.log(`[WebSocketGateway] Connection closed: ${ws.connectionId}`);

  // Unregister connection
  await pubSubRegistry.unregisterConnection(ws.connectionId);

  // Remove from connections map
  connections.delete(ws.connectionId);

  // Unsubscribe from project channel if no more connections
  const projectConnections = await pubSubRegistry.getProjectConnections(ws.projectId);
  if (projectConnections.length === 0) {
    await unsubscribeFromProject(ws.projectId);
  }
}

/**
 * Handle message from Redis Pub/Sub
 */
async function handleRedisMessage(connectionId: string, message: RealtimeMessage): Promise<void> {
  const ws = connections.get(connectionId);
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  send(ws, message);
}

/**
 * Send message to WebSocket
 */
function send(ws: WebSocket, message: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast message to all connections in a project
 */
export async function broadcastToProject(projectId: string, message: unknown): Promise<void> {
  const connectionIds = await pubSubRegistry.getProjectConnections(projectId);

  for (const connectionId of connectionIds) {
    const ws = connections.get(connectionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      send(ws, message);
    }
  }
}

/**
 * Broadcast message to all connections for a user
 */
export async function broadcastToUser(userId: string, message: unknown): Promise<void> {
  const connectionIds = await pubSubRegistry.getUserConnections(userId);

  for (const connectionId of connectionIds) {
    const ws = connections.get(connectionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      send(ws, message);
    }
  }
}

/**
 * Heartbeat to detect dead connections
 */
function heartbeat(): void {
  if (!wss) {
    return;
  }

  for (const [connectionId, ws] of connections) {
    if (!ws.isAlive) {
      console.log(`[WebSocketGateway] Terminating dead connection: ${connectionId}`);
      ws.terminate();
      connections.delete(connectionId);
      pubSubRegistry.unregisterConnection(connectionId).catch(console.error);
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}

/**
 * Get gateway status
 */
export function getGatewayStatus(): {
  isInitialized: boolean;
  connectionCount: number;
  connections: Array<{ connectionId: string; userId: string; projectId: string }>;
} {
  return {
    isInitialized: wss !== null,
    connectionCount: connections.size,
    connections: Array.from(connections.values()).map(ws => ({
      connectionId: ws.connectionId,
      userId: ws.userId,
      projectId: ws.projectId,
    })),
  };
}

/**
 * Get connection by ID
 */
export function getConnection(connectionId: string): WebSocketWithMeta | undefined {
  return connections.get(connectionId);
}

/**
 * Send message to specific connection
 */
export function sendToConnection(connectionId: string, message: unknown): boolean {
  const ws = connections.get(connectionId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    send(ws, message);
    return true;
  }
  return false;
}
