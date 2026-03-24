/**
 * ExecutionEmitter — broadcasts AI execution events to connected IDE clients.
 * 
 * Maintains a registry of WebSocket connections subscribed to workspace events.
 * Called by workflow routes after agent steps complete.
 */

import type { WebSocket } from 'ws';

type EventPayload = Record<string, unknown>;

interface ExecutionEvent {
  taskId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  type: string;
  timestamp: number;
  sequence: number;
  stage?: string;
  progress?: number;
  payload: EventPayload;
  metadata: Record<string, unknown>;
}

// workspaceId → Set of connected WebSocket clients
const wsClients = new Map<string, Set<WebSocket>>();

// Per-task sequence counter
const sequences = new Map<string, number>();

export const executionEmitter = {
  /**
   * Register a WebSocket client for a workspace.
   * Called when client sends { type: 'execution.subscribe', workspaceId }
   */
  subscribe(workspaceId: string, ws: WebSocket): void {
    if (!wsClients.has(workspaceId)) {
      wsClients.set(workspaceId, new Set());
    }
    wsClients.get(workspaceId)!.add(ws);
    
    ws.on('close', () => {
      wsClients.get(workspaceId)?.delete(ws);
    });
  },

  /**
   * Emit an event to all clients subscribed to a workspace.
   */
  emit(workspaceId: string, taskId: string, event: Omit<ExecutionEvent, 'sequence' | 'workspaceId' | 'taskId'>): void {
    const clients = wsClients.get(workspaceId);
    if (!clients || clients.size === 0) return;

    const seq = (sequences.get(taskId) ?? 0) + 1;
    sequences.set(taskId, seq);

    const fullEvent: ExecutionEvent = {
      taskId,
      workspaceId,
      sequence: seq,
      ...event,
    };

    const message = JSON.stringify(fullEvent);
    
    clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    });
  },

  /**
   * Emit a file.modified event — the primary event IDE listens for to sync files.
   */
  emitFileModified(
    workspaceId: string,
    taskId: string,
    projectId: string,
    userId: string,
    filePath: string,
    content: string
  ): void {
    this.emit(workspaceId, taskId, {
      projectId,
      userId,
      type: 'file.modified',
      timestamp: Date.now(),
      stage: 'application',
      progress: 100,
      payload: {
        filePath,
        content,
        action: 'modified',
      },
      metadata: { agent: 'code_execution_agent' },
    });
  },

  /**
   * Emit a batch of files as patch.generated event.
   * More efficient than individual file.modified events.
   */
  emitFileBatch(
    workspaceId: string,
    taskId: string,
    projectId: string,
    userId: string,
    files: Record<string, string>
  ): void {
    this.emit(workspaceId, taskId, {
      projectId,
      userId,
      type: 'patch.generated',
      timestamp: Date.now(),
      stage: 'application',
      progress: 90,
      payload: {
        files,
        count: Object.keys(files).length,
      },
      metadata: { agent: 'code_execution_agent' },
    });
  },
};
