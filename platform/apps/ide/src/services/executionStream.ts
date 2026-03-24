/**
 * Execution Stream Client
 *
 * WebSocket client for subscribing to execution events from the IDE.
 * Provides real-time progress updates for AI coding tasks.
 *
 * Architecture:
 *   IDE (Frontend) → WebSocket → AI Service → Kafka → Execution Worker
 *
 * Features:
 *   - Subscribe to task events
 *   - Subscribe to workspace events
 *   - Event replay on reconnect
 *   - Automatic reconnection
 *   - Typed event handling
 */

// ========================================
// TYPES
// ========================================

/**
 * Execution event types (matches backend)
 */
export type LifecycleEventType =
  | 'task.queued'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.timeout'
  | 'task.cancelled'
  | 'task.retrying';

export type ProgressEventType =
  | 'stage.started'
  | 'stage.completed'
  | 'progress.update'
  | 'agent.planning'
  | 'agent.generating'
  | 'agent.step';

export type PatchEventType =
  | 'patch.generated'
  | 'patch.validating'
  | 'patch.validation_passed'
  | 'patch.validation_failed'
  | 'patch.applying'
  | 'patch.applied'
  | 'file.modified'
  | 'rollback.started'
  | 'rollback.completed';

export type ExecutionEventType = LifecycleEventType | ProgressEventType | PatchEventType;

export type ExecutionStage =
  | 'queued'
  | 'planning'
  | 'execution'
  | 'validation'
  | 'application'
  | 'rollback'
  | 'completed'
  | 'failed';

/**
 * Base execution event
 */
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
  payload: Record<string, unknown>;
  metadata: {
    agent?: string;
    workflowRunId?: string;
    conversationId?: string;
    requestId?: string;
    workerId?: string;
  };
}

/**
 * Event callback type
 */
export type EventCallback = (event: ExecutionEvent) => void;

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /** Callback for progress events */
  onProgress?: EventCallback;
  /** Callback for patch events */
  onPatch?: EventCallback;
  /** Callback for file modification events */
  onFileModified?: EventCallback;
  /** Callback for completion events */
  onComplete?: EventCallback;
  /** Callback for error/failure events */
  onError?: EventCallback;
  /** Callback for all events */
  onEvent?: EventCallback;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
}

/**
 * Connection status
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * Connection status callback
 */
export type StatusCallback = (status: ConnectionStatus) => void;

// ========================================
// EXECUTION STREAM CLIENT
// ========================================

/**
 * WebSocket client for execution events
 */
export class ExecutionStreamClient {
  private ws: WebSocket | null = null;
  private url: string;
  private projectId: string;
  private userId: string;
  private subscriptions: Map<string, SubscriptionOptions> = new Map();
  private status: ConnectionStatus = 'disconnected';
  private statusCallbacks: Set<StatusCallback> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastSequence: Map<string, number> = new Map();

  // Default options
  private autoReconnect = true;
  private maxReconnectAttempts = 5; // Cap reconnects — avoids infinite loop when endpoint is down
  private baseReconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private useExponentialBackoff = true;

  // Event replay state
  private pendingReplays: Set<string> = new Set();
  private replayEndpoint: string;

