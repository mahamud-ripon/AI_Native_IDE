/**
 * Task Metrics
 * 
 * Collects and aggregates metrics for coding tasks.
 * Tracks success rates, latency, and resource usage.
 */

import * as crypto from 'crypto';
import {
  TaskMetricsRecord,
  PerformanceMetrics,
  ComponentMetrics,
  PerformanceSnapshot,
  MetricType,
  METRIC_NAMES,
} from './observability_types.js';

// Metric aggregation
interface MetricAggregation {
  count: number;
  sum: number;
  min: number;
  max: number;
  values: number[];
}

/**
 * Task Metrics Collector
 */
export class TaskMetricsCollector {
  private records: Map<string, TaskMetricsRecord> = new Map();
  private aggregations: Map<string, MetricAggregation> = new Map();
  private componentMetrics: Map<string, ComponentMetrics> = new Map();

  /**
   * Record task metrics
   */
  recordTask(metrics: Omit<TaskMetricsRecord, 'id' | 'timestamp'>): string {
    const id = this.generateId();
    const record: TaskMetricsRecord = {
      id,
      ...metrics,
      timestamp: new Date(),
    };

    this.records.set(id, record);

    // Update aggregations
    this.updateAggregations(record);

    return id;
  }

  /**
   * Update metric aggregations
   */
  private updateAggregations(record: TaskMetricsRecord): void {
    // Total duration
    this.addToAggregation(METRIC_NAMES.TASK_DURATION, record.totalDurationMs);

    // Planning time
    this.addToAggregation('task.planning_ms', record.planningMs);

    // Execution time
    this.addToAggregation('task.execution_ms', record.executionMs);

    // Validation time
    this.addToAggregation('task.validation_ms', record.validationMs);

    // Application time
    this.addToAggregation('task.application_ms', record.applicationMs);

    // Files modified
    this.addToAggregation('task.files_modified', record.filesModified);

    // Lines added
    this.addToAggregation('task.lines_added', record.linesAdded);

    // Retries
    this.addToAggregation(METRIC_NAMES.TASK_RETRIES, record.retries);

    // Status counts
    if (record.status === 'completed') {
      this.incrementCounter(METRIC_NAMES.TASK_COMPLETED);
    } else if (record.status === 'failed') {
      this.incrementCounter(METRIC_NAMES.TASK_FAILED);
    }
  }

  /**
   * Add value to aggregation
   */
  private addToAggregation(name: string, value: number): void {
    const agg = this.aggregations.get(name) ?? {
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      values: [],
    };

    agg.count++;
    agg.sum += value;
    agg.min = Math.min(agg.min, value);
    agg.max = Math.max(agg.max, value);
    agg.values.push(value);

    // Keep last 1000 values
    if (agg.values.length > 1000) {
      agg.values.shift();
    }

    this.aggregations.set(name, agg);
  }

  /**
   * Increment counter
   */
  private incrementCounter(name: string): void {
    const agg = this.aggregations.get(name) ?? {
      count: 0,
      sum: 0,
      min: 0,
      max: 0,
      values: [],
    };

    agg.count++;
    agg.sum++;
    this.aggregations.set(name, agg);
  }

  /**
   * Get metric statistics
   */
  getMetricStats(name: string): {
    count: number;
    sum: number;
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const agg = this.aggregations.get(name);
    if (!agg || agg.count === 0) {
      return null;
    }

    const sorted = [...agg.values].sort((a, b) => a - b);
    const p50Index = Math.floor(sorted.length * 0.5);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    return {
      count: agg.count,
      sum: agg.sum,
      min: agg.min,
      max: agg.max,
      mean: agg.sum / agg.count,
      p50: sorted[p50Index] ?? agg.min,
      p95: sorted[p95Index] ?? agg.max,
      p99: sorted[p99Index] ?? agg.max,
    };
  }

  /**
   * Get task success rate
   */
  getSuccessRate(periodMs?: number): number {
    const cutoff = periodMs ? Date.now() - periodMs : 0;
    let total = 0;
    let successful = 0;

    for (const record of this.records.values()) {
      if (record.timestamp.getTime() >= cutoff) {
        total++;
        if (record.status === 'completed') {
          successful++;
        }
      }
    }

    return total > 0 ? successful / total : 0;
  }

  /**
   * Get average latency
   */
  getAverageLatency(periodMs?: number): number {
    const cutoff = periodMs ? Date.now() - periodMs : 0;
    let total = 0;
    let count = 0;

    for (const record of this.records.values()) {
      if (record.timestamp.getTime() >= cutoff) {
        total += record.totalDurationMs;
        count++;
      }
    }

    return count > 0 ? total / count : 0;
  }

