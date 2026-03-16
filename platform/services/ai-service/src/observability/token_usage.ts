/**
 * Token Usage Tracker
 * 
 * Tracks LLM token consumption and estimates costs.
 * Provides usage summaries and budget management.
 */

import * as crypto from 'crypto';
import {
  TokenUsageRecord,
  TokenUsageSummary,
  ProviderUsage,
  ModelUsage,
  PricingConfig,
  DEFAULT_PRICING,
} from './observability_types.js';

/**
 * Token Usage Tracker
 */
export class TokenUsageTracker {
  private records: Map<string, TokenUsageRecord> = new Map();
  private pricing: PricingConfig;

  constructor(pricing?: PricingConfig) {
    this.pricing = pricing ?? DEFAULT_PRICING;
  }

  /**
   * Record token usage
   */
  recordUsage(options: {
    workspaceId?: string;
    userId: string;
    taskId?: string;
    agentId?: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
  }): TokenUsageRecord {
    const id = this.generateId();

    // Calculate cost
    const estimatedCostUsd = this.calculateCost(
      options.provider,
      options.model,
      options.promptTokens,
      options.completionTokens,
      options.cachedTokens
    );

    const record: TokenUsageRecord = {
      id,
      workspaceId: options.workspaceId,
      userId: options.userId,
      taskId: options.taskId,
      agentId: options.agentId,
      provider: options.provider,
      model: options.model,
      promptTokens: options.promptTokens,
      completionTokens: options.completionTokens,
      totalTokens: options.promptTokens + options.completionTokens,
      cachedTokens: options.cachedTokens ?? 0,
      estimatedCostUsd,
      timestamp: new Date(),
    };

    this.records.set(id, record);
    return record;
  }

  /**
   * Calculate cost for token usage
   */
  calculateCost(
    provider: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    cachedTokens?: number
  ): number {
    const providerPricing = this.pricing.providers[provider];
    if (!providerPricing) {
      return 0;
    }

    const modelPricing = providerPricing.models[model];
    if (!modelPricing) {
      return 0;
    }

    const promptCost = (promptTokens / 1000) * modelPricing.promptPricePer1k;
    const completionCost = (completionTokens / 1000) * modelPricing.completionPricePer1k;

    let cachedCost = 0;
    if (cachedTokens && modelPricing.cachedPromptPricePer1k) {
      cachedCost = (cachedTokens / 1000) * modelPricing.cachedPromptPricePer1k;
    }

    return promptCost + completionCost + cachedCost;
  }

  /**
   * Get usage summary
   */
  getSummary(options?: {
    workspaceId?: string;
    userId?: string;
    periodStart?: Date;
    periodEnd?: Date;
  }): TokenUsageSummary {
    const periodStart = options?.periodStart ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const periodEnd = options?.periodEnd ?? new Date();

    const filtered = Array.from(this.records.values()).filter(r => {
      if (options?.workspaceId && r.workspaceId !== options.workspaceId) return false;
      if (options?.userId && r.userId !== options.userId) return false;
      if (r.timestamp < periodStart || r.timestamp > periodEnd) return false;
      return true;
    });

    const byProvider: Record<string, ProviderUsage> = {};
    const byModel: Record<string, ModelUsage> = {};

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCachedTokens = 0;
    let totalCostUsd = 0;

    for (const record of filtered) {
      // Aggregate by provider
      if (!byProvider[record.provider]) {
        byProvider[record.provider] = {
          provider: record.provider,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          requestCount: 0,
        };
      }
      byProvider[record.provider].promptTokens += record.promptTokens;
      byProvider[record.provider].completionTokens += record.completionTokens;
      byProvider[record.provider].totalTokens += record.totalTokens;
      byProvider[record.provider].costUsd += record.estimatedCostUsd;
      byProvider[record.provider].requestCount++;

      // Aggregate by model
      const modelKey = `${record.provider}/${record.model}`;
      if (!byModel[modelKey]) {
        byModel[modelKey] = {
          model: modelKey,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          requestCount: 0,
        };
      }
      byModel[modelKey].promptTokens += record.promptTokens;
      byModel[modelKey].completionTokens += record.completionTokens;
      byModel[modelKey].totalTokens += record.totalTokens;
      byModel[modelKey].costUsd += record.estimatedCostUsd;
      byModel[modelKey].requestCount++;

      // Totals
      totalPromptTokens += record.promptTokens;
      totalCompletionTokens += record.completionTokens;
      totalCachedTokens += record.cachedTokens;
      totalCostUsd += record.estimatedCostUsd;
    }

    return {
      workspaceId: options?.workspaceId,
      userId: options?.userId,
      periodStart,
      periodEnd,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      totalCachedTokens,
      totalCostUsd,
      byProvider,
      byModel,
      requestCount: filtered.length,
    };
  }

