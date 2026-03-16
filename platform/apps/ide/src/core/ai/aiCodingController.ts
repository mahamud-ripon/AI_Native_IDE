/**
 * AI Coding Controller
 *
 * Central orchestration layer for AI coding operations.
 * Coordinates between UI, stores, editor, and execution stream.
 *
 * Responsibilities:
 * - Manage AI task lifecycle
 * - Coordinate patch previews
 * - Apply decorations
 * - Track execution progress
 * - Control editor interactions
 * - Handle errors and rollbacks
 *
 * Architecture:
 *   UI Components (Chat, PatchPreview)
 *           │
 *   aiCodingController ← THIS MODULE
 *           │
 *   ├── executionStore (state)
 *   ├── aiChatStore (state)
 *   ├── EditorManager (editor)
 *   ├── aiDecorations (visual)
 *   ├── patchValidator (safety)
 *   └── executionStream (events)
 */

import { editorManager, TextPatch } from '../editor/editorManager';
import { aiDecorations } from '../editor/aiDecorations';
import { patchValidator, ValidationResult } from '../editor/patchValidator';
import { useExecutionStore } from '../../state/executionStore';
import { useAIChatStore } from '../../state/aiChatStore';

// ========================================
// TYPES
// ========================================

/** Controller workflow states */
export type WorkflowState =
  | 'IDLE'
  | 'ANALYZING_WORKSPACE'
  | 'GENERATING_PATCH'
  | 'VALIDATING_PATCH'
  | 'APPLYING_PATCH'
  | 'EXECUTING_CODE'
  | 'COMPLETED'
  | 'FAILED';

/** State transitions */
const WORKFLOW_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  IDLE: ['ANALYZING_WORKSPACE'],
  ANALYZING_WORKSPACE: ['GENERATING_PATCH', 'FAILED'],
  GENERATING_PATCH: ['VALIDATING_PATCH', 'FAILED'],
  VALIDATING_PATCH: ['APPLYING_PATCH', 'FAILED'],
  APPLYING_PATCH: ['EXECUTING_CODE', 'COMPLETED', 'FAILED'],
  EXECUTING_CODE: ['COMPLETED', 'FAILED'],
  COMPLETED: ['IDLE'],
  FAILED: ['IDLE'],
};

export interface AICodingSession {
  id: string;
  projectId: string;
  workspaceId: string;
  conversationId: string;
  taskId: string | null;
  workflowState: WorkflowState;
  status: 'idle' | 'planning' | 'executing' | 'applying' | 'completed' | 'failed';
  patches: PatchHandle[];
  createdAt: number;
  updatedAt: number;
  stateHistory: { state: WorkflowState; timestamp: number; reason?: string }[];
}

export interface PatchHandle {
  id: string;
  taskId: string;
  filePath: string;
  status: 'pending' | 'validated' | 'accepted' | 'rejected' | 'applied' | 'failed';
  validation: ValidationResult | null;
  patch: TextPatch;
}

export interface SubmitTaskOptions {
  instruction: string;
  projectId: string;
  workspaceId: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface ApplyPatchOptions {
  force?: boolean;
  showDecorations?: boolean;
}

// ========================================
// CONTROLLER CLASS
// ========================================

class AICodingController {
  private sessions = new Map<string, AICodingSession>();
  private activeSessionId: string | null = null;
  private eventSubscriptions: Map<string, () => void> = new Map();

  // State machine callbacks
  private stateChangeCallbacks = new Set<(sessionId: string, state: WorkflowState, previousState: WorkflowState) => void>();

  // ========================================
  // STATE MACHINE
  // ========================================

  /**
   * Transition workflow state (enforces valid transitions)
   */
  private transitionState(sessionId: string, newState: WorkflowState, reason?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const currentState = session.workflowState;
    const allowedTransitions = WORKFLOW_TRANSITIONS[currentState];

    if (!allowedTransitions.includes(newState)) {
      console.warn(
        `[AICodingController] Invalid state transition: ${currentState} -> ${newState}`,
        `Allowed: ${allowedTransitions.join(', ')}`
      );
      return false;
    }

    // Record transition
    session.workflowState = newState;
    session.stateHistory.push({
      state: newState,
      timestamp: Date.now(),
      reason,
    });
    session.updatedAt = Date.now();

    // Update legacy status for compatibility
    session.status = this.mapWorkflowToStatus(newState);

    // Notify listeners
    this.stateChangeCallbacks.forEach(cb => {
      try {
        cb(sessionId, newState, currentState);
      } catch (error) {
        console.error('[AICodingController] State change callback error:', error);
      }
    });

    console.log(`[AICodingController] State transition: ${currentState} -> ${newState}${reason ? ` (${reason})` : ''}`);
    return true;
  }

