/**
 * Execution Event Sequencer
 *
 * Enforces sequence ordering for execution events.
 * Ensures events are processed in order, requesting replay if gaps detected.
 *
 * Architecture:
 *   ExecutionStreamClient
 *           │
 *   ExecutionEventSequencer ← THIS MODULE
 *           │
 *   executionStore
 *
 * Logic:
 *   if event.sequence != lastSequence + 1
 *       requestReplay(lastSequence)
 */

import { useExecutionStore } from '../state/executionStore';

// ========================================
// TYPES
// ========================================

export interface SequencedEvent {
  taskId: string;
  sequence: number;
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface SequencerState {
  lastSequence: Map<string, number>;
  pendingEvents: Map<string, SequencedEvent[]>;
  gaps: Map<string, { from: number; to: number }[]>;
}

export interface ReplayRequest {
  taskId: string;
  sinceSequence: number;
}

// ========================================
// SEQUENCER CLASS
// ========================================

class ExecutionEventSequencer {
  private lastSequence = new Map<string, number>();
  private pendingEvents = new Map<string, Map<number, SequencedEvent>>();
  private gaps = new Map<string, { from: number; to: number }[]>();
  private replayCallbacks = new Set<(request: ReplayRequest) => void>();
  private maxPendingEvents = 100;
  private gapTimeout = 5000; // 5 seconds
  private gapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private backpressureThreshold = 100; // Force replay when pending > 100

  // ========================================
  // EVENT PROCESSING
  // ========================================

  /**
   * Process an incoming event with sequence enforcement
   */
  processEvent(event: SequencedEvent): {
    processed: boolean;
    ordered: SequencedEvent[];
    gap: boolean;
    replayRequest?: ReplayRequest;
  } {
    const { taskId, sequence } = event;
    const last = this.lastSequence.get(taskId) ?? 0;

    // Check if this is the expected next event
    if (sequence === last + 1 || (last === 0 && sequence === 1)) {
      // In order - process immediately
      this.lastSequence.set(taskId, sequence);
      
      // Process any pending events that follow
      const ordered = this.processPendingEvents(taskId, sequence);

      return {
        processed: true,
        ordered: [event, ...ordered],
        gap: false,
      };
    }

    // Check if this is a duplicate (already processed)
    if (sequence <= last) {
      console.log(`[EventSequencer] Duplicate event ${sequence} for task ${taskId}, last was ${last}`);
      return {
        processed: false,
        ordered: [],
        gap: false,
      };
    }

    // Gap detected - event arrived out of order
    if (sequence > last + 1) {
      const gapStart = last + 1;
      const gapEnd = sequence - 1;

      console.warn(
        `[EventSequencer] Gap detected for task ${taskId}: expected ${last + 1}, got ${sequence}`,
        `Missing events: ${gapStart}-${gapEnd}`
      );

      // Record the gap
      this.recordGap(taskId, gapStart, gapEnd);

      // Store event as pending (with backpressure check)
      const storeResult = this.storePendingEvent(taskId, event);

      // Handle backpressure - return forced replay request
      if (storeResult.forceReplay && storeResult.replayRequest) {
        return {
          processed: false,
          ordered: [],
          gap: true,
          replayRequest: storeResult.replayRequest,
        };
      }

      // Request replay
      const replayRequest: ReplayRequest = {
        taskId,
        sinceSequence: last,
      };

      // Set timeout for gap resolution
      this.setGapTimeout(taskId, replayRequest);

      return {
        processed: false,
        ordered: [],
        gap: true,
        replayRequest,
      };
    }

    return {
      processed: false,
      ordered: [],
      gap: false,
    };
  }

  /**
   * Process pending events that follow a sequence
   */
  private processPendingEvents(taskId: string, fromSequence: number): SequencedEvent[] {
    const pending = this.pendingEvents.get(taskId);
    if (!pending) return [];

    const ordered: SequencedEvent[] = [];
    let current = fromSequence;

    // Process events in order
    while (pending.has(current + 1)) {
      const event = pending.get(current + 1)!;
      ordered.push(event);
      pending.delete(current + 1);
      this.lastSequence.set(taskId, current + 1);
      current++;
    }

    // Clear gaps that have been resolved
    this.clearResolvedGaps(taskId, fromSequence);

    return ordered;
  }

  /**
   * Store a pending event for later processing
   */
  private storePendingEvent(taskId: string, event: SequencedEvent): { forceReplay: boolean; replayRequest?: ReplayRequest } {
    if (!this.pendingEvents.has(taskId)) {
      this.pendingEvents.set(taskId, new Map());
    }

    const pending = this.pendingEvents.get(taskId)!;

    // Check capacity
    if (pending.size >= this.maxPendingEvents) {
      console.warn(`[EventSequencer] Max pending events reached for task ${taskId}`);
      // Remove oldest pending event
      const oldest = Math.min(...pending.keys());
      pending.delete(oldest);
    }

    pending.set(event.sequence, event);

    // Backpressure protection - force replay if too many pending events
    if (pending.size >= this.backpressureThreshold) {
      const last = this.lastSequence.get(taskId) ?? 0;
      console.warn(
        `[EventSequencer] Backpressure triggered for task ${taskId}: ${pending.size} pending events, forcing replay from sequence ${last}`
      );

      // Clear pending events (they'll be re-fetched via replay)
      pending.clear();

      return {
        forceReplay: true,
        replayRequest: {
          taskId,
          sinceSequence: last,
        },
      };
    }

    return { forceReplay: false };
  }

