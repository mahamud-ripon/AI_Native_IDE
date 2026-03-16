/**
 * Performance Monitor
 * 
 * Real-time performance monitoring for the AI coding platform.
 * Tracks latency, throughput, and system health.
 */

import * as crypto from 'crypto';
import {
  PerformanceMetrics,
  PerformanceSnapshot,
  ComponentMetrics,
  Alert,
  AlertSeverity,
  AlertRule,
  ObservabilityConfig,
  OBSERVABILITY_DEFAULTS,
  METRIC_NAMES,
} from './observability_types.js';
import { getMetricsCollector } from './task_metrics.js';

/**
 * Performance Monitor
 */
export class PerformanceMonitor {
  private config: Required<Omit<ObservabilityConfig, 'exportEndpoint'>> & { exportEndpoint?: string };
  private snapshots: Map<string, PerformanceSnapshot> = new Map();
  private alerts: Map<string, Alert> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private healthChecks: Map<string, () => Promise<boolean>> = new Map();
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(config?: Partial<ObservabilityConfig>) {
    this.config = { ...OBSERVABILITY_DEFAULTS, ...config };
    this.initializeDefaultRules();
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.collectSnapshot();
      this.checkAlerts();
    }, this.config.alertCheckIntervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Collect performance snapshot
   */
  collectSnapshot(): PerformanceSnapshot {
    const metricsCollector = getMetricsCollector();
    const snapshot = metricsCollector.getPerformanceSnapshot();

    this.snapshots.set(snapshot.id, snapshot);

    // Keep last 1000 snapshots
    if (this.snapshots.size > 1000) {
      const oldest = Array.from(this.snapshots.keys())[0];
      if (oldest) {
        this.snapshots.delete(oldest);
      }
    }

    return snapshot;
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics(): PerformanceMetrics {
    const snapshot = this.collectSnapshot();
    return snapshot.metrics;
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(count: number = 10): PerformanceSnapshot[] {
    return Array.from(this.snapshots.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, count);
  }

  /**
   * Register health check
   */
  registerHealthCheck(name: string, check: () => Promise<boolean>): void {
    this.healthChecks.set(name, check);
  }

  /**
   * Run health checks
   */
  async runHealthChecks(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [name, check] of this.healthChecks) {
      try {
        results[name] = await check();
      } catch {
        results[name] = false;
      }
    }

    return results;
  }

  /**
   * Add alert rule
   */
  addAlertRule(rule: Omit<AlertRule, 'id'>): string {
    const id = this.generateId();
    const fullRule: AlertRule = { ...rule, id };
    this.alertRules.set(id, fullRule);
    return id;
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId: string): boolean {
    return this.alertRules.delete(ruleId);
  }

  /**
   * Get alert rules
   */
  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * Check alerts against current metrics
   */
  private checkAlerts(): void {
    const metrics = this.getCurrentMetrics();

    for (const [id, rule] of this.alertRules) {
      if (!rule.enabled) continue;

      // Check cooldown
      if (rule.lastTriggered) {
        const cooldownEnd = rule.lastTriggered.getTime() + rule.cooldownMs;
        if (Date.now() < cooldownEnd) continue;
      }

      // Get metric value
      const value = this.getMetricValue(metrics, rule.metric);
      if (value === null) continue;

      // Check condition
      const triggered = this.evaluateCondition(value, rule.condition, rule.threshold);

      if (triggered) {
        this.triggerAlert(rule, value);
        rule.lastTriggered = new Date();
      }
    }
  }

  /**
   * Get metric value by name
   */
  private getMetricValue(metrics: PerformanceMetrics, metricName: string): number | null {
    const metricMap: Record<string, keyof PerformanceMetrics> = {
      'latency.average': 'averageLatencyMs',
      'latency.p50': 'p50LatencyMs',
      'latency.p95': 'p95LatencyMs',
      'latency.p99': 'p99LatencyMs',
      'error_rate': 'errorRate',
      'throughput': 'throughputPerSecond',
      'memory': 'memoryUsageMb',
      'active_tasks': 'activeTasks',
      'active_agents': 'activeAgents',
    };

    const key = metricMap[metricName];
    if (!key) return null;

    const value = metrics[key];
    return typeof value === 'number' ? value : null;
  }

  /**
   * Evaluate alert condition
   */
  private evaluateCondition(
    value: number,
    condition: AlertRule['condition'],
    threshold: number
  ): boolean {
    switch (condition) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      case 'neq':
        return value !== threshold;
      case 'threshold':
        return value >= threshold;
      default:
        return false;
    }
  }

