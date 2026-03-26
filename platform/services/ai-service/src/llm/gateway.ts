import Redis from 'ioredis';
import crypto from 'crypto';
import type { LLMCompletionRequest, LLMCompletionResponse, LLMStreamChunkEvent, LLMProvider } from './types.js';
import { resolveRoute } from './router.js';
import { createOpenAIAdapter } from './adapters/openai.js';
import { createAnthropicAdapter } from './adapters/anthropic.js';
import { createGroqAdapter } from './adapters/groq.js';
import { createMockAdapter } from './adapters/mock.js';
import { createLLMCache } from './cache.js';
import { createQuotaManager } from './quota.js';
import { createMetricsCollector } from './metrics.js';
import { emitLlmCallCompleted, emitLlmCallFailed } from '../kafka/ai_llm_events.js';
import { config } from '../config.js';

// Last-resort mock capabilities for fallback chain
const MOCK_FALLBACK_CAPABILITIES = {
  supportsTools: true,
  supportsVision: false,
  supportsStreaming: true,
  maxContextTokens: 128000,
};

// Structured logger for gateway observability
const log = {
  info: (message: string, data: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'INFO', message, timestamp: new Date().toISOString(), ...data }));
  },
  warn: (message: string, data: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'WARN', message, timestamp: new Date().toISOString(), ...data }));
  },
  error: (message: string, data: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: 'ERROR', message, timestamp: new Date().toISOString(), ...data }));
  },
};

export type LLMGatewayConfig = {
  redis: Redis;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  groqApiKey?: string;
};

export type LLMGateway = {
  complete(req: LLMCompletionRequest): Promise<LLMCompletionResponse>;
  stream(req: LLMCompletionRequest): AsyncGenerator<LLMStreamChunkEvent, void, unknown>;
};

