export type ModelPricing = {
  inputPer1kUsd: number;
  outputPer1kUsd: number;
};

const PRICING_TABLE: Record<string, ModelPricing> = {
  // OpenAI
  'claude-3-5-sonnet-latest': { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },
  'gpt-4.1': { inputPer1kUsd: 0.01, outputPer1kUsd: 0.03 },
  'gpt-4.1-mini': { inputPer1kUsd: 0.00015, outputPer1kUsd: 0.0006 },
  'llama-3.3-70b-versatile': { inputPer1kUsd: 0.00059, outputPer1kUsd: 0.00079 },
  'llama-3.3-8b-instant': { inputPer1kUsd: 0.00005, outputPer1kUsd: 0.00008 },

  // DeepSeek
  'deepseek-chat': { inputPer1kUsd: 0.00027, outputPer1kUsd: 0.0011 },
  'deepseek-reasoner': { inputPer1kUsd: 0.00055, outputPer1kUsd: 0.00219 },

  // SiliconFlow
  'deepseek-ai/DeepSeek-V3.2': { inputPer1kUsd: 0.00027, outputPer1kUsd: 0.0011 },
  'Qwen/Qwen3.5-397B-A17B': { inputPer1kUsd: 0.0005, outputPer1kUsd: 0.0005 },

  // NVIDIA NIM
  'meta/llama-3.1-8b-instruct': { inputPer1kUsd: 0.00003, outputPer1kUsd: 0.00006 },
  'nvidia/llama-3.1-nemotron-70b-instruct': { inputPer1kUsd: 0.00035, outputPer1kUsd: 0.0004 },

  // Xiaomi MiMo
  'MiMo-V2-Flash': { inputPer1kUsd: 0.00007, outputPer1kUsd: 0.00028 },
  'MiMo-V2-Pro': { inputPer1kUsd: 0.00039, outputPer1kUsd: 0.00156 },

  // OpenRouter (varies by provider)
  'openai/gpt-5.2': { inputPer1kUsd: 0.01, outputPer1kUsd: 0.03 },
  'anthropic/claude-sonnet-4.6': { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },

  // HuggingFace
  'meta-llama/Llama-3.1-8B-Instruct': { inputPer1kUsd: 0.00003, outputPer1kUsd: 0.00006 },

  // Google Gemini
  'gemini-2.0-flash': { inputPer1kUsd: 0.0001, outputPer1kUsd: 0.0004 },
  'gemini-2.5-pro': { inputPer1kUsd: 0.00125, outputPer1kUsd: 0.01 },
};

export function getModelPricing(model: string): ModelPricing | null {
  return PRICING_TABLE[model] ?? null;
}

export function estimateCostUsd(args: {
  model: string;
  tokensIn: number;
  tokensOut: number;
}): number {
  const pricing = getModelPricing(args.model);
  if (!pricing) return 0;

  const inputCost = (args.tokensIn / 1000) * pricing.inputPer1kUsd;
  const outputCost = (args.tokensOut / 1000) * pricing.outputPer1kUsd;
  const total = inputCost + outputCost;

  return Math.round(total * 1e6) / 1e6;
}