  /**
   * Record a gap in sequence
   */
  private recordGap(taskId: string, from: number, to: number): void {
    if (!this.gaps.has(taskId)) {
      this.gaps.set(taskId, []);
    }

    const gaps = this.gaps.get(taskId)!;
    gaps.push({ from, to });
  }

  /**
   * Clear resolved gaps
   */
  private clearResolvedGaps(taskId: string, upTo: number): void {
    const gaps = this.gaps.get(taskId);
    if (!gaps) return;

    const remaining = gaps.filter(g => g.to > upTo);
    
    if (remaining.length === 0) {
      this.gaps.delete(taskId);
    } else {
      this.gaps.set(taskId, remaining);
    }
  }

  /**
   * Set timeout for gap resolution
   */
  private setGapTimeout(taskId: string, request: ReplayRequest): void {
    // Clear existing timer
    const existingTimer = this.gapTimers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      console.log(`[EventSequencer] Gap timeout for task ${taskId}, requesting replay`);
      this.requestReplay(request);
      this.gapTimers.delete(taskId);
    }, this.gapTimeout);

    this.gapTimers.set(taskId, timer);
  }

  /**
   * Request replay from stream
   */
  private requestReplay(request: ReplayRequest): void {
    this.replayCallbacks.forEach(cb => {
      try {
        cb(request);
      } catch (error) {
        console.error('[EventSequencer] Replay callback error:', error);
      }
    });
  }

  // ========================================
  // REPLAY HANDLING
  // ========================================

  /**
   * Handle replayed events
   */
  processReplayedEvents(taskId: string, events: SequencedEvent[]): SequencedEvent[] {
    const last = this.lastSequence.get(taskId) ?? 0;
    const ordered: SequencedEvent[] = [];

    // Sort by sequence
    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);

    for (const event of sorted) {
      if (event.sequence > last) {
        ordered.push(event);
        this.lastSequence.set(taskId, event.sequence);
      }
    }

    // Process any pending events that follow
    const pending = this.processPendingEvents(taskId, this.lastSequence.get(taskId) ?? 0);
    ordered.push(...pending);

    // Clear gap timer
    const timer = this.gapTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.gapTimers.delete(taskId);
    }

    console.log(`[EventSequencer] Processed ${ordered.length} replayed events for task ${taskId}`);

    return ordered;
  }

  /**
   * Register callback for replay requests
   */
  onReplayRequest(callback: (request: ReplayRequest) => void): () => void {
    this.replayCallbacks.add(callback);
    return () => this.replayCallbacks.delete(callback);
  }

  // ========================================
  // STATE MANAGEMENT
  // ========================================

  /**
   * Get last sequence for a task
   */
  getLastSequence(taskId: string): number {
    return this.lastSequence.get(taskId) ?? 0;
  }

  /**
   * Set last sequence (for initialization)
   */
  setLastSequence(taskId: string, sequence: number): void {
    this.lastSequence.set(taskId, sequence);
  }

  /**
   * Get pending events count
   */
  getPendingCount(taskId: string): number {
    return this.pendingEvents.get(taskId)?.size ?? 0;
  }

  /**
   * Get gaps for a task
   */
  getGaps(taskId: string): { from: number; to: number }[] {
    return this.gaps.get(taskId) ?? [];
  }

  /**
   * Check if sequencer is healthy (no gaps)
   */
  isHealthy(taskId: string): boolean {
    return (this.gaps.get(taskId)?.length ?? 0) === 0;
  }

  /**
   * Get sequencer stats
   */
  getStats(): {
    tasks: number;
    totalPending: number;
    totalGaps: number;
  } {
    let totalPending = 0;
    let totalGaps = 0;

    for (const pending of this.pendingEvents.values()) {
      totalPending += pending.size;
    }

    for (const gaps of this.gaps.values()) {
      totalGaps += gaps.length;
    }

    return {
      tasks: this.lastSequence.size,
      totalPending,
      totalGaps,
    };
  }

  /**
   * Clear state for a task
   */
  clearTask(taskId: string): void {
    this.lastSequence.delete(taskId);
    this.pendingEvents.delete(taskId);
    this.gaps.delete(taskId);

    const timer = this.gapTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.gapTimers.delete(taskId);
    }
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.lastSequence.clear();
    this.pendingEvents.clear();
    this.gaps.clear();

    for (const timer of this.gapTimers.values()) {
      clearTimeout(timer);
    }
    this.gapTimers.clear();
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const executionEventSequencer = new ExecutionEventSequencer();

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Wrap an event handler with sequencing
 */
export function withSequencing(
  handler: (events: SequencedEvent[]) => void,
  replayHandler: (request: ReplayRequest) => void
): (event: SequencedEvent) => void {
  // Register replay callback
  executionEventSequencer.onReplayRequest(replayHandler);

  return (event: SequencedEvent) => {
    const result = executionEventSequencer.processEvent(event);

    if (result.ordered.length > 0) {
      handler(result.ordered);
    }

    if (result.replayRequest) {
      replayHandler(result.replayRequest);
    }
  };
}

export default executionEventSequencer;
