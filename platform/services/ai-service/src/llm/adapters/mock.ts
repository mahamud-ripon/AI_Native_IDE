/**
 * Mock LLM Provider Adapter
 * 
 * Used for integration testing without real API keys.
 * Simulates provider behavior with deterministic responses.
 * 
 * Features:
 * - Deterministic responses based on input
 * - Simulated latency (configurable)
 * - Token calculation from input length
 * - Streaming support with chunks
 * - Configurable failure rate for retry testing
 */

import type { LLMCompletionRequest, AdapterResponse, LLMStreamChunkEvent, LLMProvider } from '../types.js';

export type MockAdapterConfig = {
  /** Simulated latency in milliseconds (default: 200ms) */
  latencyMs?: number;
  /** Failure rate 0.0-1.0 for retry testing (default: 0.0) */
  failureRate?: number;
  /** Fixed response text (optional, overrides deterministic generation) */
  fixedResponse?: string;
  /** Simulated tokens per chunk for streaming (default: 5) */
  tokensPerChunk?: number;
};

export type MockCompleteResult =
  | { ok: true; response: AdapterResponse }
  | { ok: false; error: string; retryable: boolean };

export type MockStreamResult = AsyncGenerator<LLMStreamChunkEvent, void, unknown>;

// Model capabilities for mock provider
const MOCK_CAPABILITIES = {
  supportsTools: true,
  supportsVision: false,
  supportsStreaming: true,
  maxContextTokens: 128000,
};

/**
 * Create a mock LLM adapter for testing.
 */
export function createMockAdapter(config: MockAdapterConfig = {}) {
  const latencyMs = config.latencyMs ?? 200;
  const failureRate = config.failureRate ?? 0.0;
  const fixedResponse = config.fixedResponse;
  const tokensPerChunk = config.tokensPerChunk ?? 5;

  /**
   * Simulate network latency
   */
  async function simulateLatency(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, latencyMs));
  }

  /**
   * Calculate tokens from text (rough approximation: ~4 chars per token)
   */
  function calculateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate a deterministic mock response based on input
   */
  function generateMockResponse(request: LLMCompletionRequest): string {
    if (fixedResponse) {
      return fixedResponse;
    }

    // Get the last user message
    const userMessages = request.messages.filter(m => m.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1];
    const inputText = lastUserMessage?.content ?? '';

    // Generate deterministic response based on task type
    const taskType = request.taskType;
    
    switch (taskType) {
      case 'plan':
        return `[MOCK PLAN]\n1. Analyze requirements\n2. Design architecture\n3. Implement solution\n4. Test and validate\n5. Deploy\n\nInput received: "${inputText.slice(0, 50)}..."`;
      
      case 'codegen':
        return `[MOCK CODE]\n// Generated code for: ${inputText.slice(0, 30)}\nfunction hello() {\n  console.log("Hello, World!");\n}\n\nexport { hello };`;
      
      case 'qa':
        return `[MOCK QA]\n✓ Test case 1: Passed\n✓ Test case 2: Passed\n✓ Test case 3: Passed\n\nAll tests passed for: "${inputText.slice(0, 30)}"`;
      
      case 'security':
        return `[MOCK SECURITY]\nSecurity analysis for: "${inputText.slice(0, 30)}"\n- No critical vulnerabilities found\n- 2 medium severity issues\n- 5 low severity issues\n\nRecommendation: Review medium severity issues.`;
      
      case 'chat':
      default:
        return `[MOCK RESPONSE]\nHello! I received your message: "${inputText.slice(0, 50)}"\n\nThis is a mock response for testing purposes.`;
    }
  }

  /**
   * Check if we should simulate a failure
   */
  function shouldFail(): boolean {
    return Math.random() < failureRate;
  }

  /**
   * Complete a non-streaming request
   */
  async function complete(
    request: LLMCompletionRequest,
    model: string = 'mock-llm-v1'
  ): Promise<MockCompleteResult> {
    // Simulate latency
    await simulateLatency();

    // Simulate random failure for retry testing
    if (shouldFail()) {
      return {
        ok: false,
        error: 'Mock provider simulated failure (for retry testing)',
        retryable: true,
      };
    }

    // Calculate input tokens
    const inputText = request.messages.map(m => m.content).join(' ');
    const tokensIn = calculateTokens(inputText);

    // Generate response
    const outputText = generateMockResponse(request);
    const tokensOut = calculateTokens(outputText);

    // Mock cost (free)
    const costUsd = 0;

    return {
      ok: true,
      response: {
        provider: 'mock' as LLMProvider,
        model,
        outputText,
        tokensIn,
        tokensOut,
        latencyMs,
        costUsd,
        cacheHit: false,
      },
    };
  }

  /**
   * Stream a response with SSE-like chunks
   */
  async function* stream(
    request: LLMCompletionRequest,
    model: string = 'mock-llm-v1'
  ): MockStreamResult {
    // Simulate initial latency
    await simulateLatency();

    // Yield meta event
    yield {
      type: 'meta',
      data: {
        provider: 'mock' as LLMProvider,
        model,
      },
    };

    // Simulate random failure at start
    if (shouldFail()) {
      yield {
        type: 'error',
        data: {
          message: 'Mock provider simulated failure (for retry testing)',
          retryable: true,
        },
      };
      return;
    }

    // Generate full response
    const outputText = generateMockResponse(request);
    
    // Calculate tokens
    const inputText = request.messages.map(m => m.content).join(' ');
    const tokensIn = calculateTokens(inputText);
    const tokensOut = calculateTokens(outputText);

    // Split into chunks
    const words = outputText.split(' ');
    const chunks: string[] = [];
    let currentChunk = '';

    for (const word of words) {
      currentChunk += (currentChunk ? ' ' : '') + word;
      if (currentChunk.split(' ').length >= tokensPerChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    // Yield chunks with simulated delay
    for (const chunk of chunks) {
      // Small delay between chunks
      await new Promise(resolve => setTimeout(resolve, 50));
      
      yield {
        type: 'chunk',
        data: {
          textDelta: chunk + ' ',
        },
      };
    }

    // Yield done event
    yield {
      type: 'done',
      data: {
        provider: 'mock' as LLMProvider,
        model,
        tokensIn,
        tokensOut,
        latencyMs: latencyMs + chunks.length * 50,
        costUsd: 0,
        cacheHit: false,
      },
    };
  }

  return {
    complete,
    stream,
    capabilities: MOCK_CAPABILITIES,
  };
}

export type MockAdapter = ReturnType<typeof createMockAdapter>;
