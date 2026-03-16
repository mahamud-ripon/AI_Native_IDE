import type { LLMCompletionRequest, LLMProvider, LLMTaskType } from './types.js';

export type ModelCapabilities = {
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
};

export type LLMRoute = {
  provider: LLMProvider;
  model: string;
  capabilities: ModelCapabilities;
  fallbackChain: Array<{ provider: LLMProvider; model: string; capabilities: ModelCapabilities }>;
};

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'claude-3-5-sonnet-latest': { supportsTools: true, supportsVision: true, supportsStreaming: true, maxContextTokens: 200000 },
  'gpt-4.1': { supportsTools: true, supportsVision: true, supportsStreaming: true, maxContextTokens: 128000 },
  'gpt-4.1-mini': { supportsTools: true, supportsVision: false, supportsStreaming: true, maxContextTokens: 128000 },
  'llama-3.3-70b-versatile': { supportsTools: true, supportsVision: false, supportsStreaming: true, maxContextTokens: 131072 },
  'mock-llm-v1': { supportsTools: true, supportsVision: false, supportsStreaming: true, maxContextTokens: 128000 },
};

const ROUTING_MATRIX: Record<LLMTaskType, { provider: LLMProvider; model: string }> = {
  plan: { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
  codegen: { provider: 'openai', model: 'gpt-4.1' },
  qa: { provider: 'openai', model: 'gpt-4.1-mini' },
  security: { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
  chat: { provider: 'openai', model: 'gpt-4.1-mini' },
};

const DEFAULT_FALLBACK_CHAIN: Array<{ provider: LLMProvider; model: string }> = [
  { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
  { provider: 'openai', model: 'gpt-4.1' },
  { provider: 'groq', model: 'llama-3.3-70b-versatile' },
];

function getCapabilities(model: string): ModelCapabilities {
  return MODEL_CAPABILITIES[model] ?? { supportsTools: false, supportsVision: false, supportsStreaming: true, maxContextTokens: 4096 };
}

export function resolveRoute(req: LLMCompletionRequest): LLMRoute {
  // Check if modelHint indicates mock provider
  if (req.modelHint && req.modelHint.toLowerCase().includes('mock')) {
    const capabilities = getCapabilities(req.modelHint);
    return {
      provider: 'mock',
      model: req.modelHint,
      capabilities,
      fallbackChain: [], // No fallback for mock
    };
  }

  if (req.modelHint) {
    const capabilities = getCapabilities(req.modelHint);
    return {
      provider: ROUTING_MATRIX[req.taskType].provider,
      model: req.modelHint,
      capabilities,
      fallbackChain: DEFAULT_FALLBACK_CHAIN.map(f => ({
        ...f,
        capabilities: getCapabilities(f.model),
      })),
    };
  }

  const primary = ROUTING_MATRIX[req.taskType];

  const fallbackChain = [
    primary,
    ...DEFAULT_FALLBACK_CHAIN.filter(
      f => !(f.provider === primary.provider && f.model === primary.model)
    ),
  ].map(f => ({
    ...f,
    capabilities: getCapabilities(f.model),
  }));

  return {
    provider: primary.provider,
    model: primary.model,
    capabilities: getCapabilities(primary.model),
    fallbackChain,
  };
}