  /**
   * Get metrics by workspace
   */
  getMetricsByWorkspace(workspaceId: string): TaskMetricsRecord[] {
    return Array.from(this.records.values()).filter(
      r => r.workspaceId === workspaceId
    );
  }

  /**
   * Get metrics by user
   */
  getMetricsByUser(userId: string): TaskMetricsRecord[] {
    return Array.from(this.records.values()).filter(
      r => r.userId === userId
    );
  }

  /**
   * Update component metrics
   */
  updateComponentMetrics(
    component: string,
    latencyMs: number,
    success: boolean,
    customMetrics?: Record<string, number>
  ): void {
    const existing = this.componentMetrics.get(component) ?? {
      component,
      averageLatencyMs: 0,
      errorRate: 0,
      throughputPerSecond: 0,
      activeOperations: 0,
      customMetrics: {},
    };

    // Update latency (exponential moving average)
    existing.averageLatencyMs = existing.averageLatencyMs * 0.9 + latencyMs * 0.1;

    // Update error rate
    if (!success) {
      existing.errorRate = Math.min(1, existing.errorRate + 0.01);
    } else {
      existing.errorRate = Math.max(0, existing.errorRate - 0.001);
    }

    // Update custom metrics
    if (customMetrics) {
      for (const [key, value] of Object.entries(customMetrics)) {
        existing.customMetrics[key] = value;
      }
    }

    this.componentMetrics.set(component, existing);
  }

  /**
   * Get performance snapshot
   */
  getPerformanceSnapshot(): PerformanceSnapshot {
    const durationStats = this.getMetricStats(METRIC_NAMES.TASK_DURATION);

    const metrics: PerformanceMetrics = {
      timestamp: new Date(),
      uptime: process.uptime() * 1000,
      activeTasks: 0,
      activeAgents: 0,
      memoryUsageMb: process.memoryUsage().heapUsed / 1024 / 1024,
      cpuUsagePercent: 0, // Would need native module for accurate CPU
      averageLatencyMs: durationStats?.mean ?? 0,
      p50LatencyMs: durationStats?.p50 ?? 0,
      p95LatencyMs: durationStats?.p95 ?? 0,
      p99LatencyMs: durationStats?.p99 ?? 0,
      errorRate: 1 - this.getSuccessRate(),
      throughputPerSecond: this.getThroughput(),
    };

    return {
      id: this.generateId(),
      timestamp: new Date(),
      metrics,
      componentMetrics: Array.from(this.componentMetrics.values()),
    };
  }

  /**
   * Get throughput (tasks per second)
   */
  private getThroughput(): number {
    const oneMinuteAgo = Date.now() - 60000;
    let count = 0;

    for (const record of this.records.values()) {
      if (record.timestamp.getTime() >= oneMinuteAgo) {
        count++;
      }
    }

    return count / 60;
  }

  /**
   * Get all records
   */
  getAllRecords(): TaskMetricsRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Clear old records
   */
  clearOldRecords(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleared = 0;

    for (const [id, record] of this.records) {
      if (record.timestamp.getTime() < cutoff) {
        this.records.delete(id);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Export metrics for external systems
   */
  exportMetrics(): {
    records: TaskMetricsRecord[];
    aggregations: Record<string, ReturnType<TaskMetricsCollector['getMetricStats']>>;
  } {
    const aggregations: Record<string, ReturnType<TaskMetricsCollector['getMetricStats']>> = {};

    for (const name of this.aggregations.keys()) {
      const stats = this.getMetricStats(name);
      if (stats) {
        aggregations[name] = stats;
      }
    }

    return {
      records: this.getAllRecords(),
      aggregations,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`metrics-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultCollector: TaskMetricsCollector | null = null;

/**
 * Get default collector
 */
export function getMetricsCollector(): TaskMetricsCollector {
  if (!defaultCollector) {
    defaultCollector = new TaskMetricsCollector();
  }
  return defaultCollector;
}

/**
 * Create collector
 */
export function createMetricsCollector(): TaskMetricsCollector {
  return new TaskMetricsCollector();
}

/**
 * Record task metrics helper
 */
export function recordTaskMetrics(
  metrics: Omit<TaskMetricsRecord, 'id' | 'timestamp'>
): string {
  return getMetricsCollector().recordTask(metrics);
}

/**
 * Get success rate helper
 */
export function getTaskSuccessRate(periodMs?: number): number {
  return getMetricsCollector().getSuccessRate(periodMs);
}

/**
 * Get average latency helper
 */
export function getTaskAverageLatency(periodMs?: number): number {
  return getMetricsCollector().getAverageLatency(periodMs);
}
