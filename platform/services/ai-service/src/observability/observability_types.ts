/**
 * Observability Types
 * 
 * Type definitions for telemetry, tracing, and monitoring.
 */

// Trace span status
export type SpanStatus = 'started' | 'running' | 'completed' | 'failed' | 'cancelled';

// Metric type
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

// Alert severity
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

// Trace span
export interface TraceSpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  status: SpanStatus;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  attributes: Record<string, unknown>;
  events: TraceEvent[];
}

// Trace event
export interface TraceEvent {
  name: string;
  timestamp: Date;
  attributes?: Record<string, unknown>;
}

// Complete trace
export interface Trace {
  id: string;
  name: string;
  spans: TraceSpan[];
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  status: SpanStatus;
  metadata: Record<string, unknown>;
}

// Agent trace
export interface AgentTrace {
  traceId: string;
  agentId: string;
  taskId?: string;
  workspaceId?: string;
  userId?: string;
  prompt: string;
  stages: AgentStageTrace[];
  llmCalls: LLMCallTrace[];
  toolCalls: ToolCallTrace[];
  startTime: Date;
  endTime?: Date;
  totalDurationMs: number;
  success: boolean;
  error?: string;
}

// Agent stage trace
export interface AgentStageTrace {
  stage: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

// LLM call trace
export interface LLMCallTrace {
  id: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  success: boolean;
  cached: boolean;
  timestamp: Date;
}

// Tool call trace
export interface ToolCallTrace {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  durationMs: number;
  success: boolean;
  error?: string;
  timestamp: Date;
}

// Task metrics
export interface TaskMetricsRecord {
  id: string;
  taskId: string;
  workspaceId: string;
  userId: string;
  status: string;
  totalDurationMs: number;
  planningMs: number;
  executionMs: number;
  validationMs: number;
  applicationMs: number;
  filesModified: number;
  linesAdded: number;
  linesRemoved: number;
  retries: number;
  rollbackPerformed: boolean;
  timestamp: Date;
}

// Token usage record
export interface TokenUsageRecord {
  id: string;
  workspaceId?: string;
  userId: string;
  taskId?: string;
  agentId?: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
  timestamp: Date;
}

// Token usage summary
export interface TokenUsageSummary {
  workspaceId?: string;
  userId?: string;
  periodStart: Date;
  periodEnd: Date;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, ProviderUsage>;
  byModel: Record<string, ModelUsage>;
  requestCount: number;
}

// Provider usage
export interface ProviderUsage {
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  requestCount: number;
}

// Model usage
export interface ModelUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  requestCount: number;
}

// Performance metrics
export interface PerformanceMetrics {
  timestamp: Date;
  uptime: number;
  activeTasks: number;
  activeAgents: number;
  memoryUsageMb: number;
  cpuUsagePercent: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  throughputPerSecond: number;
}

// Performance snapshot
export interface PerformanceSnapshot {
  id: string;
  timestamp: Date;
  metrics: PerformanceMetrics;
  componentMetrics: ComponentMetrics[];
}

// Component metrics
export interface ComponentMetrics {
  component: string;
  averageLatencyMs: number;
  errorRate: number;
  throughputPerSecond: number;
  activeOperations: number;
  customMetrics: Record<string, number>;
}

// Alert
export interface Alert {
  id: string;
  severity: AlertSeverity;
  component: string;
  message: string;
  details: Record<string, unknown>;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

// Alert rule
export interface AlertRule {
  id: string;
  name: string;
  component: string;
  metric: string;
  condition: 'gt' | 'lt' | 'eq' | 'neq' | 'threshold';
  threshold: number;
  severity: AlertSeverity;
  enabled: boolean;
  cooldownMs: number;
  lastTriggered?: Date;
}

// Observability config
export interface ObservabilityConfig {
  enabled: boolean;
  samplingRate: number;
  traceRetentionMs: number;
  metricsRetentionMs: number;
  alertCheckIntervalMs: number;
  exportEnabled: boolean;
  exportEndpoint?: string;
}

// Pricing config for cost estimation
export interface PricingConfig {
  providers: Record<string, ProviderPricing>;
}

// Provider pricing
export interface ProviderPricing {
  models: Record<string, ModelPricing>;
}

// Model pricing
export interface ModelPricing {
  promptPricePer1k: number;
  completionPricePer1k: number;
  cachedPromptPricePer1k?: number;
}

// Default configurations
export const OBSERVABILITY_DEFAULTS: Required<Omit<ObservabilityConfig, 'exportEndpoint'>> & { exportEndpoint?: string } = {
  enabled: true,
  samplingRate: 1.0,
  traceRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
  metricsRetentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  alertCheckIntervalMs: 60000, // 1 minute
  exportEnabled: false,
  exportEndpoint: undefined,
} as const;

// Default pricing (approximate as of 2024)
export const DEFAULT_PRICING: PricingConfig = {
  providers: {
    openai: {
      models: {
        'gpt-4': {
          promptPricePer1k: 0.03,
          completionPricePer1k: 0.06,
        },
        'gpt-4-turbo': {
          promptPricePer1k: 0.01,
          completionPricePer1k: 0.03,
        },
        'gpt-3.5-turbo': {
          promptPricePer1k: 0.0005,
          completionPricePer1k: 0.0015,
        },
        'text-embedding-3-small': {
          promptPricePer1k: 0.00002,
          completionPricePer1k: 0,
        },
        'text-embedding-3-large': {
          promptPricePer1k: 0.00013,
          completionPricePer1k: 0,
        },
      },
    },
    anthropic: {
      models: {
        'claude-3-opus': {
          promptPricePer1k: 0.015,
          completionPricePer1k: 0.075,
        },
        'claude-3-sonnet': {
          promptPricePer1k: 0.003,
          completionPricePer1k: 0.015,
        },
        'claude-3-haiku': {
          promptPricePer1k: 0.00025,
          completionPricePer1k: 0.00125,
        },
      },
    },
    cohere: {
      models: {
        'embed-english-v3.0': {
          promptPricePer1k: 0.0001,
          completionPricePer1k: 0,
        },
      },
    },
  },
} as const;

// Metric names
export const METRIC_NAMES = {
  // Task metrics
  TASK_STARTED: 'task.started',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TASK_DURATION: 'task.duration_ms',
  TASK_RETRIES: 'task.retries',

  // Agent metrics
  AGENT_STARTED: 'agent.started',
  AGENT_COMPLETED: 'agent.completed',
  AGENT_FAILED: 'agent.failed',
  AGENT_DURATION: 'agent.duration_ms',
  AGENT_STEPS: 'agent.steps',

  // LLM metrics
  LLM_CALL: 'llm.call',
  LLM_TOKENS_PROMPT: 'llm.tokens.prompt',
  LLM_TOKENS_COMPLETION: 'llm.tokens.completion',
  LLM_LATENCY: 'llm.latency_ms',
  LLM_COST: 'llm.cost_usd',

  // Search metrics
  SEARCH_QUERY: 'search.query',
  SEARCH_LATENCY: 'search.latency_ms',
  SEARCH_RESULTS: 'search.results_count',

  // Patch metrics
  PATCH_GENERATED: 'patch.generated',
  PATCH_APPLIED: 'patch.applied',
  PATCH_FAILED: 'patch.failed',
  PATCH_SIZE: 'patch.size_lines',

  // Sandbox metrics
  SANDBOX_CHECK: 'sandbox.check',
  SANDBOX_LATENCY: 'sandbox.latency_ms',
  SANDBOX_ERRORS: 'sandbox.errors_count',
} as const;