  /**
   * Map workflow state to legacy status
   */
  private mapWorkflowToStatus(state: WorkflowState): AICodingSession['status'] {
    switch (state) {
      case 'IDLE': return 'idle';
      case 'ANALYZING_WORKSPACE': return 'planning';
      case 'GENERATING_PATCH': return 'planning';
      case 'VALIDATING_PATCH': return 'planning';
      case 'APPLYING_PATCH': return 'applying';
      case 'EXECUTING_CODE': return 'executing';
      case 'COMPLETED': return 'completed';
      case 'FAILED': return 'failed';
    }
  }

  /**
   * Get current workflow state
   */
  getWorkflowState(sessionId: string): WorkflowState | null {
    const session = this.sessions.get(sessionId);
    return session?.workflowState ?? null;
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(callback: (sessionId: string, state: WorkflowState, previousState: WorkflowState) => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  /**
   * Force state (for recovery scenarios)
   */
  forceState(sessionId: string, newState: WorkflowState, reason?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const currentState = session.workflowState;
    session.workflowState = newState;
    session.stateHistory.push({ state: newState, timestamp: Date.now(), reason: reason ?? 'forced' });
    session.updatedAt = Date.now();
    session.status = this.mapWorkflowToStatus(newState);

    this.stateChangeCallbacks.forEach(cb => {
      try {
        cb(sessionId, newState, currentState);
      } catch (error) {
        console.error('[AICodingController] State change callback error:', error);
      }
    });

    console.warn(`[AICodingController] Forced state transition: ${currentState} -> ${newState}`);
  }

  // ========================================
  // SESSION MANAGEMENT
  // ========================================

  /**
   * Create a new AI coding session
   */
  createSession(projectId: string, workspaceId: string): string {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conversationId = useAIChatStore.getState().createConversation(projectId, workspaceId);

    const session: AICodingSession = {
      id,
      projectId,
      workspaceId,
      conversationId,
      taskId: null,
      workflowState: 'IDLE',
      status: 'idle',
      patches: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stateHistory: [{ state: 'IDLE', timestamp: Date.now() }],
    };

    this.sessions.set(id, session);
    this.activeSessionId = id;

    return id;
  }

  /**
   * Get active session
   */
  getActiveSession(): AICodingSession | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) ?? null;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): AICodingSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Close session
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Cleanup event subscriptions
    const unsub = this.eventSubscriptions.get(sessionId);
    if (unsub) {
      unsub();
      this.eventSubscriptions.delete(sessionId);
    }

    // Clear decorations
    for (const patch of session.patches) {
      const editor = editorManager.getEditorForFile(session.projectId, patch.filePath);
      if (editor) {
        aiDecorations.clearChanges(editor.id);
      }
    }

    this.sessions.delete(sessionId);

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  // ========================================
  // CRASH RECOVERY
  // ========================================

