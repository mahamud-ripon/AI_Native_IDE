/**
 * Agent Tracing
 * 
 * Distributed tracing for AI agent operations.
 * Captures detailed execution traces for debugging and analysis.
 */

import * as crypto from 'crypto';
import {
  Trace,
  TraceSpan,
  TraceEvent,
  SpanStatus,
  AgentTrace,
  AgentStageTrace,
  LLMCallTrace,
  ToolCallTrace,
  ObservabilityConfig,
  OBSERVABILITY_DEFAULTS,
} from './observability_types.js';

// Span context for nested tracing
interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Agent Tracer
 */
export class AgentTracer {
  private config: Required<Omit<ObservabilityConfig, 'exportEndpoint'>> & { exportEndpoint?: string };
  private traces: Map<string, Trace> = new Map();
  private activeSpans: Map<string, TraceSpan> = new Map();
  private agentTraces: Map<string, AgentTrace> = new Map();

  constructor(config?: Partial<ObservabilityConfig>) {
    this.config = { ...OBSERVABILITY_DEFAULTS, ...config };
  }

  /**
   * Start a new trace
   */
  startTrace(name: string, metadata: Record<string, unknown> = {}): string {
    if (!this.config.enabled) {
      return '';
    }

    // Apply sampling
    if (Math.random() > this.config.samplingRate) {
      return '';
    }

    const traceId = this.generateId();
    const trace: Trace = {
      id: traceId,
      name,
      spans: [],
      startTime: new Date(),
      status: 'started',
      metadata,
    };

    this.traces.set(traceId, trace);
    return traceId;
  }

  /**
   * Start a span within a trace
   */
  startSpan(
    traceId: string,
    name: string,
    parentSpanId?: string,
    attributes: Record<string, unknown> = {}
  ): string {
    if (!this.config.enabled || !traceId) {
      return '';
    }

    const spanId = this.generateId();
    const span: TraceSpan = {
      id: spanId,
      traceId,
      parentSpanId,
      name,
      status: 'started',
      startTime: new Date(),
      attributes,
      events: [],
    };

    this.activeSpans.set(spanId, span);

    // Add to trace
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.spans.push(span);
    }

