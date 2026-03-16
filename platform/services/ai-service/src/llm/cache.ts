import Redis from 'ioredis';
import crypto from 'crypto';
import type { LLMCompletionRequest } from './types.js';

export type LLMCacheConfig = {
  redis: Redis;
  ttlSeconds?: number;
  cacheableTaskTypes?: Set<string>;
};

const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const DEFAULT_CACHEABLE_TASK_TYPES = new Set(['plan', 'qa', 'security']);

export function createLLMCache(config: LLMCacheConfig) {
  const redis = config.redis;
  const ttlSeconds = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const cacheableTaskTypes = config.cacheableTaskTypes ?? DEFAULT_CACHEABLE_TASK_TYPES;

  function computeCacheKey(args: {
    provider: string;
    model: string;
    request: LLMCompletionRequest;
    toolSchemaHash?: string;
    contextHash?: string;
  }): string {
    const systemPrompt = args.request.messages.find(m => m.role === 'system')?.content ?? '';
    const nonSystemMessages = args.request.messages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role}:${m.content}`)
      .join('|');

    const hashInput = [
      `provider:${args.provider}`,
      `model:${args.model}`,
      `system:${hashString(systemPrompt)}`,
      `messages:${hashString(nonSystemMessages)}`,
      `context:${args.contextHash ?? 'none'}`,
      `tools:${args.toolSchemaHash ?? 'none'}`,
      `temp:${args.request.temperature ?? 0.7}`,
      `max:${args.request.maxTokens ?? 4096}`,
    ].join('|');

    return `llm:cache:${hashString(hashInput)}`;
  }

  function hashString(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
  }

  function isCacheable(req: LLMCompletionRequest): boolean {
    const temperature = req.temperature ?? 0.7;
    const lowTemperature = temperature <= 0.2;
    const cacheableTaskType = cacheableTaskTypes.has(req.taskType);

    return lowTemperature && cacheableTaskType;
  }

  async function get(args: {
    provider: string;
    model: string;
    request: LLMCompletionRequest;
    toolSchemaHash?: string;
    contextHash?: string;
  }): Promise<{ hit: boolean; response?: string }> {
    if (!isCacheable(args.request)) {
      return { hit: false };
    }

    const key = computeCacheKey(args);
    const cached = await redis.get(key);

    if (cached) {
      return { hit: true, response: cached };
    }

    return { hit: false };
  }

  async function set(args: {
    provider: string;
    model: string;
    request: LLMCompletionRequest;
    response: string;
    toolSchemaHash?: string;
    contextHash?: string;
  }): Promise<void> {
    if (!isCacheable(args.request)) {
      return;
    }

    const key = computeCacheKey({
      provider: args.provider,
      model: args.model,
      request: args.request,
      toolSchemaHash: args.toolSchemaHash,
      contextHash: args.contextHash,
    });

    await redis.set(key, args.response, 'EX', ttlSeconds);
  }

  return { get, set, isCacheable, computeCacheKey };
}
