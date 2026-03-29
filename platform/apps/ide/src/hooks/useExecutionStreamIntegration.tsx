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

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  ExecutionStreamClient,
  ExecutionEvent,
  getExecutionStreamClient,
  ConnectionStatus,
} from '../services/executionStream';
import { editorModelManager } from '../core/editor/modelManager';
import { useExecutionStore } from '../state/executionStore';
import { editorManager } from '../core/editor/editorManager';
import { aiDecorations } from '../core/editor/aiDecorations';
import { ideEventBus } from '../stores/ideStore';
import { syncAiFileContent } from '../core/runtime/aiFileSync';

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
    wsUrl = 'ws://localhost:8000/api/v1/ai/ws',
    autoConnect = true,
    autoSubscribeWorkspace = true,
    mockMode = false, // Connect to real backend by default
    onTaskCreated,
    onTaskComplete,
    onTaskError,
    onPatchGenerated,
    onFileModified,
  } = options;

  const [clientInstance, setClientInstance] = useState<ExecutionStreamClient | null>(null);
  const pendingWCWrites = useRef<Map<string, string>>(new Map());

  // Store actions
  const setTask = useExecutionStore((s) => s.setTask);
  const updateTask = useExecutionStore((s) => s.updateTask);
  const addEvent = useExecutionStore((s) => s.addEvent);
  const setConnectionStatus = useExecutionStore((s) => s.setConnectionStatus);
  const addPatchPreview = useExecutionStore((s) => s.addPatchPreview);
  const connectionStatus = useExecutionStore((s) => s.connectionStatus);

  // Apply patch to Monaco Editor AND WebContainer filesystem
  const applyPatchToEditor = useCallback(async (filePath: string, content: string) => {
    // 1. Apply to Monaco Editor (in-memory model)
    try {
      const Monaco = await import('monaco-editor');
      const fileModel = editorModelManager.getOrCreate(Monaco, '', filePath);
      if (fileModel?.model) {
        fileModel.model.setValue(content);
      }
    } catch (e) {
      console.warn('[Patch] Monaco update failed:', e);
    }

    // 2. Write to WebContainer filesystem (so dev server picks up change)
    try {
      const { writeFile } = await import('../core/runtime/webcontainerManager');
      await writeFile(filePath, content);
      console.log(`[Patch] Written to WebContainer: ${filePath}`);
    } catch (e) {
      // WebContainer may not be booted yet — queue for later
      console.warn('[Patch] WebContainer write deferred (not booted):', filePath);
      pendingWCWrites.current.set(filePath, content);
    }
  }, []);

  const syncPatchedFile = useCallback(async (
    filePath: string,
    content: string,
    eventKind: 'created' | 'changed' = 'changed',
  ) => {
    try {
      const Monaco = await import('monaco-editor');
      const fileModel = editorModelManager.getOrCreate(Monaco, '', filePath);
      if (fileModel?.model) {
        fileModel.model.setValue(content);
      }
    } catch (e) {
      console.warn('[Patch] Monaco update failed during AI sync:', e);
    }

    await syncAiFileContent(projectId, filePath, content, {
      event: eventKind,
      updateStore: true,
    });
  }, [projectId]);

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
            
            // Apply patch to Monaco Editor, runtime, and explorer state
            void syncPatchedFile(
              patch.filePath,
              patch.newContent,
              patch.oldContent.length === 0 ? 'created' : 'changed',
            );
          }

          // Handle bulk file sync from syncFiles endpoint (multi-file payload)
          if (event.payload.files && typeof event.payload.files === 'object') {
            const files = event.payload.files as Record<string, string>;
            void Promise.allSettled(
              Object.entries(files).map(([path, content]) =>
                syncAiFileContent(projectId, path, content, {
                  event: 'created',
                  updateStore: true,
                })
              ),
            ).then((results) => {
              const succeeded = results.filter((result) => result.status === 'fulfilled').length;
              console.log(`[Patch] Bulk AI sync: ${succeeded}/${results.length} files written`);
            });
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

          // Emit to event bus (Reactive Sidebar fix)
          ideEventBus.emit('file:changed', { path: filePath });
          ideEventBus.emit('tree:refresh', { path: filePath });

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
    [addEvent, setTask, updateTask, addPatchPreview, projectId, onTaskCreated, onTaskComplete, onTaskError, onPatchGenerated, onFileModified, syncPatchedFile]
  );

  // Initialize client
  useEffect(() => {
    console.log('[useExecutionStreamIntegration] Creating fresh client instance');
    // Always get a fresh client with current options
    const newClient = getExecutionStreamClient({
      url: wsUrl,
      projectId,
      userId,
      mockMode,
    });
    setClientInstance(newClient);

    return () => {
      // Cleanup on unmount
      console.log('[useExecutionStreamIntegration] Cleaning up client instance');
      newClient.disconnect();
    };
  }, [wsUrl, projectId, userId, mockMode]);

  // Subscribe to connection status
  useEffect(() => {
    if (!clientInstance) return;

    const unsubscribe = clientInstance.onStatusChange((status) => {
      setConnectionStatus(status as StoreConnectionStatus);
    });

    return unsubscribe;
  }, [clientInstance, setConnectionStatus]);

  // Auto-connect and re-connect if the client instance changes
  // Guard per-client instance via a local ref to track which client has been connected
  const connectedClientRef = useRef<ExecutionStreamClient | null>(null);
  
  useEffect(() => {
    if (!autoConnect || !clientInstance) return;
    if (connectedClientRef.current === clientInstance) return;

    console.log('[useExecutionStreamIntegration] Auto-connecting client:', clientInstance);
    connectedClientRef.current = clientInstance;

    clientInstance.connect().catch((error) => {
      console.error('[useExecutionStreamIntegration] Connection failed:', error);
      if (connectedClientRef.current === clientInstance) {
        connectedClientRef.current = null; // allow retry
      }
    });
  }, [autoConnect, clientInstance]);

  // Auto-subscribe to workspace
  useEffect(() => {
    if (!autoSubscribeWorkspace || !workspaceId || !clientInstance) return;

    console.log('[useExecutionStreamIntegration] Subscribing to workspace:', workspaceId);
    const unsubscribe = clientInstance.subscribeToWorkspace(workspaceId, {
      onEvent: handleEvent,
      onProgress: handleEvent,
      onPatch: handleEvent,
      onFileModified: handleEvent,
      onComplete: handleEvent,
      onError: handleEvent,
    });

    return unsubscribe;
  }, [autoSubscribeWorkspace, workspaceId, handleEvent, clientInstance]);

  // Drain pending WebContainer writes once container is available
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    
    const drainPending = async () => {
      if (pendingWCWrites.current.size === 0) return;
      
      const { writeBatch } = await import('../core/runtime/webcontainerManager');
      const pending = Object.fromEntries(pendingWCWrites.current);
      pendingWCWrites.current.clear();
      
      const results = await writeBatch(pending);
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        console.warn('[Patch] Some queued WC writes failed:', failed);
      }
    };
    
    drainPending();
  }, [connectionStatus]);

  // Connect function
  const connect = useCallback(async () => {
    if (!clientInstance) return;
    await clientInstance.connect();
  }, [clientInstance]);

  // Disconnect function
  const disconnect = useCallback(() => {
    clientInstance?.disconnect();
  }, [clientInstance]);

  // Subscribe to task function
  const subscribeToTask = useCallback(
    (taskId: string) => {
      if (!clientInstance) return () => {};
      return clientInstance.subscribeToTask(taskId, {
        onEvent: handleEvent,
        onProgress: handleEvent,
        onPatch: handleEvent,
        onFileModified: handleEvent,
        onComplete: handleEvent,
        onError: handleEvent,
      });
    },
    [handleEvent, clientInstance]
  );

  // Subscribe to workspace function
  const subscribeToWorkspace = useCallback(
    (wsId: string) => {
      if (!clientInstance) return () => {};
      return clientInstance.subscribeToWorkspace(wsId, {
        onEvent: handleEvent,
        onProgress: handleEvent,
        onPatch: handleEvent,
        onFileModified: handleEvent,
        onComplete: handleEvent,
        onError: handleEvent,
      });
    },
    [handleEvent, clientInstance]
  );

  return {
    client: clientInstance,
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
