/**
 * Execution Stream Integration
 *
 * Connects ExecutionStreamClient to executionStore for seamless
 * real-time execution updates in the IDE.
 *
 * Architecture:
 *   Backend Events
 *       │
 *   ExecutionStreamClient
 *       │
 *   useExecutionStreamIntegration ← THIS MODULE
 *       │
 *   executionStore
 *       │
 *   AI Chat Panel / Status Bar / Patch Preview
 *
 * Usage:
 *   // In App.tsx or IdeShell.tsx
 *   function IdeShell() {
 *     useExecutionStreamIntegration({ projectId, workspaceId });
 *     // ... rest of component
 *   }
 */

import { useEffect, useRef, useCallback } from 'react';
import {
  ExecutionStreamClient,
  ExecutionEvent,
  getExecutionStreamClient,
  ConnectionStatus,
} from '../services/executionStream';
import { editorModelManager } from '../core/editor/modelManager';
import { ensureContainer } from '../core/runtime/webcontainerManager';
import { useExecutionStore } from '../state/executionStore';
import { editorManager } from '../core/editor/editorManager';
import { aiDecorations } from '../core/editor/aiDecorations';

// ========================================
// TYPES
// ========================================

export interface ExecutionStreamIntegrationOptions {
  /** Project ID */
  projectId: string;
  /** Workspace ID */
  workspaceId?: string;
  /** User ID */
  userId?: string;
  /** WebSocket URL */
  wsUrl?: string;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Auto-subscribe to workspace events */
  autoSubscribeWorkspace?: boolean;
  /** Enable mock mode (no backend required) */
  mockMode?: boolean;
  /** Callback when task is created */
  onTaskCreated?: (taskId: string) => void;
  /** Callback when task completes */
  onTaskComplete?: (taskId: string) => void;
  /** Callback when task fails */
  onTaskError?: (taskId: string, error: string) => void;
  /** Callback when patch is generated */
  onPatchGenerated?: (taskId: string, patch: unknown) => void;
  /** Callback when file is modified */
  onFileModified?: (taskId: string, filePath: string) => void;
}

// ========================================
// HOOK
// ========================================

/**
 * Hook to integrate ExecutionStreamClient with executionStore
 */
