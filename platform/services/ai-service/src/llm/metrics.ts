import type { LLMProvider } from './types.js';

export type LLMMetricsCollector = {
  recordCall(args: {
    provider: LLMProvider;
    model: string;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    costUsd: number;
    cacheHit: boolean;
    success: boolean;
  }): void;

  getStats(): LLMMetricsStats;

  reset(): void;
};

export type LLMMetricsStats = {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  byProvider: Record<LLMProvider, ProviderStats>;
};

export type ProviderStats = {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  avgLatencyMs: number;
};

export function createMetricsCollector(): LLMMetricsCollector {
  const stats: LLMMetricsStats = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCostUsd: 0,
    cacheHitRate: 0,
    avgLatencyMs: 0,
    byProvider: {
      openai: { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, avgLatencyMs: 0 },
      anthropic: { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, avgLatencyMs: 0 },
      groq: { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, avgLatencyMs: 0 },
      mock: { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, avgLatencyMs: 0 },
    },
  };

  let totalLatency = 0;
  let cacheHits = 0;

  function recordCall(args: {
    provider: LLMProvider;
    model: string;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    costUsd: number;
    cacheHit: boolean;
    success: boolean;
  }): void {
    stats.totalCalls += 1;

    if (args.success) {
      stats.successfulCalls += 1;
      stats.totalTokensIn += args.tokensIn;
      stats.totalTokensOut += args.tokensOut;
      stats.totalCostUsd += args.costUsd;
      totalLatency += args.latencyMs;
      stats.avgLatencyMs = Math.round(totalLatency / stats.successfulCalls);

      if (args.cacheHit) {
        cacheHits += 1;
      }
      stats.cacheHitRate = stats.successfulCalls > 0 
        ? cacheHits / stats.successfulCalls 
        : 0;

      const providerStats = stats.byProvider[args.provider];
      providerStats.calls += 1;
      providerStats.tokensIn += args.tokensIn;
      providerStats.tokensOut += args.tokensOut;
      providerStats.costUsd += args.costUsd;
      providerStats.avgLatencyMs = Math.round(
        (providerStats.avgLatencyMs * (providerStats.calls - 1) + args.latencyMs) /
          providerStats.calls
      );
    } else {
      stats.failedCalls += 1;
    }
  }

  function getStats(): LLMMetricsStats {
    return { ...stats };
  }

  function reset(): void {
    stats.totalCalls = 0;
    stats.successfulCalls = 0;
    stats.failedCalls = 0;
    stats.totalTokensIn = 0;
    stats.totalTokensOut = 0;
    stats.totalCostUsd = 0;
    stats.cacheHitRate = 0;
    stats.avgLatencyMs = 0;
    totalLatency = 0;
    cacheHits = 0;

    for (const provider of Object.keys(stats.byProvider) as LLMProvider[]) {
      stats.byProvider[provider] = {
        calls: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        avgLatencyMs: 0,
      };
    }
  }

  return { recordCall, getStats, reset };
}