  /**
   * Get usage by workspace
   */
  getUsageByWorkspace(workspaceId: string): TokenUsageRecord[] {
    return Array.from(this.records.values()).filter(
      r => r.workspaceId === workspaceId
    );
  }

  /**
   * Get usage by user
   */
  getUsageByUser(userId: string): TokenUsageRecord[] {
    return Array.from(this.records.values()).filter(
      r => r.userId === userId
    );
  }

  /**
   * Get usage by task
   */
  getUsageByTask(taskId: string): TokenUsageRecord[] {
    return Array.from(this.records.values()).filter(
      r => r.taskId === taskId
    );
  }

  /**
   * Check budget limit
   */
  checkBudget(
    userId: string,
    budgetUsd: number,
    periodMs: number = 30 * 24 * 60 * 60 * 1000 // 30 days
  ): { withinBudget: boolean; currentUsage: number; remaining: number } {
    const periodStart = new Date(Date.now() - periodMs);
    const summary = this.getSummary({ userId, periodStart });

    const withinBudget = summary.totalCostUsd < budgetUsd;
    const remaining = Math.max(0, budgetUsd - summary.totalCostUsd);

    return {
      withinBudget,
      currentUsage: summary.totalCostUsd,
      remaining,
    };
  }

  /**
   * Get daily usage trend
   */
  getDailyTrend(days: number = 7): Array<{
    date: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    requestCount: number;
  }> {
    const trend: Array<{
      date: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number;
      requestCount: number;
    }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayRecords = Array.from(this.records.values()).filter(r =>
        r.timestamp >= date && r.timestamp < nextDate
      );

      trend.push({
        date: date.toISOString().split('T')[0] ?? '',
        promptTokens: dayRecords.reduce((sum, r) => sum + r.promptTokens, 0),
        completionTokens: dayRecords.reduce((sum, r) => sum + r.completionTokens, 0),
        totalTokens: dayRecords.reduce((sum, r) => sum + r.totalTokens, 0),
        costUsd: dayRecords.reduce((sum, r) => sum + r.estimatedCostUsd, 0),
        requestCount: dayRecords.length,
      });
    }

    return trend;
  }

  /**
   * Get all records
   */
  getAllRecords(): TokenUsageRecord[] {
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
   * Update pricing config
   */
  updatePricing(pricing: PricingConfig): void {
    this.pricing = pricing;
  }

  /**
   * Get pricing config
   */
  getPricing(): PricingConfig {
    return this.pricing;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`token-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultTracker: TokenUsageTracker | null = null;

/**
 * Get default tracker
 */
export function getTokenTracker(): TokenUsageTracker {
  if (!defaultTracker) {
    defaultTracker = new TokenUsageTracker();
  }
  return defaultTracker;
}

/**
 * Create tracker
 */
export function createTokenTracker(pricing?: PricingConfig): TokenUsageTracker {
  return new TokenUsageTracker(pricing);
}

/**
 * Record usage helper
 */
export function recordTokenUsage(options: {
  workspaceId?: string;
  userId: string;
  taskId?: string;
  agentId?: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
}): TokenUsageRecord {
  return getTokenTracker().recordUsage(options);
}

/**
 * Get usage summary helper
 */
export function getTokenUsageSummary(options?: {
  workspaceId?: string;
  userId?: string;
  periodStart?: Date;
  periodEnd?: Date;
}): TokenUsageSummary {
  return getTokenTracker().getSummary(options);
}

/**
 * Calculate cost helper
 */
export function calculateTokenCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens?: number
): number {
  return getTokenTracker().calculateCost(
    provider,
    model,
    promptTokens,
    completionTokens,
    cachedTokens
  );
}