  // Mock mode for frontend-only testing
  private mockMode = false;
  private mockEventInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: {
    /** WebSocket URL (e.g., ws://localhost:8005) */
    url: string;
    /** Project ID */
    projectId: string;
    /** User ID */
    userId: string;
    /** API base URL for event replay */
    apiBaseUrl?: string;
    /** Enable mock mode for frontend-only testing */
    mockMode?: boolean;
  }) {
    this.url = options.url;
    this.projectId = options.projectId;
    this.userId = options.userId;
    this.replayEndpoint = options.apiBaseUrl ?? 'http://localhost:8000';
    this.mockMode = options.mockMode ?? false;
  }

  // ========================================
  // CONNECTION MANAGEMENT
  // ========================================

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    // Mock mode - simulate connection
    if (this.mockMode) {
      return this.connectMock();
    }

    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.setStatus('connecting');

      const wsUrl = `${this.url}?projectId=${this.projectId}&userId=${this.userId}`;

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[ExecutionStreamClient] Connected');
          this.setStatus('connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          console.log('[ExecutionStreamClient] Disconnected:', event.code, event.reason);
          this.setStatus('disconnected');
          this.handleDisconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[ExecutionStreamClient] Error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.autoReconnect = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Clear mock mode interval
    if (this.mockEventInterval) {
      clearInterval(this.mockEventInterval);
      this.mockEventInterval = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setStatus('disconnected');
  }

  // ========================================
  // MOCK MODE
  // ========================================

  /**
   * Connect in mock mode (no backend required)
   */
  private async connectMock(): Promise<void> {
    console.log('[ExecutionStreamClient] Mock mode enabled - simulating connection');
    this.setStatus('connected');
    this.reconnectAttempts = 0;

    // Simulate periodic mock events
    this.startMockEventStream();

    return Promise.resolve();
  }

  /**
   * Start generating mock events for testing
   */
  private startMockEventStream(): void {
    if (this.mockEventInterval) {
      clearInterval(this.mockEventInterval);
    }

    let sequence = 1;
    const mockTaskId = `mock-task-${Date.now()}`;

    // Send initial connection event
    this.emitMockEvent({
      taskId: mockTaskId,
      projectId: this.projectId,
      workspaceId: 'mock-workspace',
      userId: this.userId,
      type: 'task.queued',
      timestamp: Date.now(),
      sequence: sequence++,
      stage: 'queued',
      progress: 0,
      payload: {},
      metadata: { agent: 'mock-agent' },
    });

    // Simulate progress events every 5 seconds
    this.mockEventInterval = setInterval(() => {
      const stages: Array<{ type: ExecutionEventType; stage: ExecutionStage; progress: number }> = [
        { type: 'task.started', stage: 'planning', progress: 10 },
        { type: 'stage.started', stage: 'execution', progress: 25 },
        { type: 'progress.update', stage: 'execution', progress: 50 },
        { type: 'patch.generated', stage: 'validation', progress: 70 },
        { type: 'patch.validation_passed', stage: 'application', progress: 85 },
        { type: 'patch.applied', stage: 'completed', progress: 100 },
        { type: 'task.completed', stage: 'completed', progress: 100 },
      ];

      const stageIndex = Math.floor((sequence - 1) / 2) % stages.length;
      const stageInfo = stages[stageIndex];

      if (stageInfo) {
        this.emitMockEvent({
          taskId: mockTaskId,
          projectId: this.projectId,
          workspaceId: 'mock-workspace',
          userId: this.userId,
          type: stageInfo.type,
          timestamp: Date.now(),
          sequence: sequence++,
          stage: stageInfo.stage,
          progress: stageInfo.progress,
          payload: stageInfo.type === 'patch.generated' ? {
            patchId: `patch-${sequence}`,
            filePath: 'src/index.ts',
          } : {},
          metadata: { agent: 'mock-agent' },
        });
      }
    }, 5000);
  }

  /**
   * Emit a mock event to all subscribers
   */
  private emitMockEvent(event: ExecutionEvent): void {
    console.log('[ExecutionStreamClient] Mock event:', event.type, event.sequence);

    // Update last sequence
    this.lastSequence.set(event.taskId, event.sequence);

    // Notify subscribers for this task
    const subscription = this.subscriptions.get(event.taskId);
    if (subscription) {
      // Call specific callbacks based on event type
      if (event.progress !== undefined && subscription.onProgress) {
        subscription.onProgress(event);
      }
      if (event.type.startsWith('patch.') && subscription.onPatch) {
        subscription.onPatch(event);
      }
      if (event.type === 'file.modified' && subscription.onFileModified) {
        subscription.onFileModified(event);
      }
      if (event.type === 'task.completed' && subscription.onComplete) {
        subscription.onComplete(event);
      }
      if ((event.type === 'task.failed' || event.type === 'task.timeout') && subscription.onError) {
        subscription.onError(event);
      }
      // Always call onEvent
      if (subscription.onEvent) {
        subscription.onEvent(event);
      }
    }

    // Notify workspace subscribers
    for (const [key, sub] of this.subscriptions) {
      if (key.startsWith('workspace:') && sub.onEvent) {
        sub.onEvent(event);
      }
    }
  }

  /**
   * Handle unexpected disconnect
   */
  private handleDisconnect(): void {
    if (!this.autoReconnect) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.setStatus('reconnecting');

      // Calculate delay with exponential backoff
      const delay = this.calculateReconnectDelay();

      console.log(
        `[ExecutionStreamClient] Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`
      );

      this.reconnectTimeout = setTimeout(() => {
        this.connectAndReplay().catch((error) => {
          console.error('[ExecutionStreamClient] Reconnect failed:', error);
        });
      }, delay);
    } else {
      console.error(
        `[ExecutionStreamClient] Max reconnect attempts (${this.maxReconnectAttempts}) reached. ` +
        `Check that the WebSocket endpoint is available. Giving up.`
      );
      this.setStatus('disconnected');
    }
  }

  /**
   * Calculate reconnect delay with exponential backoff + jitter
   */
  private calculateReconnectDelay(): number {
    if (!this.useExponentialBackoff) {
      return this.baseReconnectDelay;
    }

    // Exponential backoff: base * 2^attempt
    const exponentialDelay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    // Add jitter (±25%) to prevent thundering herd
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
    
    // Cap at max delay
    return Math.min(exponentialDelay + jitter, this.maxReconnectDelay);
  }

  /**
   * Connect and replay missed events
   */
  private async connectAndReplay(): Promise<void> {
    await this.connect();
    await this.replayMissedEvents();
  }

  /**
   * Replay missed events for all active subscriptions
   */
  private async replayMissedEvents(): Promise<void> {
    const replayPromises: Promise<void>[] = [];

    for (const [key, subscription] of this.subscriptions) {
      // Determine if this is a task or workspace subscription
      const isWorkspace = key.startsWith('workspace:');
      const taskId = isWorkspace ? null : key;
      const workspaceId = isWorkspace ? key.replace('workspace:', '') : null;

      // Get last sequence for this subscription
      const lastSeq = taskId ? this.lastSequence.get(taskId) : undefined;

      if (lastSeq !== undefined && lastSeq > 0) {
        replayPromises.push(
          this.fetchAndReplayEvents(taskId, workspaceId, lastSeq, subscription)
        );
      }
    }

    await Promise.allSettled(replayPromises);
  }

  /**
   * Fetch and replay events from REST API (internal method)
   */
  private async fetchAndReplayEvents(
    taskId: string | null,
    workspaceId: string | null,
    sinceSequence: number,
    subscription: SubscriptionOptions
  ): Promise<void> {
    try {
      const params = new URLSearchParams({
        sinceSequence: sinceSequence.toString(),
        ...(taskId && { taskId }),
        ...(workspaceId && { workspaceId }),
      });

      const response = await fetch(
        `${this.replayEndpoint}/api/ai/execution/events?${params}`
      );

      if (!response.ok) {
        console.warn('[ExecutionStreamClient] Event replay failed:', response.status);
        return;
      }

      const data = await response.json();
      const events: ExecutionEvent[] = data.events ?? [];

      console.log(
        `[ExecutionStreamClient] Replaying ${events.length} events for ${taskId ?? workspaceId}`
      );

      // Dispatch replayed events
      for (const event of events) {
        this.dispatchEvent(event, subscription);
      }
    } catch (error) {
      console.error('[ExecutionStreamClient] Event replay error:', error);
    }
  }

  /**
   * Set connection status and notify listeners
   */
  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusCallbacks.forEach((cb) => cb(status));
  }

  /**
   * Subscribe to connection status changes
   */
  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  // ========================================
  // SUBSCRIPTION MANAGEMENT
  // ========================================

  /**
   * Subscribe to events for a specific task
   */
  subscribeToTask(taskId: string, options: SubscriptionOptions): () => void {
    // Store subscription options
    this.subscriptions.set(taskId, {
      ...options,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      reconnectDelay: options.reconnectDelay ?? 1000,
    });

    // Send subscribe message
    this.send({
      type: 'execution.subscribe',
      taskId,
    });

    // Return unsubscribe function
    return () => this.unsubscribeFromTask(taskId);
  }

  /**
   * Subscribe to all events for a workspace
   */
  subscribeToWorkspace(workspaceId: string, options: SubscriptionOptions): () => void {
    const key = `workspace:${workspaceId}`;
    this.subscriptions.set(key, options);

    this.send({
      type: 'execution.subscribe',
      workspaceId,
    });

    return () => this.unsubscribeFromWorkspace(workspaceId);
  }

  /**
   * Unsubscribe from task events
   */
  unsubscribeFromTask(taskId: string): void {
    this.subscriptions.delete(taskId);

    this.send({
      type: 'execution.unsubscribe',
      taskId,
    });
  }

  /**
   * Unsubscribe from workspace events
   */
  unsubscribeFromWorkspace(workspaceId: string): void {
    const key = `workspace:${workspaceId}`;
    this.subscriptions.delete(key);

    this.send({
      type: 'execution.unsubscribe',
      workspaceId,
    });
  }

  /**
   * Request replay of missed events
   */
  replayEvents(taskId: string, sinceSequence?: number): void {
    const last = this.lastSequence.get(taskId) ?? 0;

    this.send({
      type: 'execution.replay',
      taskId,
      sinceSequence: sinceSequence ?? last,
    });
  }

  /**
   * Request replay via REST API (more reliable than WebSocket replay)
   */
  async replayEventsViaApi(taskId: string, sinceSequence?: number): Promise<ExecutionEvent[]> {
    const last = sinceSequence ?? this.lastSequence.get(taskId) ?? 0;

    try {
      const response = await fetch(
        `${this.replayEndpoint}/api/ai/execution/events?taskId=${taskId}&sinceSequence=${last}`
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return data.events ?? [];
    } catch (error) {
      console.error('[ExecutionStreamClient] API replay failed:', error);
      return [];
    }
  }

  /**
   * Get connection health metrics
   */
  getHealthMetrics(): {
    status: ConnectionStatus;
    reconnectAttempts: number;
    activeSubscriptions: number;
    lastSequences: Map<string, number>;
  } {
    return {
      status: this.status,
      reconnectAttempts: this.reconnectAttempts,
      activeSubscriptions: this.subscriptions.size,
      lastSequences: new Map(this.lastSequence),
    };
  }

  /**
   * Reset reconnect attempts (call after successful connection)
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }

  // ========================================
  // MESSAGE HANDLING
  // ========================================

  /**
   * Send message to WebSocket
   */
  private send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const rawMessage = JSON.parse(data);
      let message = rawMessage;

      // Handle standalone gateway "message" envelope
      if (message.type === 'message' && message.payload) {
        message = message.payload;
      }
      // Handle Phase-7 "execution.event" envelope
      if (message.type === 'execution.event' && message.event) {
        message = message.event;
      }

      // Handle connection messages (check both raw and unwrapped)
      const type = message.type || rawMessage.type;

      // 'connected' is sent by both the WS gateway and the AI service /ws endpoint
      if (type === 'connected' || type === 'connection.established') {
        console.log('[ExecutionStreamClient] Connection established:', message.connectionId || rawMessage.connectionId);
        return;
      }

      if (type === 'execution.subscribed' || type === 'subscribed') {
        console.log('[ExecutionStreamClient] Subscribed:', message.channel || rawMessage.channel);
        return;
      }

      if (type === 'execution.unsubscribed' || type === 'unsubscribed') {
        console.log('[ExecutionStreamClient] Unsubscribed:', message.taskId || message.workspaceId || rawMessage.taskId);
        return;
      }

      if (type === 'pong') {
        // Heartbeat response — ignore silently
        return;
      }

      // Handle execution events (must be the unwrapped version)
      if (this.isExecutionEvent(message)) {
        this.handleExecutionEvent(message);
      }
    } catch (error) {
      console.error('[ExecutionStreamClient] Error parsing message:', error);
    }
  }

  /**
   * Check if message is an execution event
   */
  private isExecutionEvent(message: unknown): message is ExecutionEvent {
    if (typeof message !== 'object' || message === null) return false;
    const obj = message as Record<string, unknown>;
    return (
      typeof obj.taskId === 'string' &&
      typeof obj.type === 'string' &&
      typeof obj.timestamp === 'number' &&
      typeof obj.sequence === 'number'
    );
  }

  /**
   * Handle execution event
   */
  private handleExecutionEvent(event: ExecutionEvent): void {
    const { taskId, type, sequence } = event;

    // Update last sequence for replay
    this.lastSequence.set(taskId, sequence);

    // Find subscription for this task
    const subscription = this.subscriptions.get(taskId);

    if (!subscription) {
      // Maybe it's a workspace subscription
      const workspaceKey = `workspace:${event.workspaceId}`;
      const workspaceSub = this.subscriptions.get(workspaceKey);

      if (workspaceSub) {
        this.dispatchEvent(event, workspaceSub);
      }
      return;
    }

    this.dispatchEvent(event, subscription);
  }

  /**
   * Dispatch event to appropriate callback
   */
  private dispatchEvent(event: ExecutionEvent, subscription: SubscriptionOptions): void {
    // Always call onEvent
    subscription.onEvent?.(event);

    // Route to specific callbacks based on event type
    switch (event.type) {
      case 'task.queued':
      case 'task.started':
      case 'stage.started':
      case 'stage.completed':
      case 'progress.update':
      case 'agent.planning':
      case 'agent.generating':
      case 'agent.step':
        subscription.onProgress?.(event);
        break;

      case 'patch.generated':
      case 'patch.validating':
      case 'patch.validation_passed':
      case 'patch.validation_failed':
      case 'patch.applying':
      case 'patch.applied':
        subscription.onPatch?.(event);
        break;

      case 'file.modified':
        subscription.onFileModified?.(event);
        break;

      case 'task.completed':
        subscription.onComplete?.(event);
        break;

      case 'task.failed':
      case 'task.timeout':
      case 'task.cancelled':
        subscription.onError?.(event);
        break;
    }
  }
}