export function useExecutionStreamIntegration(
  options: ExecutionStreamIntegrationOptions
): {
  client: ExecutionStreamClient | null;
  status: ConnectionStatus;
  connect: () => Promise<void>;
  disconnect: () => void;
  subscribeToTask: (taskId: string) => () => void;
  subscribeToWorkspace: (workspaceId: string) => () => void;
} {
  const {
    projectId,
    workspaceId,
    userId = 'default-user',
    wsUrl = 'ws://localhost:8005',
    autoConnect = true,
    autoSubscribeWorkspace = true,
    mockMode = true, // Enable mock mode by default for frontend-only testing
    onTaskCreated,
    onTaskComplete,
    onTaskError,
    onPatchGenerated,
    onFileModified,
  } = options;

  const clientRef = useRef<ExecutionStreamClient | null>(null);

  // Store actions
  const setTask = useExecutionStore((s) => s.setTask);
  const updateTask = useExecutionStore((s) => s.updateTask);
  const addEvent = useExecutionStore((s) => s.addEvent);
  const setConnectionStatus = useExecutionStore((s) => s.setConnectionStatus);
  const addPatchPreview = useExecutionStore((s) => s.addPatchPreview);
  const connectionStatus = useExecutionStore((s) => s.connectionStatus);

  // Apply patch to Monaco Editor and WebContainer
  const applyPatchToEditor = useCallback(async (filePath: string, content: string) => {
    try {
      // Apply to Monaco Editor
      const model = editorModelManager.getOrCreate('', filePath, content);
      if (model) {
        model.setValue(content);
        console.log(`[Patch] Applied to Monaco Editor: ${filePath}`);
      }
      
      // Apply to WebContainer
      try {
        const container = await ensureContainer();
        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dir) {
          try {
            await container.fs.mkdir(dir, { recursive: true });
          } catch (e) {
            // Directory might already exist
          }
        }
        await container.fs.writeFile(filePath, content, 'utf-8');
        console.log(`[Patch] Written to WebContainer: ${filePath}`);
      } catch (e) {
        console.warn('[Patch] Failed to write to WebContainer:', e);
      }
    } catch (e) {
      console.error('[Patch] Failed to apply patch:', e);
    }
  }, []);

  // Handle execution event
  const handleEvent = useCallback(
    (event: ExecutionEvent) => {
      // Add event to store (cast to resolve minor type differences)
      addEvent(event as Parameters<typeof addEvent>[0]);

      // Handle specific event types
      switch (event.type) {
        case 'task.queued': {
          // Create new task in store
          setTask({
            id: event.taskId,
            projectId: event.projectId,
            workspaceId: event.workspaceId,
            conversationId: event.metadata.conversationId ?? null,
            instruction: (event.payload.instruction as string) ?? '',
            status: 'queued',
            progress: 0,
            stage: 'pending',
            stageMessage: 'Task queued',
            createdAt: event.timestamp,
            startedAt: null,
            completedAt: null,
            error: null,
            filesModified: [],
            patchesGenerated: 0,
            rollbackPerformed: false,
            metadata: {
              agent: event.metadata.agent,
              requestId: event.metadata.requestId,
            },
          });
          onTaskCreated?.(event.taskId);
          break;
        }

        case 'task.started': {
          updateTask(event.taskId, {
            status: 'running',
            startedAt: event.timestamp,
            stage: 'execution',
            stageMessage: 'Task started',
          });
          break;
        }

        case 'stage.started': {
          updateTask(event.taskId, {
            stage: mapStage(event.stage),
            stageMessage: event.payload.message as string,
          });
          break;
        }

        case 'stage.completed': {
          updateTask(event.taskId, {
            stage: mapStage(event.stage),
            stageMessage: `${event.stage} completed`,
            progress: event.progress ?? 0,
          });
          break;
        }

        case 'progress.update': {
          updateTask(event.taskId, {
            progress: event.progress ?? 0,
            stageMessage: event.payload.message as string,
          });
          break;
        }

        case 'patch.generated': {
          updateTask(event.taskId, {
            patchesGenerated: (event.payload.count as number) ?? 1,
          });

          // Add patch preview if payload contains patch data
          if (event.payload.patch) {
            const patch = event.payload.patch as {
              id: string;
              filePath: string;
              oldContent: string;
              newContent: string;
            };
            addPatchPreview({
              id: patch.id,
              taskId: event.taskId,
              filePath: patch.filePath,
              oldContent: patch.oldContent,
              newContent: patch.newContent,
              hunks: [],
              status: 'pending',
              createdAt: Date.now(),
            });
            
            // Apply patch to Monaco Editor and WebContainer
            applyPatchToEditor(patch.filePath, patch.newContent);
          }

          onPatchGenerated?.(event.taskId, event.payload.patch);
          break;
        }

        case 'file.modified': {
          const filePath = event.payload.filePath as string;
          updateTask(event.taskId, {
            filesModified: [
              ...new Set([
                ...(useExecutionStore.getState().getTask(event.taskId)?.filesModified ?? []),
                filePath,
              ]),
            ],
          });

          // Highlight file in editor if open
          const editor = editorManager.getEditorForFile(projectId, filePath);
          if (editor) {
            aiDecorations.highlightLine(editor.id, 1, 'modify', 'AI modified this file');
          }

          onFileModified?.(event.taskId, filePath);
          break;
        }

        case 'task.completed': {
          updateTask(event.taskId, {
            status: 'completed',
            completedAt: event.timestamp,
            progress: 100,
            stage: 'completed',
            stageMessage: 'Task completed',
          });
          onTaskComplete?.(event.taskId);
          break;
        }

        case 'task.failed': {
          updateTask(event.taskId, {
            status: 'failed',
            completedAt: event.timestamp,
            error: {
              code: (event.payload.errorCode as string) ?? 'UNKNOWN',
              message: (event.payload.errorMessage as string) ?? 'Task failed',
              stage: event.stage ?? 'unknown',
              recoverable: (event.payload.recoverable as boolean) ?? false,
            },
          });
          onTaskError?.(event.taskId, (event.payload.errorMessage as string) ?? 'Task failed');
          break;
        }

        case 'task.timeout': {
          updateTask(event.taskId, {
            status: 'timeout',
            completedAt: event.timestamp,
            error: {
              code: 'TIMEOUT',
              message: 'Task timed out',
              stage: event.stage ?? 'unknown',
              recoverable: true,
            },
          });
          onTaskError?.(event.taskId, 'Task timed out');
          break;
        }

        case 'task.cancelled': {
          updateTask(event.taskId, {
            status: 'cancelled',
            completedAt: event.timestamp,
          });
          break;
        }

        case 'rollback.completed': {
          updateTask(event.taskId, {
            rollbackPerformed: true,
            stageMessage: 'Rollback completed',
          });
          break;
        }
      }
    },
    [addEvent, setTask, updateTask, addPatchPreview, applyPatchToEditor, projectId, onTaskCreated, onTaskComplete, onTaskError, onPatchGenerated, onFileModified]
  );

  // Initialize client
  useEffect(() => {
    // Always get a fresh client with current options
    clientRef.current = getExecutionStreamClient({
      url: wsUrl,
      projectId,
      userId,
      mockMode,
    });

    return () => {
      // Cleanup on unmount
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [wsUrl, projectId, userId, mockMode]);

  // Subscribe to connection status
  useEffect(() => {
    if (!clientRef.current) return;

    const unsubscribe = clientRef.current.onStatusChange((status) => {
      setConnectionStatus(status as StoreConnectionStatus);
    });

    return unsubscribe;
  }, [setConnectionStatus]);

  // Auto-connect
  useEffect(() => {
    if (!autoConnect || !clientRef.current) return;

    clientRef.current.connect().catch((error) => {
      console.error('[useExecutionStreamIntegration] Connection failed:', error);
    });
  }, [autoConnect]);

  // Auto-subscribe to workspace
  useEffect(() => {
    if (!autoSubscribeWorkspace || !workspaceId || !clientRef.current) return;

    const unsubscribe = clientRef.current.subscribeToWorkspace(workspaceId, {
      onEvent: handleEvent,
      onProgress: handleEvent,
      onPatch: handleEvent,
      onFileModified: handleEvent,
      onComplete: handleEvent,
      onError: handleEvent,
    });

    return unsubscribe;
  }, [autoSubscribeWorkspace, workspaceId, handleEvent]);

  // Connect function
  const connect = useCallback(async () => {
    if (!clientRef.current) return;
    await clientRef.current.connect();
  }, []);

  // Disconnect function
  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  // Subscribe to task function
  const subscribeToTask = useCallback(
    (taskId: string) => {
      if (!clientRef.current) return () => {};
      return clientRef.current.subscribeToTask(taskId, {
        onEvent: handleEvent,
        onProgress: handleEvent,
        onPatch: handleEvent,
        onFileModified: handleEvent,
        onComplete: handleEvent,
        onError: handleEvent,
      });
    },
    [handleEvent]
  );

  // Subscribe to workspace function
  const subscribeToWorkspace = useCallback(
    (wsId: string) => {
      if (!clientRef.current) return () => {};
      return clientRef.current.subscribeToWorkspace(wsId, {
        onEvent: handleEvent,
        onProgress: handleEvent,
        onPatch: handleEvent,
        onFileModified: handleEvent,
        onComplete: handleEvent,
        onError: handleEvent,
      });
    },
    [handleEvent]
  );

  return {
    client: clientRef.current,
    status: connectionStatus as ConnectionStatus,
    connect,
    disconnect,
    subscribeToTask,
    subscribeToWorkspace,
  };
}

// ========================================
// HELPERS
// ========================================

type StoreConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
type StoreExecutionStage = 'pending' | 'planning' | 'execution' | 'validation' | 'application' | 'rollback' | 'completed' | 'failed';

function mapStage(stage?: string): StoreExecutionStage {
  const stageMap: Record<string, StoreExecutionStage> = {
    queued: 'pending',
    planning: 'planning',
    execution: 'execution',
    validation: 'validation',
    application: 'application',
    rollback: 'rollback',
    completed: 'completed',
    failed: 'failed',
  };

  return stageMap[stage ?? ''] ?? 'pending';
}

// ========================================
// PROVIDER COMPONENT
// ========================================

/**
 * Provider component for execution stream integration
 * Wrap your IDE shell with this to enable real-time updates
 */
export function ExecutionStreamProvider({
  children,
  ...options
}: ExecutionStreamIntegrationOptions & { children: React.ReactNode }) {
  useExecutionStreamIntegration(options);
  return <>{children}</>;
}

export default useExecutionStreamIntegration;
