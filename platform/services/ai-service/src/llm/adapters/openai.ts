import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { LLMCompletionRequest, AdapterResponse, LLMStreamChunkEvent } from '../types.js';
import { estimateCostUsd } from '../pricing.js';

export type OpenAIAdapterConfig = {
  apiKey: string;
  defaultModel?: string;
};

export type OpenAICompleteResult =
  | { ok: true; response: AdapterResponse }
  | { ok: false; error: string; retryable: boolean };

export type OpenAIStreamResult = AsyncGenerator<LLMStreamChunkEvent, void, unknown>;

function mapMessages(req: LLMCompletionRequest): ChatCompletionMessageParam[] {
  return req.messages.map((m): ChatCompletionMessageParam => {
    if (m.role === 'system') {
      return { role: 'system', content: m.content };
    } else if (m.role === 'user') {
      return { role: 'user', content: m.content };
    } else if (m.role === 'assistant') {
      return { role: 'assistant', content: m.content };
    } else {
      return { role: 'tool', content: m.content, tool_call_id: m.name ?? '' };
    }
  });
}

export function createOpenAIAdapter(config: OpenAIAdapterConfig) {
  const client = new OpenAI({ apiKey: config.apiKey });

  async function complete(
    req: LLMCompletionRequest,
    model: string
  ): Promise<OpenAICompleteResult> {
    const startTime = Date.now();

    try {
      const response = await client.chat.completions.create({
        model,
        messages: mapMessages(req),
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
      });

      const choice = response.choices[0];
      const outputText = choice?.message?.content ?? '';

      const tokensIn = response.usage?.prompt_tokens ?? 0;
      const tokensOut = response.usage?.completion_tokens ?? 0;
      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCostUsd({ model, tokensIn, tokensOut });

      return {
        ok: true,
        response: {
          provider: 'openai',
          model,
          outputText,
          tokensIn,
          tokensOut,
          latencyMs,
          costUsd,
          cacheHit: false,
        },
      };
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const retryable =
        status === 429 ||
        status === 503 ||
        status === 500 ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'ETIMEDOUT';

      return {
        ok: false,
        error: err?.message ?? 'Unknown OpenAI error',
        retryable,
      };
    }
  }

  async function* stream(
    req: LLMCompletionRequest,
    model: string
  ): OpenAIStreamResult {
    const startTime = Date.now();
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const stream = await client.chat.completions.create({
        model,
        messages: mapMessages(req),
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
      });

      yield { type: 'meta', data: { provider: 'openai', model } };

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          tokensOut += 1;
          yield { type: 'chunk', data: { textDelta: delta } };
        }
      }

      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCostUsd({ model, tokensIn, tokensOut });

      yield {
        type: 'done',
        data: {
          provider: 'openai',
          model,
          tokensIn,
          tokensOut,
          latencyMs,
          costUsd,
          cacheHit: false,
        },
      };
    } catch (err: any) {
      yield {
        type: 'error',
        data: {
          message: err?.message ?? 'Unknown OpenAI stream error',
          retryable: true,
        },
      };
    }
  }

  return { complete, stream };
}
