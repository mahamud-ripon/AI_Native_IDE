import type { LLMCompletionRequest, AdapterResponse, LLMStreamChunkEvent, LLMToolCall } from '../types.js';
import { estimateCostUsd } from '../pricing.js';

export type GroqAdapterConfig = {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
};

export type GroqCompleteResult =
  | { ok: true; response: AdapterResponse }
  | { ok: false; error: string; retryable: boolean };

export type GroqStreamResult = AsyncGenerator<LLMStreamChunkEvent, void, unknown>;

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export function createGroqAdapter(config: GroqAdapterConfig) {
  const baseUrl = config.baseUrl ?? GROQ_BASE_URL;

  async function complete(
    req: LLMCompletionRequest,
    model: string
  ): Promise<GroqCompleteResult> {
    const startTime = Date.now();

    try {
      // Map tools to Groq/OpenAI format
      const groqTools = req.tools?.map((t: any) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: req.messages.map(m => ({
            role: m.role,
            content: m.content,
            name: m.name,
            ...(m.role === 'tool' ? { tool_call_id: m.toolCallId ?? m.name } : {}),
          })),
          temperature: req.temperature ?? 0.7,
          max_tokens: req.maxTokens ?? 4096,
          ...(groqTools ? { tools: groqTools } : {}),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const retryable = response.status === 429 || response.status >= 500;
        return {
          ok: false,
          error: `Groq API error: ${response.status} - ${errorText}`,
          retryable,
        };
      }

      const data = await response.json() as {
        choices?: {
          message?: {
            content?: string;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      const outputText = choice?.message?.content ?? '';

      // Extract tool calls if present
      const toolCalls: LLMToolCall[] | undefined = choice?.message?.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));

      const tokensIn = data.usage?.prompt_tokens ?? 0;
      const tokensOut = data.usage?.completion_tokens ?? 0;
      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCostUsd({ model, tokensIn, tokensOut });

      return {
        ok: true,
        response: {
          provider: 'groq' as const,
          model,
          outputText,
          toolCalls,
          tokensIn,
          tokensOut,
          latencyMs,
          costUsd,
          cacheHit: false,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message ?? 'Unknown Groq error',
        retryable: true,
      };
    }
  }

  async function* stream(
    req: LLMCompletionRequest,
    model: string
  ): GroqStreamResult {
    const startTime = Date.now();
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: req.messages.map(m => ({
            role: m.role,
            content: m.content,
            name: m.name,
          })),
          temperature: req.temperature ?? 0.7,
          max_tokens: req.maxTokens ?? 4096,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: 'error',
          data: {
            message: `Groq API error: ${response.status} - ${errorText}`,
            retryable: response.status === 429 || response.status >= 500,
          },
        };
        return;
      }

      yield { type: 'meta', data: { provider: 'groq', model } };

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: 'error', data: { message: 'No response body', retryable: false } };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              tokensOut += 1;
              yield { type: 'chunk', data: { textDelta: delta } };
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }

      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCostUsd({ model, tokensIn, tokensOut });

      yield {
        type: 'done',
        data: {
          provider: 'groq',
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
          message: err?.message ?? 'Unknown Groq stream error',
          retryable: true,
        },
      };
    }
  }

  return { complete, stream };
}
