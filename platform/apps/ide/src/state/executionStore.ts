/**
 * Execution Store
 *
 * Zustand store for managing execution task state in the IDE.
 * Connects to ExecutionStreamClient for real-time updates.
 *
 * Responsibilities:
 * - Track active and historical execution tasks
 * - Store execution events for each task
 * - Manage task progress and status
 * - Handle patch previews
 * - Power AI chat panel and execution status bar
 *
 * Architecture:
 *   ExecutionStreamClient
 *         │
 *   executionStore  ← THIS MODULE
 *         │
 *   AI Chat Panel / Status Bar / Patch Preview
 */

import { create } from 'zustand';

// ========================================
// TYPES
// ========================================

export type ExecutionTaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

export type ExecutionStage =
  | 'pending'
  | 'planning'
  | 'execution'
  | 'validation'
  | 'application'
  | 'rollback'
  | 'completed'
  | 'failed';

export type ExecutionEventType =
  // Lifecycle
  | 'task.queued'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.timeout'
  | 'task.cancelled'
  | 'task.retrying'
  // Progress
  | 'stage.started'
  | 'stage.completed'
  | 'progress.update'
  | 'agent.planning'
  | 'agent.generating'
  | 'agent.step'
  // Patch
  | 'patch.generated'
  | 'patch.validating'
  | 'patch.validation_passed'
  | 'patch.validation_failed'
  | 'patch.applying'
  | 'patch.applied'
  | 'file.modified'
  | 'rollback.started'
  | 'rollback.completed';

export interface ExecutionEvent {
  taskId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  type: ExecutionEventType;
  timestamp: number;
  sequence: number;
  stage?: ExecutionStage;
  progress?: number;
  message?: string;
  payload: Record<string, unknown>;
  metadata: {
    agent?: string;
    workflowRunId?: string;
    conversationId?: string;
    requestId?: string;
    workerId?: string;
  };
}

export interface ExecutionTask {
  id: string;
  projectId: string;
  workspaceId: string;
  conversationId: string | null;
  instruction: string;
  status: ExecutionTaskStatus;
  progress: number;
  stage: ExecutionStage;
  stageMessage: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: {
    code: string;
    message: string;
    stage: string;
    recoverable: boolean;
  } | null;
  filesModified: string[];
  patchesGenerated: number;
  rollbackPerformed: boolean;
  metadata: {
    agent?: string;
    workflowStage?: string;
    requestId?: string;
  } | null;
}

export interface PatchPreview {
  id: string;
  taskId: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  hunks: PatchHunk[];
  status: 'pending' | 'accepted' | 'rejected' | 'applied';
  createdAt: number;
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  type: 'add' | 'delete' | 'context';
}

// ========================================
// STORE STATE
// ========================================

// Retention configuration
const RETENTION_CONFIG = {
  maxEventsPerTask: 500,
  maxTasksInMemory: 50,
  eventCompactionThreshold: 300, // Compact when events > threshold
  archiveAfterMs: 3600000, // 1 hour
  maxTotalEvents: 10000, // Global memory guard
  globalCompactionThreshold: 8000, // Trigger compaction at 80%
};

interface ExecutionState {
  // Tasks
  tasks: Map<string, ExecutionTask>;
  activeTaskId: string | null;
  taskIds: string[]; // For iteration

  // Events
  events: Map<string, ExecutionEvent[]>;

  // Patch previews
  patchPreviews: Map<string, PatchPreview>;
  pendingPatches: string[]; // Patch IDs awaiting user action

  // Connection status
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

  // Retention stats
  retentionStats: {
    totalEvents: number;
    totalTasks: number;
    archivedTasks: number;
    lastCompaction: number;
  };

  // Actions - Tasks
  setTask: (task: ExecutionTask) => void;
  updateTask: (taskId: string, updates: Partial<ExecutionTask>) => void;
  setActiveTask: (taskId: string | null) => void;
  removeTask: (taskId: string) => void;
  clearTasks: () => void;

  // Actions - Events
  addEvent: (event: ExecutionEvent) => void;
  setEvents: (taskId: string, events: ExecutionEvent[]) => void;
  clearEvents: (taskId: string) => void;

  // Actions - Patches
  addPatchPreview: (patch: PatchPreview) => void;
  updatePatchStatus: (patchId: string, status: PatchPreview['status']) => void;
  removePatchPreview: (patchId: string) => void;
  clearPatchPreviews: (taskId: string) => void;

