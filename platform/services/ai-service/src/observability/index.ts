/**
 * Observability Module
 * 
 * Telemetry, tracing, and monitoring for the AI coding platform.
 */

// Agent tracing
export {
  AgentTracer,
  getTracer,
  createTracer,
  startTrace,
  startSpan,
  endSpan,
  endTrace,
  TraceContext,
} from './agent_tracing.js';

// Task metrics
export {
  TaskMetricsCollector,
  getMetricsCollector,
  createMetricsCollector,
  recordTaskMetrics,
  getTaskSuccessRate,
  getTaskAverageLatency,
} from './task_metrics.js';

// Token usage
export {
  TokenUsageTracker,
  getTokenTracker,
  createTokenTracker,
  recordTokenUsage,
  getTokenUsageSummary,
  calculateTokenCost,
} from './token_usage.js';

// Performance monitor
export {
  PerformanceMonitor,
  getPerformanceMonitor,
  createPerformanceMonitor,
  startMonitoring,
  stopMonitoring,
  getCurrentMetrics,
  getActiveAlerts,
} from './performance_monitor.js';

// Types
export {
  SpanStatus,
  MetricType,
  AlertSeverity,
  TraceSpan,
  TraceEvent,
  Trace,
  AgentTrace,
  AgentStageTrace,
  LLMCallTrace,
  ToolCallTrace,
  TaskMetricsRecord,
  TokenUsageRecord,
  TokenUsageSummary,
  ProviderUsage,
  ModelUsage,
  PerformanceMetrics,
  PerformanceSnapshot,
  ComponentMetrics,
  Alert,
  AlertRule,
  ObservabilityConfig,
  PricingConfig,
  ProviderPricing,
  ModelPricing,
  OBSERVABILITY_DEFAULTS,
  DEFAULT_PRICING,
  METRIC_NAMES,
} from './observability_types.js';