export function createLLMGateway(gatewayConfig: LLMGatewayConfig): LLMGateway {
  const redis = gatewayConfig.redis;

  const openaiAdapter = gatewayConfig.openaiApiKey
    ? createOpenAIAdapter({ apiKey: gatewayConfig.openaiApiKey })
    : null;

  const anthropicAdapter = gatewayConfig.anthropicApiKey
    ? createAnthropicAdapter({ apiKey: gatewayConfig.anthropicApiKey })
    : null;

  const groqAdapter = gatewayConfig.groqApiKey
    ? createGroqAdapter({ apiKey: gatewayConfig.groqApiKey })
    : null;

  // Mock adapter always available for testing
  const mockAdapter = createMockAdapter({ latencyMs: 200 });

  const cache = createLLMCache({ redis });
  const quota = createQuotaManager({ redis });
  const metrics = createMetricsCollector();

  function getAdapter(provider: LLMProvider) {
    switch (provider) {
      case 'openai':
        return openaiAdapter;
      case 'anthropic':
        return anthropicAdapter;
      case 'groq':
        return groqAdapter;
      case 'mock':
        return mockAdapter;
      default:
        return null;
    }
  }

  function generateRequestId(): string {
    return `req_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  function ensureRequestId(req: LLMCompletionRequest): string {
    return req.requestId ?? generateRequestId();
  }

  async function complete(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const requestId = ensureRequestId(req);
    const route = resolveRoute(req);
    const estimatedTokens = req.maxTokens ?? 4096;

    log.info('LLM request started', {
      requestId,
      workflowId: req.workflowId,
      projectId: req.projectId,
      agentName: req.agentName,
      stepName: req.stepName,
      taskType: req.taskType,
      provider: route.provider,
      model: route.model,
    });

    // Quota check (user-level mandatory, org-level optional)
    const quotaResult = await quota.assertQuota({
      userId: req.userId ?? 'anonymous',
      orgId: req.orgId,
      tokensRequested: estimatedTokens,
    });

    if (!quotaResult.allowed) {
      log.warn('Quota exceeded', {
        requestId,
        userId: req.userId,
        orgId: req.orgId,
        reason: quotaResult.reason,
        limit: quotaResult.limit,
        current: quotaResult.current,
      });
      const error = new Error(quotaResult.reason);
      (error as any).quotaExceeded = true;
      (error as any).limit = quotaResult.limit;
      (error as any).current = quotaResult.current;
      throw error;
    }

    // Check cache
    const cacheResult = await cache.get({
      provider: route.provider,
      model: route.model,
      request: req,
    });

    if (cacheResult.hit && cacheResult.response) {
      log.info('Cache hit', {
        requestId,
        provider: route.provider,
        model: route.model,
      });
      const response: LLMCompletionResponse = {
        requestId,
        provider: route.provider,
        model: route.model,
        outputText: cacheResult.response,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        costUsd: 0,
        cacheHit: true,
      };

      metrics.recordCall({
        provider: route.provider,
        model: route.model,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        costUsd: 0,
        cacheHit: true,
        success: true,
      });

      return response;
    }

    // Try primary provider, then fallback chain, then mock as last resort
    const providersToTry = [
      { provider: route.provider, model: route.model, capabilities: route.capabilities },
      ...route.fallbackChain,
      { provider: 'mock' as LLMProvider, model: 'mock-llm-v1', capabilities: MOCK_FALLBACK_CAPABILITIES },
    ];

    let lastError: Error | null = null;

    for (const { provider, model } of providersToTry) {
      const adapter = getAdapter(provider);
      if (!adapter) continue;

      const result = await adapter.complete(req, model);

      if (result.ok) {
        const response: LLMCompletionResponse = {
          ...result.response,
          requestId,
        };

        log.info('LLM request completed', {
          requestId,
          workflowId: req.workflowId,
          agentName: req.agentName,
          stepName: req.stepName,
          provider: response.provider,
          model: response.model,
          tokensIn: response.tokensIn,
          tokensOut: response.tokensOut,
          latencyMs: response.latencyMs,
          costUsd: response.costUsd,
          cacheHit: response.cacheHit,
        });

        // Record tokens for quota
        if (req.userId) {
          await quota.recordUserTokens(req.userId, response.tokensIn + response.tokensOut);
        }
        if (req.orgId) {
          await quota.recordOrgTokens(req.orgId, response.tokensIn + response.tokensOut);
        }

        // Cache the response if cacheable
        await cache.set({
          provider,
          model,
          request: req,
          response: response.outputText,
        });

        // Emit Kafka event
        await emitLlmCallCompleted({
          requestId,
          workflowId: req.workflowId,
          projectId: req.projectId,
          userId: req.userId,
          orgId: req.orgId,
          agentName: req.agentName,
          stepName: req.stepName,
          provider: response.provider,
          model: response.model,
          tokensIn: response.tokensIn,
          tokensOut: response.tokensOut,
          latencyMs: response.latencyMs,
          cacheHit: response.cacheHit,
          costUsd: response.costUsd,
          timestamp: new Date().toISOString(),
        });

        metrics.recordCall({
          provider: response.provider,
          model: response.model,
          tokensIn: response.tokensIn,
          tokensOut: response.tokensOut,
          latencyMs: response.latencyMs,
          costUsd: response.costUsd,
          cacheHit: response.cacheHit,
          success: true,
        });

        return response;
      }

      lastError = new Error(result.error);

      // Only retry on retryable errors
      if (!result.retryable) {
        break;
      }
    }

    // All providers failed
    const error = lastError ?? new Error('No LLM providers available');

    log.error('LLM request failed', {
      requestId,
      workflowId: req.workflowId,
      agentName: req.agentName,
      stepName: req.stepName,
      provider: route.provider,
      model: route.model,
      error: error.message,
    });

    await emitLlmCallFailed({
      requestId,
      workflowId: req.workflowId,
      projectId: req.projectId,
      userId: req.userId,
      orgId: req.orgId,
      agentName: req.agentName,
      stepName: req.stepName,
      provider: route.provider,
      model: route.model,
      error: error.message,
      retryable: true,
      timestamp: new Date().toISOString(),
    });

    metrics.recordCall({
      provider: route.provider,
      model: route.model,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      costUsd: 0,
      cacheHit: false,
      success: false,
    });

    throw error;
  }

  async function* stream(
    req: LLMCompletionRequest
  ): AsyncGenerator<LLMStreamChunkEvent, void, unknown> {
    const requestId = ensureRequestId(req);
    const route = resolveRoute(req);
    const estimatedTokens = req.maxTokens ?? 4096;

    log.info('LLM stream started', {
      requestId,
      workflowId: req.workflowId,
      agentName: req.agentName,
      stepName: req.stepName,
      taskType: req.taskType,
      primaryProvider: route.provider,
      primaryModel: route.model,
    });

    // Quota check
    const quotaResult = await quota.assertQuota({
      userId: req.userId ?? 'anonymous',
      orgId: req.orgId,
      tokensRequested: estimatedTokens,
    });

    if (!quotaResult.allowed) {
      log.warn('Stream quota exceeded', { requestId, userId: req.userId, reason: quotaResult.reason });
      yield {
        type: 'error',
        data: {
          message: quotaResult.reason,
          retryable: false,
        },
      };
      return;
    }

    // Build provider list: primary + fallback chain + mock as last resort
    const providersToTry = [
      { provider: route.provider, model: route.model },
      ...route.fallbackChain,
      { provider: 'mock' as LLMProvider, model: 'mock-llm-v1' },
    ];

    for (const { provider, model } of providersToTry) {
      const adapter = getAdapter(provider);
      if (!adapter) {
        log.warn('Skipping unavailable adapter', { requestId, provider, model });
        continue;
      }

      log.info('Attempting stream with adapter', { requestId, provider, model });

      let tokensIn = 0;
      let tokensOut = 0;
      let latencyMs = 0;
      let costUsd = 0;
      let streamHadError = false;

      try {
        for await (const event of adapter.stream(req, model)) {
          if (event.type === 'done') {
            tokensIn = event.data.tokensIn;
            tokensOut = event.data.tokensOut;
            latencyMs = event.data.latencyMs;
            costUsd = event.data.costUsd;

            // Record tokens
            if (req.userId) {
              await quota.recordUserTokens(req.userId, tokensIn + tokensOut);
            }
            if (req.orgId) {
              await quota.recordOrgTokens(req.orgId, tokensIn + tokensOut);
            }

            // Emit Kafka event
            await emitLlmCallCompleted({
              requestId,
              workflowId: req.workflowId,
              projectId: req.projectId,
              userId: req.userId,
              orgId: req.orgId,
              agentName: req.agentName,
              stepName: req.stepName,
              provider,
              model,
              tokensIn,
              tokensOut,
              latencyMs,
              cacheHit: false,
              costUsd,
              timestamp: new Date().toISOString(),
            });

            metrics.recordCall({
              provider,
              model,
              tokensIn,
              tokensOut,
              latencyMs,
              costUsd,
              cacheHit: false,
              success: true,
            });
          }

          if (event.type === 'error') {
            streamHadError = true;
            log.error('Stream adapter error', { requestId, provider, model, error: event.data.message });

            await emitLlmCallFailed({
              requestId,
              workflowId: req.workflowId,
              projectId: req.projectId,
              userId: req.userId,
              orgId: req.orgId,
              agentName: req.agentName,
              stepName: req.stepName,
              provider,
              model,
              error: event.data.message,
              retryable: event.data.retryable ?? true,
              timestamp: new Date().toISOString(),
            });

            metrics.recordCall({
              provider,
              model,
              tokensIn: 0,
              tokensOut: 0,
              latencyMs: 0,
              costUsd: 0,
              cacheHit: false,
              success: false,
            });
          }

          yield event;
        }

        // If stream completed without error, we're done
        if (!streamHadError) {
          log.info('LLM stream completed successfully', { requestId, provider, model });
          return;
        }
        // If there was an error, try next provider
      } catch (err: any) {
        log.error('Stream adapter exception', { requestId, provider, model, error: err.message });
        // Try next provider in fallback chain
        continue;
      }
    }

    // All providers failed
    log.error('All stream providers failed', { requestId, taskType: req.taskType });
    yield {
      type: 'error',
      data: {
        message: 'All LLM providers failed for streaming',
        retryable: true,
      },
    };
  }

  return { complete, stream };
}

// Singleton instance
let gatewayInstance: LLMGateway | null = null;

export async function getLLMGateway(): Promise<LLMGateway> {
  if (!gatewayInstance) {
    const redis = new Redis(config.redisUrl);

    gatewayInstance = createLLMGateway({
      redis,
      openaiApiKey: config.openaiApiKey,
      anthropicApiKey: config.anthropicApiKey,
      groqApiKey: config.groqApiKey,
    });
  }

  return gatewayInstance;
}