// ========================================
// REACT HOOKS
// ========================================

/**
 * Create a hook for React components
 * Usage:
 *   const useExecutionStream = createExecutionStreamHook(client);
 *   const { status, events } = useExecutionStream(taskId);
 */
export function createExecutionStreamHook(client: ExecutionStreamClient) {
  return function useExecutionStream(
    taskId: string | null,
    options: Omit<SubscriptionOptions, 'autoReconnect' | 'maxReconnectAttempts' | 'reconnectDelay'> = {}
  ) {
    // This would be implemented with React hooks in a real implementation
    // For now, return the client methods
    return {
      subscribe: () => (taskId ? client.subscribeToTask(taskId, options) : () => {}),
      status: client.getStatus(),
      replay: (since?: number) => taskId && client.replayEvents(taskId, since),
    };
  };
}

// ========================================
// SINGLETON INSTANCE
// ========================================

let defaultClient: ExecutionStreamClient | null = null;

/**
 * Reset the default client (useful for testing or switching modes)
 */
export function resetExecutionStreamClient(): void {
  if (defaultClient) {
    defaultClient.disconnect();
    defaultClient = null;
  }
}

/**
 * Get or create default client
 */
export function getExecutionStreamClient(options?: {
  url?: string;
  projectId?: string;
  userId?: string;
  mockMode?: boolean;
}): ExecutionStreamClient {
  // Always create new client if options provided (allows mode switching)
  if (options) {
    if (defaultClient) {
      defaultClient.disconnect();
    }
    defaultClient = new ExecutionStreamClient({
      url: options.url ?? 'ws://localhost:8005',
      projectId: options.projectId ?? '',
      userId: options.userId ?? '',
      mockMode: options.mockMode ?? false, // Default to real mode
    });
  }

  if (!defaultClient) {
    throw new Error('ExecutionStreamClient not initialized. Call getExecutionStreamClient with options first.');
  }

  return defaultClient;
}
