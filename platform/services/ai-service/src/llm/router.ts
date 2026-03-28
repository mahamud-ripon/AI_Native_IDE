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

// Default capabilities when model is not found in DB
const DEFAULT_CAPABILITIES: ModelCapabilities = {
  supportsTools: true,
  supportsVision: false,
  supportsStreaming: true,
  maxContextTokens: 4096,
};

/**
 * Set model capabilities from DB-stored model config.
 * Called when models are loaded from the admin panel.
 */
const capabilitiesCache: Record<string, ModelCapabilities> = {};

export function setModelCapabilities(model: string, caps: ModelCapabilities): void {
  capabilitiesCache[model] = caps;
}

export function setAllModelCapabilities(models: Array<{
  model: string;
  supportsTools?: boolean;
  supportsVision?: boolean;
  maxContextTokens?: number;
}>): void {
  for (const m of models) {
    capabilitiesCache[m.model] = {
      supportsTools: m.supportsTools ?? true,
      supportsVision: m.supportsVision ?? false,
      supportsStreaming: true,
      maxContextTokens: m.maxContextTokens ?? 4096,
    };
  }
}

function getCapabilities(model: string): ModelCapabilities {
  return capabilitiesCache[model] ?? DEFAULT_CAPABILITIES;
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

    // Parse provider/model format (e.g., "groq/llama-3.3-70b-versatile" or "deepseek-chat")
    let provider: LLMProvider;
    let model: string;

    if (req.modelHint.includes('/')) {
      const parts = req.modelHint.split('/');
      const providerHint = parts[0];
      model = parts.slice(1).join('/');

      // Map provider string to LLMProvider type
      const providerMap: Record<string, LLMProvider> = {
        groq: 'groq',
        openai: 'openai',
        anthropic: 'anthropic',
        deepseek: 'deepseek',
        siliconflow: 'siliconflow',
        nvidia: 'nvidia',
        xiaomi: 'xiaomi',
        openrouter: 'openrouter',
        huggingface: 'huggingface',
        google: 'google',
        stepfun: 'openai', // stepfun uses OpenAI-compatible API
        stepfunai: 'openai',
        'stepfun-ai': 'openai',
        cohere: 'openai',
        zhipu: 'openai',
        minimax: 'openai',
        moonshot: 'openai',
        bytedance: 'openai',
        baichuan: 'openai',
        '01-ai': 'openai',
        together: 'openai',
        fireworks: 'openai',
        replicate: 'openai',
      };
      provider = providerMap[providerHint] ?? 'groq';
    } else {
      // No provider prefix — try to find it in cached capabilities
      provider = 'groq' as LLMProvider;
      model = req.modelHint;
    }

    return {
      provider,
      model,
      capabilities,
      fallbackChain: [],
    };
  }

  // No modelHint — use the first available model from capabilities cache
  const availableModels = Object.keys(capabilitiesCache);
  if (availableModels.length > 0) {
    const firstModel = availableModels[0];
    // Find provider from model name pattern
    let fallbackProvider: LLMProvider = 'groq';
    if (firstModel.includes('/')) {
      const p = firstModel.split('/')[0];
      fallbackProvider = p as LLMProvider;
    }

    const fallbackChain = availableModels.slice(1, 5).map(m => ({
      provider: (m.includes('/') ? m.split('/')[0] : 'groq') as LLMProvider,
      model: m.includes('/') ? m.split('/').slice(1).join('/') : m,
      capabilities: getCapabilities(m),
    }));

    return {
      provider: fallbackProvider,
      model: firstModel.includes('/') ? firstModel.split('/').slice(1).join('/') : firstModel,
      capabilities: getCapabilities(firstModel),
      fallbackChain,
    };
  }

  // Last resort fallback
  return {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    capabilities: DEFAULT_CAPABILITIES,
    fallbackChain: [],
  };
}
