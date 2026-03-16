/**
 * IDE Telemetry
 *
 * Minimal instrumentation for debugging AI execution flows.
 * Provides metrics for performance monitoring and issue diagnosis.
 *
 * Metrics exposed:
 * - execution_latency: Time from task submission to completion
 * - patch_apply_time: Time to apply patches
 * - editor_transaction_failures: Count of failed transactions
 * - websocket_reconnect_count: WebSocket reconnection attempts
 * - sequencer_replay_requests: Event replay requests due to gaps
 *
 * Architecture:
 *   Components
 *        │
 *   telemetry ← THIS MODULE
 *        │
 *   Console / External Service (future)
 */

// ========================================
// TYPES
// ========================================

export interface TelemetryMetric {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface TelemetryEvent {
  name: string;
  timestamp: number;
  duration?: number;
  properties?: Record<string, unknown>;
}

export interface TelemetryStats {
  // Execution metrics
  executionLatency: {
    count: number;
    total: number;
    min: number;
    max: number;
    avg: number;
  };
  patchApplyTime: {
    count: number;
    total: number;
    min: number;
    max: number;
    avg: number;
  };

  // Failure counts
  transactionFailures: number;
  validationFailures: number;

  // Connection metrics
  websocketReconnectCount: number;
  websocketDisconnectCount: number;

  // Sequencer metrics
  sequencerReplayRequests: number;
  sequencerGapsDetected: number;
  sequencerBackpressureEvents: number;

  // Store metrics
  storeCompactionCount: number;
  storeArchiveCount: number;

  // Last updated
  lastUpdated: number;
}

export type TelemetryCallback = (metric: TelemetryMetric | TelemetryEvent) => void;

// ========================================
// TELEMETRY CLASS
// ========================================

class IDETelemetry {
  private metrics: TelemetryMetric[] = [];
  private events: TelemetryEvent[] = [];
  private callbacks = new Set<TelemetryCallback>();
  private maxMetrics = 1000;
  private maxEvents = 500;

  // Aggregated stats
  private stats: TelemetryStats = {
    executionLatency: { count: 0, total: 0, min: Infinity, max: 0, avg: 0 },
    patchApplyTime: { count: 0, total: 0, min: Infinity, max: 0, avg: 0 },
    transactionFailures: 0,
    validationFailures: 0,
    websocketReconnectCount: 0,
    websocketDisconnectCount: 0,
    sequencerReplayRequests: 0,
    sequencerGapsDetected: 0,
    sequencerBackpressureEvents: 0,
    storeCompactionCount: 0,
    storeArchiveCount: 0,
    lastUpdated: 0,
  };

  // Active timers for duration tracking
  private timers = new Map<string, number>();

  // ========================================
  // METRIC RECORDING
  // ========================================

  /**
   * Record a metric value
   */
  recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    const metric: TelemetryMetric = {
      name,
      value,
      timestamp: Date.now(),
      tags,
    };

    this.metrics.push(metric);

    // Trim if exceeded
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Update aggregated stats
    this.updateStats(name, value);

    // Notify callbacks
    this.notifyCallbacks(metric);

    // Log to console in development
    const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
    if (isDev) {
      console.log(`[Telemetry] ${name}: ${value}`, tags ?? '');
    }
  }

  /**
   * Record an event
   */
  recordEvent(name: string, properties?: Record<string, unknown>): void {
    const event: TelemetryEvent = {
      name,
      timestamp: Date.now(),
      properties,
    };

    this.events.push(event);

    // Trim if exceeded
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Notify callbacks
    this.notifyCallbacks(event);

    // Log to console in development
    const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
    if (isDev) {
      console.log(`[Telemetry] Event: ${name}`, properties ?? '');
    }
  }

  /**
   * Start a timer for duration tracking
   */
  startTimer(name: string): void {
    this.timers.set(name, Date.now());
  }

  /**
   * End a timer and record duration
   */
  endTimer(name: string, recordAsMetric = true): number | null {
    const startTime = this.timers.get(name);
    if (!startTime) return null;

    const duration = Date.now() - startTime;
    this.timers.delete(name);

    if (recordAsMetric) {
      this.recordMetric(name, duration);
    }

    return duration;
  }

  // ========================================
  // SPECIALIZED RECORDING METHODS
  // ========================================

  /**
   * Record execution latency
   */
  recordExecutionLatency(durationMs: number, taskId: string): void {
    this.recordMetric('execution_latency', durationMs, { taskId });
  }

  /**
   * Record patch apply time
   */
  recordPatchApplyTime(durationMs: number, patchId: string, filePath: string): void {
    this.recordMetric('patch_apply_time', durationMs, { patchId, filePath });
  }

  /**
   * Record transaction failure
   */
  recordTransactionFailure(reason: string, editorId?: string): void {
    this.stats.transactionFailures++;
    this.stats.lastUpdated = Date.now();
    this.recordEvent('transaction_failure', { reason, editorId });
  }

  /**
   * Record validation failure
   */
  recordValidationFailure(code: string, filePath: string): void {
    this.stats.validationFailures++;
    this.stats.lastUpdated = Date.now();
    this.recordEvent('validation_failure', { code, filePath });
  }

  /**
   * Record WebSocket reconnect
   */
  recordWebSocketReconnect(): void {
    this.stats.websocketReconnectCount++;
    this.stats.lastUpdated = Date.now();
    this.recordEvent('websocket_reconnect');
  }

  /**
   * Record WebSocket disconnect
   */
  recordWebSocketDisconnect(): void {
    this.stats.websocketDisconnectCount++;
    this.stats.lastUpdated = Date.now();
    this.recordEvent('websocket_disconnect');
  }

