/**
 * Groq API Client
 *
 * Direct integration with Groq API for AI chat functionality.
 * Used when backend services are not available.
 *
 * Security Note: API key should be provided via environment variable
 * or runtime configuration, not hardcoded.
 *
 * Supported Models:
 * - llama-3.3-70b-versatile
 * - llama-3.1-8b-instant
 * - mixtral-8x7b-32768
 * - gemma2-9b-it
 */

// ========================================
// TYPES
// ========================================

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqChatRequest {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string[];
}

export interface GroqChatChoice {
  index: number;
  message: GroqMessage;
  finish_reason: string;
}

export interface GroqUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface GroqChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: GroqChatChoice[];
  usage: GroqUsage;
}

export interface GroqStreamDelta {
  role?: string;
  content?: string;
}

export interface GroqStreamChoice {
  index: number;
  delta: GroqStreamDelta;
  finish_reason: string | null;
}

export interface GroqStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: GroqStreamChoice[];
}

export type StreamCallback = (chunk: string, done: boolean) => void;

// ========================================
// GROQ CLIENT
// ========================================

class GroqClient {
  private apiKey: string | null = null;
  private baseUrl = 'https://api.groq.com/openai/v1';
  private defaultModel = 'llama-3.3-70b-versatile';

  /**
   * Set the API key
   */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Get the current API key (masked)
   */
  getApiKeyMasked(): string {
    if (!this.apiKey) return 'not set';
    return this.apiKey.slice(0, 8) + '...' + this.apiKey.slice(-4);
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  /**
   * Set the default model
   */
  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  /**
   * Send a chat completion request
   */
  async chat(
    messages: GroqMessage[],
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<GroqChatResponse> {
    if (!this.apiKey) {
      throw new Error('Groq API key not configured. Call setApiKey() first.');
    }

    const request: GroqChatRequest = {
      model: options?.model ?? this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      stream: false,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Send a streaming chat completion request
   */
  async chatStream(
    messages: GroqMessage[],
    onChunk: StreamCallback,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Groq API key not configured. Call setApiKey() first.');
    }

    const request: GroqChatRequest = {
      model: options?.model ?? this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response stream');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          onChunk('', true);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '' || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json: GroqStreamResponse = JSON.parse(trimmed.slice(6));
            const content = json.choices[0]?.delta?.content;
            if (content) {
              onChunk(content, false);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Generate a simple completion (convenience method)
   */
  async complete(
    prompt: string,
    systemPrompt?: string
  ): Promise<string> {
    const messages: GroqMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const response = await this.chat(messages);
    return response.choices[0]?.message.content ?? '';
  }

  /**
   * Generate a streaming completion (convenience method)
   */
  async completeStream(
    prompt: string,
    onChunk: StreamCallback,
    systemPrompt?: string
  ): Promise<void> {
    const messages: GroqMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    await this.chatStream(messages, onChunk);
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const groqClient = new GroqClient();

// Initialize with user-provided API key
groqClient.setApiKey('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');

// ========================================
// AI ASSISTANT SYSTEM PROMPT
// ========================================

export const AI_ASSISTANT_SYSTEM_PROMPT = `You are an AI coding assistant integrated into an IDE. Your role is to help developers write, modify, and debug code.

## Context Awareness

You will receive IDE context with every request:
- Current file path and language
- Cursor position
- Selected code (if any)
- Full file contents

## Important Rules

1. **Never ask users to paste code** - You already have access to the active file
2. **Use the provided context** - The code and file info are in your prompt
3. **Be specific** - Reference line numbers and file names when making changes
4. **Generate patches when appropriate** - For code modifications, provide clear, applicable changes

## When Generating Code Changes

- Preserve existing code style and formatting
- Include necessary imports
- Consider edge cases and error handling
- Explain your changes briefly

## Response Format

For code modifications, structure your response as:
1. Brief explanation of what you'll change
2. The modified code block with language tag
3. Any additional notes or warnings

Be helpful, concise, and accurate. You're working in an AI-Native IDE environment where users expect direct action, not requests for more information.`;

// ========================================
// EXPORTS
// ========================================

export default groqClient;