  // Actions - Connection
  setConnectionStatus: (status: ExecutionState['connectionStatus']) => void;

  // Actions - Retention
  compactEvents: (taskId: string) => void;
  archiveOldTasks: () => void;
  getRetentionStats: () => ExecutionState['retentionStats'];

  // Computed getters
  getTask: (taskId: string) => ExecutionTask | undefined;
  getActiveTask: () => ExecutionTask | undefined;
  getTaskEvents: (taskId: string) => ExecutionEvent[];
  getLatestEvent: (taskId: string) => ExecutionEvent | undefined;
  getPendingPatches: () => PatchPreview[];
  getTaskPatches: (taskId: string) => PatchPreview[];
}

// ========================================
// STORE IMPLEMENTATION
// ========================================

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  // Initial state
  tasks: new Map(),
  activeTaskId: null,
  taskIds: [],
  events: new Map(),
  patchPreviews: new Map(),
  pendingPatches: [],
  isConnected: false,
  connectionStatus: 'disconnected',
  retentionStats: {
    totalEvents: 0,
    totalTasks: 0,
    archivedTasks: 0,
    lastCompaction: 0,
  },

  // Task actions
  setTask: (task) => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.set(task.id, task);
      return {
        tasks: newTasks,
        taskIds: [...state.taskIds.filter(id => id !== task.id), task.id],
      };
    });
  },

  updateTask: (taskId, updates) => {
    set((state) => {
      const task = state.tasks.get(taskId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      newTasks.set(taskId, { ...task, ...updates });
      return { tasks: newTasks };
    });
  },

  setActiveTask: (taskId) => {
    set({ activeTaskId: taskId });
  },

  removeTask: (taskId) => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.delete(taskId);
      return {
        tasks: newTasks,
        taskIds: state.taskIds.filter(id => id !== taskId),
        activeTaskId: state.activeTaskId === taskId ? null : state.activeTaskId,
      };
    });
  },

  clearTasks: () => {
    set({
      tasks: new Map(),
      taskIds: [],
      activeTaskId: null,
      events: new Map(),
    });
  },

  // Event actions
  addEvent: (event) => {
    set((state) => {
      const taskEvents = state.events.get(event.taskId) ?? [];

      // Check for duplicate
      if (taskEvents.some(e => e.sequence === event.sequence)) {
        return state;
      }

      const newEvents = new Map(state.events);
      newEvents.set(event.taskId, [...taskEvents, event].sort((a, b) => a.sequence - b.sequence));

      // Calculate total events for memory guard
      let totalEvents = 0;
      for (const evts of newEvents.values()) {
        totalEvents += evts.length;
      }

      // Global memory guard - trigger compaction if exceeded
      if (totalEvents > RETENTION_CONFIG.globalCompactionThreshold) {
        console.warn(`[ExecutionStore] Memory guard triggered: ${totalEvents} events exceeds threshold ${RETENTION_CONFIG.globalCompactionThreshold}`);

        // Compact all tasks
        for (const [taskId, evts] of newEvents) {
          if (evts.length > RETENTION_CONFIG.eventCompactionThreshold) {
            const compacted = evts.slice(-RETENTION_CONFIG.maxEventsPerTask);
            newEvents.set(taskId, compacted);
          }
        }

        // Recalculate total events after compaction
        totalEvents = 0;
        for (const evts of newEvents.values()) {
          totalEvents += evts.length;
        }
      }

      // Update retention stats
      const retentionStats = {
        ...state.retentionStats,
        totalEvents,
        totalTasks: state.tasks.size,
      };

      // Update task based on event
      const task = state.tasks.get(event.taskId);
      if (task) {
        const newTasks = new Map(state.tasks);
        const updates: Partial<ExecutionTask> = {
          progress: event.progress ?? task.progress,
          stage: event.stage ?? task.stage,
          stageMessage: event.message ?? task.stageMessage,
        };

        // Handle specific event types
        switch (event.type) {
          case 'task.started':
            updates.status = 'running';
            updates.startedAt = event.timestamp;
            break;
          case 'task.completed':
            updates.status = 'completed';
            updates.completedAt = event.timestamp;
            updates.progress = 100;
            break;
          case 'task.failed':
            updates.status = 'failed';
            updates.completedAt = event.timestamp;
            if (event.payload.error) {
              updates.error = event.payload.error as ExecutionTask['error'];
            }
            break;
          case 'task.timeout':
            updates.status = 'timeout';
            updates.completedAt = event.timestamp;
            break;
          case 'task.cancelled':
            updates.status = 'cancelled';
            updates.completedAt = event.timestamp;
            break;
          case 'file.modified':
            updates.filesModified = [
              ...new Set([...task.filesModified, event.payload.filePath as string]),
            ];
            break;
          case 'patch.generated':
            updates.patchesGenerated = task.patchesGenerated + 1;
            break;
          case 'rollback.completed':
            updates.rollbackPerformed = true;
            break;
        }

        newTasks.set(event.taskId, { ...task, ...updates });
        return { events: newEvents, tasks: newTasks, retentionStats };
      }

      return { events: newEvents, retentionStats };
    });
  },

  setEvents: (taskId, events) => {
    set((state) => {
      const newEvents = new Map(state.events);
      newEvents.set(taskId, events.sort((a, b) => a.sequence - b.sequence));
      return { events: newEvents };
    });
  },

  clearEvents: (taskId) => {
    set((state) => {
      const newEvents = new Map(state.events);
      newEvents.delete(taskId);
      return { events: newEvents };
    });
  },

  // Patch actions
  addPatchPreview: (patch) => {
    set((state) => {
      const newPatches = new Map(state.patchPreviews);
      newPatches.set(patch.id, patch);
      return {
        patchPreviews: newPatches,
        pendingPatches: patch.status === 'pending'
          ? [...state.pendingPatches, patch.id]
          : state.pendingPatches,
      };
    });
  },

  updatePatchStatus: (patchId, status) => {
    set((state) => {
      const patch = state.patchPreviews.get(patchId);
      if (!patch) return state;

      const newPatches = new Map(state.patchPreviews);
      newPatches.set(patchId, { ...patch, status });

      return {
        patchPreviews: newPatches,
        pendingPatches: status !== 'pending'
          ? state.pendingPatches.filter(id => id !== patchId)
          : state.pendingPatches,
      };
    });
  },

  removePatchPreview: (patchId) => {
    set((state) => {
      const newPatches = new Map(state.patchPreviews);
      newPatches.delete(patchId);
      return {
        patchPreviews: newPatches,
        pendingPatches: state.pendingPatches.filter(id => id !== patchId),
      };
    });
  },

  clearPatchPreviews: (taskId) => {
    set((state) => {
      const newPatches = new Map(state.patchPreviews);
      let pendingToRemove: string[] = [];

      for (const [id, patch] of newPatches) {
        if (patch.taskId === taskId) {
          newPatches.delete(id);
          if (patch.status === 'pending') {
            pendingToRemove.push(id);
          }
        }
      }

      return {
        patchPreviews: newPatches,
        pendingPatches: state.pendingPatches.filter(id => !pendingToRemove.includes(id)),
      };
    });
  },

  // Connection actions
  setConnectionStatus: (status) => {
    set({
      connectionStatus: status,
      isConnected: status === 'connected',
    });
  },

  // Computed getters
  getTask: (taskId) => {
    return get().tasks.get(taskId);
  },

  getActiveTask: () => {
    const state = get();
    if (!state.activeTaskId) return undefined;
    return state.tasks.get(state.activeTaskId);
  },

  getTaskEvents: (taskId) => {
    return get().events.get(taskId) ?? [];
  },

  getLatestEvent: (taskId) => {
    const events = get().events.get(taskId);
    if (!events || events.length === 0) return undefined;
    return events[events.length - 1];
  },

  getPendingPatches: () => {
    const state = get();
    return state.pendingPatches
      .map(id => state.patchPreviews.get(id))
      .filter((p): p is PatchPreview => p !== undefined);
  },

  getTaskPatches: (taskId) => {
    const patches = get().patchPreviews;
    return [...patches.values()].filter(p => p.taskId === taskId);
  },

  // Retention actions
  compactEvents: (taskId) => {
    set((state) => {
      const events = state.events.get(taskId);
      if (!events || events.length <= RETENTION_CONFIG.eventCompactionThreshold) {
        return state;
      }

      // Keep only the most recent events
      const compacted = events.slice(-RETENTION_CONFIG.maxEventsPerTask);
      const newEvents = new Map(state.events);
      newEvents.set(taskId, compacted);

      // Calculate total events
      let totalEvents = 0;
      for (const evts of newEvents.values()) {
        totalEvents += evts.length;
      }

      return {
        events: newEvents,
        retentionStats: {
          ...state.retentionStats,
          totalEvents,
          lastCompaction: Date.now(),
        },
      };
    });
  },

  archiveOldTasks: () => {
    set((state) => {
      const now = Date.now();
      const toArchive: string[] = [];

      // Find tasks to archive
      for (const [id, task] of state.tasks) {
        // Don't archive active task
        if (id === state.activeTaskId) continue;

        // Don't archive running tasks
        if (task.status === 'running' || task.status === 'queued') continue;

        // Archive if older than threshold
        if (task.completedAt && (now - task.completedAt) > RETENTION_CONFIG.archiveAfterMs) {
          toArchive.push(id);
        }
      }

      // Check max tasks limit
      if (state.tasks.size - toArchive.length > RETENTION_CONFIG.maxTasksInMemory) {
        const additionalToArchive = state.taskIds
          .filter(id => !toArchive.includes(id) && id !== state.activeTaskId)
          .slice(0, state.tasks.size - RETENTION_CONFIG.maxTasksInMemory);
        toArchive.push(...additionalToArchive);
      }

      if (toArchive.length === 0) return state;

      // Remove archived tasks
      const newTasks = new Map(state.tasks);
      const newEvents = new Map(state.events);
      const newPatches = new Map(state.patchPreviews);

      for (const id of toArchive) {
        newTasks.delete(id);
        newEvents.delete(id);

        // Remove patches for this task
        for (const [patchId, patch] of newPatches) {
          if (patch.taskId === id) {
            newPatches.delete(patchId);
          }
        }
      }

      // Calculate total events
      let totalEvents = 0;
      for (const evts of newEvents.values()) {
        totalEvents += evts.length;
      }

      return {
        tasks: newTasks,
        taskIds: state.taskIds.filter(id => !toArchive.includes(id)),
        events: newEvents,
        patchPreviews: newPatches,
        pendingPatches: state.pendingPatches.filter(id => {
          const patch = newPatches.get(id);
          return patch !== undefined;
        }),
        retentionStats: {
          totalEvents,
          totalTasks: newTasks.size,
          archivedTasks: state.retentionStats.archivedTasks + toArchive.length,
          lastCompaction: state.retentionStats.lastCompaction,
        },
      };
    });
  },

  getRetentionStats: () => {
    return get().retentionStats;
  },
}));

