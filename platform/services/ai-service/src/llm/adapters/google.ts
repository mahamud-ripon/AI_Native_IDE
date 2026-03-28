/**
 * Google AI Studio (Gemini) Adapter
 *
 * Uses the official @google/genai SDK.
 * API: https://generativelanguage.googleapis.com/v1beta
 * Auth: x-goog-api-key header
 */

import { GoogleGenAI } from '@google/genai';
import type { LLMCompletionRequest, AdapterResponse, LLMStreamChunkEvent, LLMToolCall } from '../types.js';
import { estimateCostUsd } from '../pricing.js';

export type GoogleAdapterConfig = {
  apiKey: string;
  defaultModel?: string;
};

export type GoogleCompleteResult =
  | { ok: true; response: AdapterResponse }
  | { ok: false; error: string; retryable: boolean };

function mapMessagesToGeminiFormat(req: LLMCompletionRequest): { role: string; parts: Array<{ text: string }> }[] {
  const messages: { role: string; parts: Array<{ text: string }> }[] = [];

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      // Gemini doesn't have system role — prepend as user message
      messages.push({ role: 'user', parts: [{ text: `[System Instruction]: ${msg.content}` }] });
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'model', parts: [{ text: msg.content }] });
    } else if (msg.role === 'tool') {
      // Tool results as user messages
      messages.push({ role: 'user', parts: [{ text: `[Tool Result]: ${msg.content}` }] });
    } else {
      messages.push({ role: 'user', parts: [{ text: msg.content }] });
    }
  }

  return messages;
}

function mapToolsToGeminiFormat(req: LLMCompletionRequest): Array<{ name: string; description: string; parameters: Record<string, unknown> }> | undefined {
  if (!req.tools || req.tools.length === 0) return undefined;
  return req.tools.map((t: any) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export function createGoogleAdapter(config: GoogleAdapterConfig) {
  const genAI = new GoogleGenAI({ apiKey: config.apiKey });

  async function complete(
    req: LLMCompletionRequest,
    model?: string
  ): Promise<GoogleCompleteResult> {
    const startTime = Date.now();
    const usedModel = model ?? config.defaultModel ?? 'gemini-2.0-flash';

    try {
      const contents = mapMessagesToGeminiFormat(req);
      const tools = mapToolsToGeminiFormat(req);

      const response = await genAI.models.generateContent({
        model: usedModel,
        contents,
        config: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxTokens ?? 4096,
          ...(tools ? {
            tools: [{ functionDeclarations: tools }],
          } : {}),
        },
      });

      const outputText = response.text ?? '';

      // Extract function calls if present
      let toolCalls: LLMToolCall[] | undefined;
      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        toolCalls = functionCalls.map((fc, i) => ({
          id: `google-fc-${Date.now()}-${i}`,
          name: fc.name ?? '',
          arguments: (fc.args ?? {}) as Record<string, unknown>,
        }));
      }

      // Token counts from usage metadata
      const tokensIn = response.usageMetadata?.promptTokenCount ?? 0;
      const tokensOut = response.usageMetadata?.candidatesTokenCount ?? 0;
      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCostUsd({ model: usedModel, tokensIn, tokensOut });

      return {
        ok: true,
        response: {
          provider: 'google',
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
      const message = error?.message || 'Unknown error';
      const retryable = error?.status === 429 || (error?.status >= 500);

      return {
        ok: false,
        error: `Google AI error: ${message}`,
        retryable,
      };
    }
  }

  async function* stream(
    req: LLMCompletionRequest,
    model?: string
  ): AsyncGenerator<LLMStreamChunkEvent, void, unknown> {
    const startTime = Date.now();
    const usedModel = model ?? config.defaultModel ?? 'gemini-2.0-flash';
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const contents = mapMessagesToGeminiFormat(req);

      const responseStream = await genAI.models.generateContentStream({
        model: usedModel,
        contents,
        config: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxTokens ?? 4096,
        },
      });

      for await (const chunk of responseStream) {
        const text = chunk.text;
        if (text) {
          yield {
            type: 'chunk',
            data: {
              textDelta: text,
            },
          };
        }

        if (chunk.usageMetadata) {
          tokensIn = chunk.usageMetadata.promptTokenCount ?? 0;
          tokensOut = chunk.usageMetadata.candidatesTokenCount ?? 0;
        }
      }

      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCostUsd({ model: usedModel, tokensIn, tokensOut });

      yield {
        type: 'done',
        data: {
          tokensIn,
          tokensOut,
          latencyMs,
          costUsd,
          provider: 'google' as const,
          model: usedModel,
          cacheHit: false,
        },
      };
    } catch (error: any) {
      const message = error?.message || 'Unknown error';
      yield {
        type: 'error',
        data: {
          message: `Google AI stream error: ${message}`,
          retryable: error?.status === 429 || (error?.status >= 500),
        },
      };
    }
  }

  return { complete, stream };
}