  /**
   * Restore session from a task ID (crash recovery)
   * Used after page reload or WebSocket interruption
   */
  async restoreSession(taskId: string): Promise<AICodingSession | null> {
    // Check if task exists in execution store
    const task = useExecutionStore.getState().tasks.get(taskId);
    if (!task) {
      console.warn(`[AICodingController] Cannot restore session: task ${taskId} not found`);
      return null;
    }

    // Check if session already exists for this task
    for (const session of this.sessions.values()) {
      if (session.taskId === taskId) {
        console.log(`[AICodingController] Session already exists for task ${taskId}`);
        return session;
      }
    }

    // Create new session for recovery
    const id = `session-recovered-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Reconstruct workflow state from task status
    const workflowState = this.inferWorkflowState(task.status);

    const session: AICodingSession = {
      id,
      projectId: task.projectId,
      workspaceId: task.workspaceId ?? 'default-workspace',
      conversationId: `recovered-${taskId}`,
      taskId,
      workflowState,
      status: this.mapWorkflowToStatus(workflowState),
      patches: [],
      createdAt: task.createdAt,
      updatedAt: Date.now(),
      stateHistory: [
        { state: 'IDLE', timestamp: task.createdAt },
        { state: workflowState, timestamp: Date.now(), reason: 'recovered' },
      ],
    };

    this.sessions.set(id, session);
    this.activeSessionId = id;

    // Resubscribe to execution stream for this task
    this.subscribeToTaskEvents(id, taskId);

    // Restore decorations for modified files
    await this.restoreDecorations(session, task.filesModified);

    console.log(`[AICodingController] Restored session ${id} for task ${taskId}, state: ${workflowState}`);

    return session;
  }

  /**
   * Infer workflow state from task status
   */
  private inferWorkflowState(status: string): WorkflowState {
    switch (status) {
      case 'pending':
      case 'queued':
        return 'ANALYZING_WORKSPACE';
      case 'running':
        return 'VALIDATING_PATCH';
      case 'completed':
        return 'COMPLETED';
      case 'failed':
      case 'timeout':
      case 'cancelled':
        return 'FAILED';
      default:
        return 'IDLE';
    }
  }

  /**
   * Restore decorations for modified files
   */
  private async restoreDecorations(session: AICodingSession, filesModified: string[]): Promise<void> {
    for (const filePath of filesModified) {
      const editor = editorManager.getEditorForFile(session.projectId, filePath);
      if (editor && session.taskId) {
        // Add scoped decorations for this task
        editorManager.addDecorationsScoped(session.taskId, editor.id, [{
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
          options: {
            isWholeLine: true,
            className: 'ai-change-modify',
            glyphMarginClassName: 'ai-glyph-modify',
            hoverMessage: 'AI modified this file (recovered)',
          },
        }]);
      }
    }
  }

  /**
   * Recover active session from storage (called on app init)
   */
  async recoverActiveSession(): Promise<AICodingSession | null> {
    // Check for active task in execution store
    const store = useExecutionStore.getState();
    const activeTaskId = store.activeTaskId;

    if (!activeTaskId) {
      // Check for any running tasks
      for (const [taskId, task] of store.tasks) {
        if (task.status === 'running' || task.status === 'queued') {
          console.log(`[AICodingController] Found running task ${taskId} to recover`);
          return this.restoreSession(taskId);
        }
      }
      return null;
    }

    return this.restoreSession(activeTaskId);
  }

  /**
   * Get all recoverable sessions
   */
  getRecoverableSessions(): Array<{ taskId: string; status: string; projectId: string }> {
    const store = useExecutionStore.getState();
    const recoverable: Array<{ taskId: string; status: string; projectId: string }> = [];

    for (const [taskId, task] of store.tasks) {
      // Only recover running or recently completed tasks
      if (task.status === 'running' || task.status === 'queued' ||
          (task.status === 'completed' && task.completedAt && Date.now() - task.completedAt < 300000)) {
        recoverable.push({
          taskId,
          status: task.status,
          projectId: task.projectId,
        });
      }
    }

    return recoverable;
  }

  // ========================================
  // TASK SUBMISSION
  // ========================================

  /**
   * Submit an AI coding task
   */
  async submitTask(options: SubmitTaskOptions): Promise<string> {
    const session = this.getActiveSession();
    if (!session) {
      throw new Error('No active session. Create a session first.');
    }

    // Transition to ANALYZING_WORKSPACE
    if (!this.transitionState(session.id, 'ANALYZING_WORKSPACE', 'task submitted')) {
      throw new Error('Cannot submit task in current state');
    }

    // Add user message to chat
    useAIChatStore.getState().addMessage(session.conversationId, {
      role: 'user',
      content: options.instruction,
      status: 'complete',
    });

    // Set sending state
    useAIChatStore.getState().setIsSending(true);

    try {
      // Submit to execution API
      const response = await fetch('/api/ai/execution/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: options.projectId,
          workspaceId: options.workspaceId,
          instruction: options.instruction,
          metadata: {
            agent: 'ai-coding-controller',
            conversationId: session.conversationId,
            ...options.metadata,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const taskId = data.taskId;

      // Update session
      session.taskId = taskId;

      // Transition to GENERATING_PATCH
      this.transitionState(session.id, 'GENERATING_PATCH', 'task accepted');

      // Associate task with conversation
      useAIChatStore.getState().associateTask(session.conversationId, taskId);

      // Add pending assistant message
      useAIChatStore.getState().addMessage(session.conversationId, {
        role: 'assistant',
        content: 'Starting execution...',
        taskId,
        status: 'pending',
      });

      // Subscribe to task events
      this.subscribeToTaskEvents(session.id, taskId);

      useAIChatStore.getState().setIsSending(false);

      return taskId;
    } catch (error) {
      session.status = 'failed';
      session.updatedAt = Date.now();

      useAIChatStore.getState().addMessage(session.conversationId, {
        role: 'system',
        content: `Failed to submit task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        status: 'error',
      });

      useAIChatStore.getState().setIsSending(false);