// ========================================
// SELECTORS
// ========================================

/** Select all running tasks */
export const selectRunningTasks = (state: ExecutionState): ExecutionTask[] => {
  return state.taskIds
    .map(id => state.tasks.get(id))
    .filter((t): t is ExecutionTask => t !== undefined && t.status === 'running');
};

/** Select all completed tasks */
export const selectCompletedTasks = (state: ExecutionState): ExecutionTask[] => {
  return state.taskIds
    .map(id => state.tasks.get(id))
    .filter((t): t is ExecutionTask => t !== undefined && t.status === 'completed');
};

/** Select tasks by project */
export const selectTasksByProject = (projectId: string) => (state: ExecutionState): ExecutionTask[] => {
  return state.taskIds
    .map(id => state.tasks.get(id))
    .filter((t): t is ExecutionTask => t !== undefined && t.projectId === projectId);
};

/** Check if any task is running */
export const selectIsAnyTaskRunning = (state: ExecutionState): boolean => {
  return state.taskIds.some(id => {
    const task = state.tasks.get(id);
    return task?.status === 'running' || task?.status === 'queued';
  });
};

/** Get execution status for status bar */
export const selectExecutionStatus = (state: ExecutionState): {
  status: 'idle' | 'running' | 'completed' | 'failed';
  message: string;
  progress: number;
} => {
  const activeTask = state.activeTaskId ? state.tasks.get(state.activeTaskId) : undefined;

  if (!activeTask) {
    return { status: 'idle', message: 'AI Idle', progress: 0 };
  }

  switch (activeTask.status) {
    case 'queued':
      return { status: 'running', message: 'Task Queued', progress: 0 };
    case 'running':
      return {
        status: 'running',
        message: activeTask.stageMessage ?? `${activeTask.stage}...`,
        progress: activeTask.progress,
      };
    case 'completed':
      return { status: 'completed', message: 'Completed', progress: 100 };
    case 'failed':
      return { status: 'failed', message: activeTask.error?.message ?? 'Failed', progress: 0 };
    case 'timeout':
      return { status: 'failed', message: 'Timed Out', progress: 0 };
    case 'cancelled':
      return { status: 'idle', message: 'Cancelled', progress: 0 };
    default:
      return { status: 'idle', message: 'AI Idle', progress: 0 };
  }
};
