import Anthropic from '@anthropic-ai/sdk';
import type { LLMCompletionRequest, AdapterResponse, LLMStreamChunkEvent } from '../types.js';
import { estimateCostUsd } from '../pricing.js';

export type AnthropicAdapterConfig = {
  apiKey: string;
  defaultModel?: string;
};

export type AnthropicCompleteResult =
  | { ok: true; response: AdapterResponse }
  | { ok: false; error: string; retryable: boolean };

export type AnthropicStreamResult = AsyncGenerator<LLMStreamChunkEvent, void, unknown>;

export function createAnthropicAdapter(config: AnthropicAdapterConfig) {
  const client = new Anthropic({ apiKey: config.apiKey });

  async function complete(
    req: LLMCompletionRequest,
    model: string
  ): Promise<AnthropicCompleteResult> {
    const startTime = Date.now();

    try {
      const systemMessage = req.messages.find(m => m.role === 'system');
      const nonSystemMessages = req.messages.filter(m => m.role !== 'system');

      // Map tools for Anthropic format
      const anthropicTools = req.tools?.map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));

      const response = await client.messages.create({
        model,
        max_tokens: req.maxTokens ?? 4096,
        system: systemMessage?.content,
        messages: nonSystemMessages.map(m => {
          if (m.role === 'assistant') return { role: 'assistant' as const, content: m.content };
          if (m.role === 'tool') {
            return {
              role: 'user' as const,
              content: [{
                type: 'tool_result' as const,
                tool_use_id: m.toolCallId ?? m.name ?? '',
                content: m.content,
              }],
            };
          }
          return { role: 'user' as const, content: m.content };
        }),
        tools: anthropicTools,
      });

      const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
      const outputText = textBlock ? (textBlock as any).text : '';

      // Extract tool_use blocks
      const toolCalls = response.content
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({
          id: b.id,
          name: b.name,
          arguments: b.input as Record<string, unknown>,
        }));

      const tokensIn = response.usage.input_tokens;
      const tokensOut = response.usage.output_tokens;
      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCostUsd({ model, tokensIn, tokensOut });

      return {
        ok: true,
        response: {
          provider: 'anthropic',
          model,
          outputText,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
        error: err?.message ?? 'Unknown Anthropic error',
        retryable,
      };
    }
  }

  async function* stream(
    req: LLMCompletionRequest,
    model: string
  ): AnthropicStreamResult {
    const startTime = Date.now();
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const systemMessage = req.messages.find(m => m.role === 'system');
      const nonSystemMessages = req.messages.filter(m => m.role !== 'system');

      const stream = client.messages.stream({
        model,
        max_tokens: req.maxTokens ?? 4096,
        system: systemMessage?.content,
        messages: nonSystemMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      yield { type: 'meta', data: { provider: 'anthropic', model } };

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta'
        ) {
          const delta = (event.delta as any).text ?? '';
          tokensOut += 1;
          yield { type: 'chunk', data: { textDelta: delta } };
        }
      }

      const finalMessage = await stream.finalMessage();
      tokensIn = finalMessage.usage.input_tokens;
      tokensOut = finalMessage.usage.output_tokens;

      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCostUsd({ model, tokensIn, tokensOut });

      yield {
        type: 'done',
        data: {
          provider: 'anthropic',
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
          message: err?.message ?? 'Unknown Anthropic stream error',
          retryable: true,
        },
      };
    }
  }

  return { complete, stream };
}