      throw error;
    }
  }

  // ========================================
  // EVENT HANDLING
  // ========================================

  /**
   * Subscribe to task events
   */
  private subscribeToTaskEvents(sessionId: string, taskId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Subscribe to execution store updates
    const unsubscribe = useExecutionStore.subscribe((state, prevState) => {
      const task = state.tasks.get(taskId);
      const prevTask = prevState.tasks.get(taskId);

      if (!task) return;

      // Handle status changes
      if (task.status !== prevTask?.status) {
        this.handleTaskStatusChange(sessionId, task);
      }

      // Handle new patches
      const taskPatches = state.patchPreviews;
      const prevTaskPatches = prevState.patchPreviews;
      const newPatches: Array<{ id: string; taskId: string; filePath: string }> = [];
      
      for (const [id, patch] of taskPatches) {
        if (patch.taskId === taskId && !prevTaskPatches.has(id)) {
          newPatches.push({ id, taskId: patch.taskId, filePath: patch.filePath });
        }
      }
      
      if (newPatches.length > 0) {
        this.handleNewPatches(sessionId, newPatches);
      }

      // Handle file modifications
      if (task.filesModified.length > (prevTask?.filesModified.length ?? 0)) {
        this.handleFileModifications(sessionId, task.filesModified);
      }
    });

    this.eventSubscriptions.set(sessionId, unsubscribe);
  }

  /**
   * Handle task status change
   */
  private handleTaskStatusChange(
    sessionId: string,
    task: { id: string; status: string; filesModified: string[]; patchesGenerated: number; error?: { message: string } | null }
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || !task) return;

    switch (task.status) {
      case 'running':
        // Stay in current state or transition to VALIDATING_PATCH
        if (session.workflowState === 'GENERATING_PATCH') {
          this.transitionState(sessionId, 'VALIDATING_PATCH', 'task running');
        }
        break;
      case 'completed':
        this.transitionState(sessionId, 'COMPLETED', 'task completed');
        this.updateAssistantMessage(session, task);
        // Clear decorations for this task
        if (session.taskId) {
          editorManager.clearDecorationsForTask(session.taskId);
        }
        break;
      case 'failed':
      case 'timeout':
        this.transitionState(sessionId, 'FAILED', `task ${task.status}`);
        this.updateAssistantMessage(session, task);
        break;
    }

    session.updatedAt = Date.now();
  }

  /**
   * Update assistant message with task result
   */
  private updateAssistantMessage(session: AICodingSession, task: {
    id: string;
    status: string;
    filesModified: string[];
    patchesGenerated: number;
    error?: { message: string } | null;
  }): void {
    const content = task.status === 'completed'
      ? `✅ Task completed\n\nModified ${task.filesModified.length} files with ${task.patchesGenerated} patches.`
      : `❌ Task failed\n\n${task.error?.message ?? 'Unknown error'}`;

    const messages = useAIChatStore.getState().getMessages(session.conversationId);
    const assistantMsg = messages.find((m: { taskId?: string; role: string }) => m.taskId === task.id && m.role === 'assistant');

    if (assistantMsg) {
      useAIChatStore.getState().updateMessage(session.conversationId, assistantMsg.id, {
        content,
        status: task.status === 'completed' ? 'complete' : 'error',
        metadata: {
          filesModified: task.filesModified,
          patchesGenerated: task.patchesGenerated,
        },
      });
    }
  }

  /**
   * Handle new patches generated
   */
  private handleNewPatches(sessionId: string, patches: Array<{ id: string; taskId: string; filePath: string }>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const patch of patches) {
      // Validate patch
      const validation = patchValidator.validate({
        projectId: session.projectId,
        filePath: patch.filePath,
        patch: {
          filePath: patch.filePath,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 1,
          newText: '',
          source: 'ai',
          patchId: patch.id,
        },
      });

      // Add to session patches
      session.patches.push({
        id: patch.id,
        taskId: patch.taskId,
        filePath: patch.filePath,
        status: validation.valid ? 'validated' : 'pending',
        validation,
        patch: {
          filePath: patch.filePath,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 1,
          newText: '',
          source: 'ai',
          patchId: patch.id,
        },
      });
    }

    session.updatedAt = Date.now();
  }

  /**
   * Handle file modifications
   */
  private handleFileModifications(sessionId: string, files: string[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Add decorations to modified files
    for (const filePath of files) {
      const editor = editorManager.getEditorForFile(session.projectId, filePath);
      if (editor) {
        aiDecorations.highlightLine(editor.id, 1, 'modify', 'AI modified this file');
      }
    }
  }

  // ========================================
  // PATCH OPERATIONS
  // ========================================

  /**
   * Validate a patch
   */
  validatePatch(sessionId: string, patchId: string): ValidationResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        valid: false,
        errors: [{ code: 'SESSION_NOT_FOUND', message: 'Session not found' }],
        warnings: [],
        canForceApply: false,
      };
    }

    const patchHandle = session.patches.find(p => p.id === patchId);
    if (!patchHandle) {
      return {
        valid: false,
        errors: [{ code: 'PATCH_NOT_FOUND', message: 'Patch not found' }],
        warnings: [],
        canForceApply: false,
      };
    }

    const validation = patchValidator.validate({
      projectId: session.projectId,
      filePath: patchHandle.filePath,
      patch: patchHandle.patch,
    });

    patchHandle.validation = validation;
    patchHandle.status = validation.valid ? 'validated' : 'pending';

    return validation;
  }

  /**
   * Apply a patch
   */
  async applyPatch(sessionId: string, patchId: string, options: ApplyPatchOptions = {}): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const patchHandle = session.patches.find(p => p.id === patchId);
    if (!patchHandle) return false;

    // Validate if not already validated
    if (!patchHandle.validation) {
      patchHandle.validation = this.validatePatch(sessionId, patchId);
    }

    // Check if can apply
    if (!patchHandle.validation.valid && !options.force && !patchHandle.validation.canForceApply) {
      console.error('[AICodingController] Patch validation failed:', patchHandle.validation.errors);
      return false;
    }

    // Apply via EditorManager
    const success = editorManager.applyPatch(patchHandle.patch);

    if (success) {
      patchHandle.status = 'applied';
      session.status = 'applying';
      session.updatedAt = Date.now();

      // Add decorations if requested
      if (options.showDecorations !== false) {
        const editor = editorManager.getEditorForFile(session.projectId, patchHandle.filePath);
        if (editor) {
          aiDecorations.highlightChanges(editor.id, [{
            startLine: patchHandle.patch.startLine,
            endLine: patchHandle.patch.endLine,
            type: 'add',
            hoverMessage: 'AI applied this change',
          }]);
        }
      }
    } else {
      patchHandle.status = 'failed';
    }

    return success;
  }

  /**
   * Reject a patch
   */
  rejectPatch(sessionId: string, patchId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const patchHandle = session.patches.find(p => p.id === patchId);
    if (!patchHandle) return;

    patchHandle.status = 'rejected';
    session.updatedAt = Date.now();

    // Update execution store
    useExecutionStore.getState().updatePatchStatus(patchId, 'rejected');
  }

  /**
   * Apply all validated patches
   */
  async applyAllPatches(sessionId: string): Promise<{ applied: string[]; failed: string[] }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { applied: [], failed: [] };

    const applied: string[] = [];
    const failed: string[] = [];

    for (const patchHandle of session.patches) {
      if (patchHandle.status === 'validated' || patchHandle.status === 'pending') {
        const success = await this.applyPatch(sessionId, patchHandle.id);
        if (success) {
          applied.push(patchHandle.id);
        } else {
          failed.push(patchHandle.id);
        }
      }
    }

    return { applied, failed };
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  /**
   * Get pending patches for session
   */
  getPendingPatches(sessionId: string): PatchHandle[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return session.patches.filter(p => p.status === 'pending' || p.status === 'validated');
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): AICodingSession['status'] | null {
    const session = this.sessions.get(sessionId);
    return session?.status ?? null;
  }

  /**
   * Check if session is busy
   */
  isSessionBusy(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    return ['planning', 'executing', 'applying'].includes(session.status);
  }

  /**
   * Cancel active task
   */
  async cancelTask(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.taskId) return false;

    try {
      const response = await fetch(`/api/ai/execution/tasks/${session.taskId}/cancel`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      session.status = 'failed';
      session.updatedAt = Date.now();

      return true;
    } catch (error) {
      console.error('[AICodingController] Failed to cancel task:', error);
      return false;
    }
  }

  /**
   * Dispose all sessions
   */
  dispose(): void {
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const aiCodingController = new AICodingController();

// ========================================
// REACT HOOK
// ========================================

/**
 * Hook to access AI coding controller
 */
export function useAICodingController() {
  return aiCodingController;
}

/**
 * Hook for active session state
 */
export function useActiveSession() {
  return aiCodingController.getActiveSession();
}

/**
 * Hook for pending patches
 */
export function usePendingPatches(sessionId: string | null) {
  if (!sessionId) return [];
  return aiCodingController.getPendingPatches(sessionId);
}

export default aiCodingController;
