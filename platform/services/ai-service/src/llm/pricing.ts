export type ModelPricing = {
  inputPer1kUsd: number;
  outputPer1kUsd: number;
};

const PRICING_TABLE: Record<string, ModelPricing> = {
  'claude-3-5-sonnet-latest': { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },
  'gpt-4.1': { inputPer1kUsd: 0.01, outputPer1kUsd: 0.03 },
  'gpt-4.1-mini': { inputPer1kUsd: 0.00015, outputPer1kUsd: 0.0006 },
  'llama-3.3-70b-versatile': { inputPer1kUsd: 0.00059, outputPer1kUsd: 0.00079 },
  'llama-3.3-8b-instant': { inputPer1kUsd: 0.00005, outputPer1kUsd: 0.00008 },
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