  /**
   * Trigger alert
   */
  private triggerAlert(rule: AlertRule, value: number): void {
    const alert: Alert = {
      id: this.generateId(),
      severity: rule.severity,
      component: rule.component,
      message: `${rule.name}: ${rule.metric} = ${value} (threshold: ${rule.threshold})`,
      details: {
        ruleId: rule.id,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
        condition: rule.condition,
      },
      timestamp: new Date(),
      acknowledged: false,
    };

    this.alerts.set(alert.id, alert);

    // Log alert
    this.logAlert(alert);
  }

  /**
   * Log alert (can be overridden for custom logging)
   */
  protected logAlert(alert: Alert): void {
    const level = alert.severity === 'critical' || alert.severity === 'error'
      ? 'error'
      : alert.severity === 'warning'
        ? 'warn'
        : 'info';

    console[level](`[ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`);
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    return true;
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.resolvedAt = new Date();
    return true;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(a => !a.resolvedAt)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get all alerts
   */
  getAllAlerts(limit: number = 100): Alert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: AlertSeverity): Alert[] {
    return Array.from(this.alerts.values())
      .filter(a => a.severity === severity)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Record custom metric
   */
  recordMetric(
    component: string,
    metric: string,
    value: number,
    tags?: Record<string, string>
  ): void {
    // Update component metrics in the collector
    const metricsCollector = getMetricsCollector();
    metricsCollector.updateComponentMetrics(component, value, true, { [metric]: value });
  }

  /**
   * Get component health
   */
  getComponentHealth(): Record<string, { healthy: boolean; latency: number; errorRate: number }> {
    const result: Record<string, { healthy: boolean; latency: number; errorRate: number }> = {};

    const snapshot = this.collectSnapshot();
    for (const cm of snapshot.componentMetrics) {
      result[cm.component] = {
        healthy: cm.errorRate < 0.1 && cm.averageLatencyMs < 5000,
        latency: cm.averageLatencyMs,
        errorRate: cm.errorRate,
      };
    }

    return result;
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultRules(): void {
    // High error rate
    this.addAlertRule({
      name: 'High Error Rate',
      component: 'system',
      metric: 'error_rate',
      condition: 'gt',
      threshold: 0.1, // 10%
      severity: 'warning',
      enabled: true,
      cooldownMs: 60000,
    });

    // Very high error rate
    this.addAlertRule({
      name: 'Critical Error Rate',
      component: 'system',
      metric: 'error_rate',
      condition: 'gt',
      threshold: 0.25, // 25%
      severity: 'critical',
      enabled: true,
      cooldownMs: 30000,
    });

    // High latency
    this.addAlertRule({
      name: 'High Latency',
      component: 'system',
      metric: 'latency.p95',
      condition: 'gt',
      threshold: 10000, // 10 seconds
      severity: 'warning',
      enabled: true,
      cooldownMs: 60000,
    });

    // Memory usage
    this.addAlertRule({
      name: 'High Memory Usage',
      component: 'system',
      metric: 'memory',
      condition: 'gt',
      threshold: 1024, // 1GB
      severity: 'warning',
      enabled: true,
      cooldownMs: 300000,
    });
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`alert-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }

  /**
   * Clear old alerts
   */
  clearOldAlerts(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleared = 0;

    for (const [id, alert] of this.alerts) {
      if (alert.timestamp.getTime() < cutoff && alert.resolvedAt) {
        this.alerts.delete(id);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Export monitoring data
   */
  exportData(): {
    snapshots: PerformanceSnapshot[];
    alerts: Alert[];
    rules: AlertRule[];
  } {
    return {
      snapshots: this.getMetricsHistory(100),
      alerts: this.getAllAlerts(),
      rules: this.getAlertRules(),
    };
  }
}

// Singleton instance
let defaultMonitor: PerformanceMonitor | null = null;

/**
 * Get default monitor
 */
export function getPerformanceMonitor(): PerformanceMonitor {
  if (!defaultMonitor) {
    defaultMonitor = new PerformanceMonitor();
  }
  return defaultMonitor;
}

/**
 * Create monitor
 */
export function createPerformanceMonitor(config?: Partial<ObservabilityConfig>): PerformanceMonitor {
  return new PerformanceMonitor(config);
}

/**
 * Start monitoring helper
 */
export function startMonitoring(): void {
  getPerformanceMonitor().start();
}

/**
 * Stop monitoring helper
 */
export function stopMonitoring(): void {
  getPerformanceMonitor().stop();
}

/**
 * Get current metrics helper
 */
export function getCurrentMetrics(): PerformanceMetrics {
  return getPerformanceMonitor().getCurrentMetrics();
}

/**
 * Get active alerts helper
 */
export function getActiveAlerts(): Alert[] {
  return getPerformanceMonitor().getActiveAlerts();
}