    return spanId;
  }

  /**
   * Add event to span
   */
  addEvent(
    spanId: string,
    name: string,
    attributes?: Record<string, unknown>
  ): void {
    if (!this.config.enabled || !spanId) {
      return;
    }

    const span = this.activeSpans.get(spanId);
    if (span) {
      span.events.push({
        name,
        timestamp: new Date(),
        attributes,
      });
    }
  }

  /**
   * End a span
   */
  endSpan(spanId: string, status: SpanStatus = 'completed'): void {
    if (!this.config.enabled || !spanId) {
      return;
    }

    const span = this.activeSpans.get(spanId);
    if (span) {
      span.endTime = new Date();
      span.durationMs = span.endTime.getTime() - span.startTime.getTime();
      span.status = status;

      this.activeSpans.delete(spanId);
    }
  }

  /**
   * End a trace
   */
  endTrace(traceId: string, status: SpanStatus = 'completed'): void {
    if (!this.config.enabled || !traceId) {
      return;
    }

    const trace = this.traces.get(traceId);
    if (trace) {
      trace.endTime = new Date();
      trace.durationMs = trace.endTime.getTime() - trace.startTime.getTime();
      trace.status = status;
    }
  }

  /**
   * Start agent trace
   */
  startAgentTrace(options: {
    agentId: string;
    taskId?: string;
    workspaceId?: string;
    userId?: string;
    prompt: string;
  }): string {
    if (!this.config.enabled) {
      return '';
    }

    const traceId = this.generateId();
    const trace: AgentTrace = {
      traceId,
      agentId: options.agentId,
      taskId: options.taskId,
      workspaceId: options.workspaceId,
      userId: options.userId,
      prompt: options.prompt,
      stages: [],
      llmCalls: [],
      toolCalls: [],
      startTime: new Date(),
      totalDurationMs: 0,
      success: false,
    };

    this.agentTraces.set(traceId, trace);
    return traceId;
  }

  /**
   * Record agent stage
   */
  recordStage(
    traceId: string,
    stage: string,
    success: boolean,
    durationMs: number,
    error?: string,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.config.enabled || !traceId) {
      return;
    }

    const trace = this.agentTraces.get(traceId);
    if (trace) {
      trace.stages.push({
        stage,
        startTime: new Date(Date.now() - durationMs),
        endTime: new Date(),
        durationMs,
        success,
        error,
        metadata,
      });
    }
  }

  /**
   * Record LLM call
   */
  recordLLMCall(
    traceId: string,
    call: Omit<LLMCallTrace, 'id' | 'timestamp'>
  ): void {
    if (!this.config.enabled || !traceId) {
      return;
    }

    const trace = this.agentTraces.get(traceId);
    if (trace) {
      trace.llmCalls.push({
        id: this.generateId(),
        ...call,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Record tool call
   */
  recordToolCall(
    traceId: string,
    call: Omit<ToolCallTrace, 'id' | 'timestamp'>
  ): void {
    if (!this.config.enabled || !traceId) {
      return;
    }

    const trace = this.agentTraces.get(traceId);
    if (trace) {
      trace.toolCalls.push({
        id: this.generateId(),
        ...call,
        timestamp: new Date(),
      });
    }
  }

  /**
   * End agent trace
   */
  endAgentTrace(
    traceId: string,
    success: boolean,
    error?: string
  ): void {
    if (!this.config.enabled || !traceId) {
      return;
    }

    const trace = this.agentTraces.get(traceId);
    if (trace) {
      trace.endTime = new Date();
      trace.totalDurationMs = trace.endTime.getTime() - trace.startTime.getTime();
      trace.success = success;
      trace.error = error;
    }
  }

  /**
   * Get trace by ID
   */
  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  /**
   * Get agent trace by ID
   */
  getAgentTrace(traceId: string): AgentTrace | undefined {
    return this.agentTraces.get(traceId);
  }

  /**
   * Get all traces
   */
  getAllTraces(): Trace[] {
    return Array.from(this.traces.values());
  }

  /**
   * Get all agent traces
   */
  getAllAgentTraces(): AgentTrace[] {
    return Array.from(this.agentTraces.values());
  }

  /**
   * Get traces by workspace
   */
  getTracesByWorkspace(workspaceId: string): AgentTrace[] {
    return Array.from(this.agentTraces.values()).filter(
      t => t.workspaceId === workspaceId
    );
  }

  /**
   * Get traces by user
   */
  getTracesByUser(userId: string): AgentTrace[] {
    return Array.from(this.agentTraces.values()).filter(
      t => t.userId === userId
    );
  }

  /**
   * Clear old traces
   */
  clearOldTraces(maxAgeMs: number = this.config.traceRetentionMs): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleared = 0;

    for (const [id, trace] of this.traces) {
      if (trace.startTime.getTime() < cutoff) {
        this.traces.delete(id);
        cleared++;
      }
    }

    for (const [id, trace] of this.agentTraces) {
      if (trace.startTime.getTime() < cutoff) {
        this.agentTraces.delete(id);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Export traces for external systems
   */
  exportTraces(): { traces: Trace[]; agentTraces: AgentTrace[] } {
    return {
      traces: this.getAllTraces(),
      agentTraces: this.getAllAgentTraces(),
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 16);
  }
}

// Singleton instance
let defaultTracer: AgentTracer | null = null;

/**
 * Get default tracer
 */
export function getTracer(): AgentTracer {
  if (!defaultTracer) {
    defaultTracer = new AgentTracer();
  }
  return defaultTracer;
}

/**
 * Create tracer
 */
export function createTracer(config?: Partial<ObservabilityConfig>): AgentTracer {
  return new AgentTracer(config);
}

/**
 * Start trace helper
 */
export function startTrace(name: string, metadata?: Record<string, unknown>): string {
  return getTracer().startTrace(name, metadata);
}

/**
 * Start span helper
 */
export function startSpan(
  traceId: string,
  name: string,
  parentSpanId?: string,
  attributes?: Record<string, unknown>
): string {
  return getTracer().startSpan(traceId, name, parentSpanId, attributes);
}

/**
 * End span helper
 */
export function endSpan(spanId: string, status?: SpanStatus): void {
  getTracer().endSpan(spanId, status);
}

/**
 * End trace helper
 */
export function endTrace(traceId: string, status?: SpanStatus): void {
  getTracer().endTrace(traceId, status);
}

/**
 * Trace context manager for automatic span management
 */
export class TraceContext {
  private traceId: string;
  private currentSpanId: string | null = null;

  constructor(name: string, metadata?: Record<string, unknown>) {
    this.traceId = startTrace(name, metadata);
  }

  /**
   * Run operation within a span
   */
  async withSpan<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: Record<string, unknown>
  ): Promise<T> {
    const spanId = startSpan(this.traceId, name, this.currentSpanId ?? undefined, attributes);
    const previousSpan = this.currentSpanId;
    this.currentSpanId = spanId;

    try {
      const result = await fn();
      endSpan(spanId, 'completed');
      return result;
    } catch (error) {
      endSpan(spanId, 'failed');
      throw error;
    } finally {
      this.currentSpanId = previousSpan;
    }
  }

  /**
   * Get trace ID
   */
  getTraceId(): string {
    return this.traceId;
  }

  /**
   * Complete the trace
   */
  complete(success: boolean = true): void {
    endTrace(this.traceId, success ? 'completed' : 'failed');
  }
}
