/**
 * AI Service Client
 *
 * Connects the IDE to the API Gateway (port 8000) which routes to ai-service.
 * Handles workflow execution, status polling, and real-time updates.
 */

// ========================================
// TYPES
// ========================================

export interface WorkflowStep {
  stepRunId: string;
  stepIndex: number;
  stepName: string;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  attemptNumber: number;
  retryCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  provider: string | null;
  model: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface WorkflowRun {
  workflowRunId: string;
  workflowName: string;
  workflowVersion: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  totalSteps: number;
  completedSteps: number[];
  failedSteps: number[];
  skippedSteps: number[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number | null;
  errorMessage: string | null;
  errorStep: number | null;
  steps: WorkflowStep[];
}

export interface StartWorkflowRequest {
  workflowName: string;
  projectId: string;
  userId?: string;
  initialContext?: Record<string, unknown>;
  triggerType?: 'manual' | 'git_push' | 'ai_agent_auto' | 'scheduled';
}

export interface StartWorkflowResponse {
  workflowRunId: string;
  status: string;
  message: string;
}

export interface WorkflowDefinition {
  name: string;
  version: string;
  description: string;
  totalSteps: number;
}

export interface WorkflowEvent {
  type: 'workflow_started' | 'step_started' | 'step_progress' | 'step_completed' | 'step_failed' | 'workflow_completed' | 'workflow_failed';
  workflowRunId: string;
  stepIndex?: number;
  stepName?: string;
  agentName?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

// ========================================
// CONFIG
// ========================================

// For AI workflows, connect directly to AI Service (bypass API Gateway due to proxy issues)
const AI_SERVICE_URL = import.meta.env.VITE_AI_SERVICE_URL || 'http://localhost:8005';
const AI_SERVICE_WS_URL = import.meta.env.VITE_AI_SERVICE_WS_URL || 'ws://localhost:8005';

// ========================================
// API CLIENT
// ========================================

class AIServiceClient {
  private baseUrl: string;
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private eventHandlers = new Map<string, Set<(event: WorkflowEvent) => void>>();

  constructor(baseUrl: string = AI_SERVICE_URL, wsUrl: string = AI_SERVICE_WS_URL) {
    this.baseUrl = baseUrl;
    this.wsUrl = wsUrl;
  }

  // ========================================
  // WORKFLOW API
  // ========================================

  /**
   * List available workflows
   */
  async listWorkflows(): Promise<{ workflows: WorkflowDefinition[]; count: number }> {
    const response = await fetch(`${this.baseUrl}/workflows`);
    if (!response.ok) {
      throw new Error(`Failed to list workflows: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get workflow definition
   */
  async getWorkflowDefinition(name: string): Promise<{ definition: WorkflowDefinition }> {
    const response = await fetch(`${this.baseUrl}/workflows/${name}/definition`);
    if (!response.ok) {
      throw new Error(`Failed to get workflow definition: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Start a new workflow
   */
  async startWorkflow(request: StartWorkflowRequest): Promise<StartWorkflowResponse> {
    const response = await fetch(`${this.baseUrl}/workflows/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Failed to start workflow: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get workflow run status
   */
  async getWorkflowRun(workflowRunId: string): Promise<WorkflowRun> {
    const response = await fetch(`${this.baseUrl}/workflows/${workflowRunId}`);
    if (!response.ok) {
      throw new Error(`Failed to get workflow run: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get workflow run steps
   */
  async getWorkflowSteps(workflowRunId: string): Promise<{ workflowRunId: string; steps: WorkflowStep[]; count: number }> {
    const response = await fetch(`${this.baseUrl}/workflows/${workflowRunId}/steps`);
    if (!response.ok) {
      throw new Error(`Failed to get workflow steps: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Resume a workflow
   */
  async resumeWorkflow(workflowRunId: string, options?: { fromStep?: number; skipCompleted?: boolean; retryFailed?: boolean }): Promise<{ workflowRunId: string; status: string; message: string }> {
    const response = await fetch(`${this.baseUrl}/workflows/${workflowRunId}/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options || {}),
    });

    if (!response.ok) {
      throw new Error(`Failed to resume workflow: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Cancel a workflow
   */
  async cancelWorkflow(workflowRunId: string, reason?: string): Promise<{ workflowRunId: string; status: string; message: string }> {
    const response = await fetch(`${this.baseUrl}/workflows/${workflowRunId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });

    if (!response.ok) {
      throw new Error(`Failed to cancel workflow: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List workflow runs for a project
   */
  async listProjectWorkflows(projectId: string): Promise<{ projectId: string; workflowRuns: WorkflowRun[]; count: number }> {
    const response = await fetch(`${this.baseUrl}/projects/${projectId}/workflows`);
    if (!response.ok) {
      throw new Error(`Failed to list project workflows: ${response.statusText}`);
    }
    return response.json();
  }

  // ========================================
  // WEBSOCKET FOR REAL-TIME UPDATES
  // ========================================

  /**
   * Connect to WebSocket for real-time workflow updates
   */
  connectWebSocket(onConnect?: () => void, onError?: (error: Event) => void): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log('[AIServiceClient] WebSocket connected');
      onConnect?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle workflow events
        if (data.type && data.workflowRunId) {
          const workflowEvent: WorkflowEvent = {
            type: data.type,
            workflowRunId: data.workflowRunId,
            stepIndex: data.stepIndex,
            stepName: data.stepName,
            agentName: data.agentName,
            data: data.data,
            timestamp: data.timestamp || new Date().toISOString(),
          };

          // Notify handlers for this workflow
          const handlers = this.eventHandlers.get(data.workflowRunId);
          if (handlers) {
            handlers.forEach(handler => handler(workflowEvent));
          }

          // Notify global handlers
          const globalHandlers = this.eventHandlers.get('*');
          if (globalHandlers) {
            globalHandlers.forEach(handler => handler(workflowEvent));
          }
        }
      } catch (error) {
        console.error('[AIServiceClient] Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[AIServiceClient] WebSocket error:', error);
      onError?.(error);
    };

    this.ws.onclose = () => {
      console.log('[AIServiceClient] WebSocket disconnected');
      this.ws = null;
    };
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to workflow events
   */
  subscribeToWorkflow(workflowRunId: string, handler: (event: WorkflowEvent) => void): () => void {
    if (!this.eventHandlers.has(workflowRunId)) {
      this.eventHandlers.set(workflowRunId, new Set());
    }
    
    this.eventHandlers.get(workflowRunId)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(workflowRunId);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.eventHandlers.delete(workflowRunId);
        }
      }
    };
  }

  /**
   * Subscribe to all workflow events
   */
  subscribeToAll(handler: (event: WorkflowEvent) => void): () => void {
    return this.subscribeToWorkflow('*', handler);
  }

  // ========================================
  // POLLING FALLBACK
  // ========================================

  /**
   * Poll workflow status until completion
   */
  async pollWorkflowStatus(
    workflowRunId: string,
    onProgress: (run: WorkflowRun) => void,
    options: { intervalMs?: number; timeoutMs?: number } = {}
  ): Promise<WorkflowRun> {
    const { intervalMs = 1000, timeoutMs = 300000 } = options; // 5 min default timeout
    const startTime = Date.now();

    while (true) {
      const run = await this.getWorkflowRun(workflowRunId);
      onProgress(run);

      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return run;
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Workflow polling timeout');
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  // ========================================
  // HEALTH CHECK
  // ========================================

  /**
   * Check if ai-service is healthy
   */
  async healthCheck(): Promise<{ status: string; service: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error('AI service unhealthy');
    }
    return response.json();
  }
}

// ========================================
// SINGLETON
// ========================================

export const aiServiceClient = new AIServiceClient();
export default aiServiceClient;
