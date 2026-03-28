/**
 * Generic OpenAI-Compatible Adapter
 *
 * Works with any provider that implements the OpenAI chat completions API:
 * - DeepSeek:    https://api.deepseek.com/v1
 * - SiliconFlow: https://api.siliconflow.cn/v1
 * - NVIDIA NIM:  https://integrate.api.nvidia.com/v1
 * - Xiaomi MiMo: https://api.xiaomimimo.com/v1
 * - OpenRouter:  https://openrouter.ai/api/v1
 * - HuggingFace: https://api-inference.huggingface.co/v1
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { LLMCompletionRequest, AdapterResponse, LLMStreamChunkEvent, LLMToolCall, LLMProvider } from '../types.js';
import { estimateCostUsd } from '../pricing.js';

export type OpenAICompatAdapterConfig = {
  provider: LLMProvider;
  apiKey: string;
  baseUrl: string;
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
};

export type OpenAICompatCompleteResult =
  | { ok: true; response: AdapterResponse }
  | { ok: false; error: string; retryable: boolean };

function mapMessages(req: LLMCompletionRequest): ChatCompletionMessageParam[] {
  return req.messages.map((m): ChatCompletionMessageParam => {
    if (m.role === 'system') {
      return { role: 'system', content: m.content };
    } else if (m.role === 'assistant') {
      return { role: 'assistant', content: m.content };
    } else if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? m.name ?? '' };
    } else {
      return { role: 'user', content: m.content };
    }
  });
}

function mapTools(req: LLMCompletionRequest): ChatCompletionTool[] | undefined {
  if (!req.tools || req.tools.length === 0) return undefined;
  return req.tools.map((t: any) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function createOpenAICompatAdapter(config: OpenAICompatAdapterConfig) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    defaultHeaders: config.extraHeaders,
  });

  async function complete(
    req: LLMCompletionRequest,
    model?: string
  ): Promise<OpenAICompatCompleteResult> {
    const startTime = Date.now();
    const usedModel = model ?? config.defaultModel ?? '';

    try {
      const response = await client.chat.completions.create({
        model: usedModel,
        messages: mapMessages(req),
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
        tools: mapTools(req),
      });

      const choice = response.choices[0];
      const outputText = choice?.message?.content ?? '';

      // Extract tool calls if present
      const toolCalls: LLMToolCall[] | undefined = choice?.message?.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));

      const tokensIn = response.usage?.prompt_tokens ?? 0;
      const tokensOut = response.usage?.completion_tokens ?? 0;
      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCostUsd({ model: usedModel, tokensIn, tokensOut });

      return {
        ok: true,
        response: {
          provider: config.provider,
          model: usedModel,
          outputText,
          toolCalls,
          tokensIn,
          tokensOut,
          latencyMs,
          costUsd,
          cacheHit: false,
        },
      };
    } catch (error: any) {
      const status = error?.status;
      const message = error?.message || 'Unknown error';
      const retryable = status === 429 || (status >= 500 && status < 600);

      return {
        ok: false,
        error: `${config.provider} API error: ${status || 'unknown'} - ${message}`,
        retryable,
      };
    }
  }

  async function* stream(
    req: LLMCompletionRequest,
    model?: string
  ): AsyncGenerator<LLMStreamChunkEvent, void, unknown> {
    const startTime = Date.now();
    const usedModel = model ?? config.defaultModel ?? '';
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const responseStream = await client.chat.completions.create({
        model: usedModel,
        messages: mapMessages(req),
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
      });

      for await (const chunk of responseStream) {
        const delta = chunk.choices?.[0]?.delta;

        if (chunk.usage) {
          tokensIn = chunk.usage.prompt_tokens;
          tokensOut = chunk.usage.completion_tokens;
        }

        if (delta?.content) {
          yield {
            type: 'chunk',
            data: {
              textDelta: delta.content,
            },
          };
        }

        if (chunk.choices?.[0]?.finish_reason === 'stop' || chunk.choices?.[0]?.finish_reason === 'tool_calls') {
          const latencyMs = Date.now() - startTime;
          const costUsd = estimateCostUsd({ model: usedModel, tokensIn, tokensOut });

          yield {
            type: 'done',
            data: {
              tokensIn,
              tokensOut,
              latencyMs,
              costUsd,
              provider: config.provider,
              model: usedModel,
              cacheHit: false,
            },
          };
        }
      }
    } catch (error: any) {
      const message = error?.message || 'Unknown error';
      yield {
        type: 'error',
        data: {
          message: `${config.provider} stream error: ${message}`,
          retryable: error?.status === 429 || (error?.status >= 500),
        },
      };
    }
  }

  return { complete, stream };
}