  /**
   * Record sequencer replay request
   */
  recordSequencerReplay(taskId: string, sinceSequence: number): void {
    this.stats.sequencerReplayRequests++;
    this.stats.lastUpdated = Date.now();
    this.recordEvent('sequencer_replay', { taskId, sinceSequence });
  }

  /**
   * Record sequencer gap detected
   */
  recordSequencerGap(taskId: string, gapStart: number, gapEnd: number): void {
    this.stats.sequencerGapsDetected++;
    this.stats.lastUpdated = Date.now();
    this.recordEvent('sequencer_gap', { taskId, gapStart, gapEnd });
  }

  /**
   * Record sequencer backpressure event
   */
  recordSequencerBackpressure(taskId: string, pendingCount: number): void {
    this.stats.sequencerBackpressureEvents++;
    this.stats.lastUpdated = Date.now();
    this.recordEvent('sequencer_backpressure', { taskId, pendingCount });
  }

  /**
   * Record store compaction
   */
  recordStoreCompaction(taskId: string, eventsBefore: number, eventsAfter: number): void {
    this.stats.storeCompactionCount++;
    this.stats.lastUpdated = Date.now();
    this.recordEvent('store_compaction', { taskId, eventsBefore, eventsAfter });
  }

  /**
   * Record store archive
   */
  recordStoreArchive(tasksArchived: number): void {
    this.stats.storeArchiveCount += tasksArchived;
    this.stats.lastUpdated = Date.now();
    this.recordEvent('store_archive', { tasksArchived });
  }

  // ========================================
  // AGGREGATED STATS
  // ========================================

  /**
   * Update aggregated stats based on metric name
   */
  private updateStats(name: string, value: number): void {
    switch (name) {
      case 'execution_latency':
        this.updateLatencyStats(this.stats.executionLatency, value);
        break;
      case 'patch_apply_time':
        this.updateLatencyStats(this.stats.patchApplyTime, value);
        break;
    }
    this.stats.lastUpdated = Date.now();
  }

  /**
   * Update latency stats helper
   */
  private updateLatencyStats(
    stats: { count: number; total: number; min: number; max: number; avg: number },
    value: number
  ): void {
    stats.count++;
    stats.total += value;
    stats.min = Math.min(stats.min, value);
    stats.max = Math.max(stats.max, value);
    stats.avg = stats.total / stats.count;
  }

  /**
   * Get current stats
   */
  getStats(): TelemetryStats {
    return { ...this.stats };
  }

  /**
   * Get recent metrics
   */
  getRecentMetrics(count = 100): TelemetryMetric[] {
    return this.metrics.slice(-count);
  }

  /**
   * Get recent events
   */
  getRecentEvents(count = 50): TelemetryEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Get metrics by name
   */
  getMetricsByName(name: string): TelemetryMetric[] {
    return this.metrics.filter(m => m.name === name);
  }

  // ========================================
  // CALLBACKS
  // ========================================

  /**
   * Subscribe to telemetry events
   */
  subscribe(callback: TelemetryCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Notify all callbacks
   */
  private notifyCallbacks(data: TelemetryMetric | TelemetryEvent): void {
    this.callbacks.forEach(cb => {
      try {
        cb(data);
      } catch (error) {
        console.error('[Telemetry] Callback error:', error);
      }
    });
  }

  // ========================================
  // RESET
  // ========================================

  /**
   * Reset all telemetry data
   */
  reset(): void {
    this.metrics = [];
    this.events = [];
    this.timers.clear();
    this.stats = {
      executionLatency: { count: 0, total: 0, min: Infinity, max: 0, avg: 0 },
      patchApplyTime: { count: 0, total: 0, min: Infinity, max: 0, avg: 0 },
      transactionFailures: 0,
      validationFailures: 0,
      websocketReconnectCount: 0,
      websocketDisconnectCount: 0,
      sequencerReplayRequests: 0,
      sequencerGapsDetected: 0,
      sequencerBackpressureEvents: 0,
      storeCompactionCount: 0,
      storeArchiveCount: 0,
      lastUpdated: 0,
    };
  }

  /**
   * Export telemetry data for debugging
   */
  export(): {
    stats: TelemetryStats;
    recentMetrics: TelemetryMetric[];
    recentEvents: TelemetryEvent[];
  } {
    return {
      stats: this.getStats(),
      recentMetrics: this.getRecentMetrics(100),
      recentEvents: this.getRecentEvents(50),
    };
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const telemetry = new IDETelemetry();

// ========================================
// CONVENIENCE EXPORTS
// ========================================

export const recordExecutionLatency = telemetry.recordExecutionLatency.bind(telemetry);
export const recordPatchApplyTime = telemetry.recordPatchApplyTime.bind(telemetry);
export const recordTransactionFailure = telemetry.recordTransactionFailure.bind(telemetry);
export const recordValidationFailure = telemetry.recordValidationFailure.bind(telemetry);
export const recordWebSocketReconnect = telemetry.recordWebSocketReconnect.bind(telemetry);
export const recordWebSocketDisconnect = telemetry.recordWebSocketDisconnect.bind(telemetry);
export const recordSequencerReplay = telemetry.recordSequencerReplay.bind(telemetry);
export const recordSequencerGap = telemetry.recordSequencerGap.bind(telemetry);
export const recordSequencerBackpressure = telemetry.recordSequencerBackpressure.bind(telemetry);
export const recordStoreCompaction = telemetry.recordStoreCompaction.bind(telemetry);
export const recordStoreArchive = telemetry.recordStoreArchive.bind(telemetry);
export const getTelemetryStats = telemetry.getStats.bind(telemetry);

export default telemetry;
