export const APP_NAME = 'AI-Native IDE';

export const API_VERSIONS = {
  v1: '/api/v1',
} as const;

export const DEFAULT_LIMITS = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxProjectSize: 100 * 1024 * 1024, // 100MB
  maxConcurrentBuilds: 3,
  maxUploadSize: 50 * 1024 * 1024, // 50MB
} as const;

export const VM_SPECS = {
  small: { cpu: 1, memory: '2Gi', disk: '10Gi' },
  medium: { cpu: 2, memory: '4Gi', disk: '20Gi' },
  large: { cpu: 4, memory: '8Gi', disk: '40Gi' },
} as const;

export const DEPLOY_PROVIDERS = ['vercel', 'railway', 'aws', 'gcp', 'azure'] as const;

export const LLM_TIERS = {
  tier1: { name: 'Complex Reasoning', models: ['claude-3-5-sonnet', 'gpt-4o'] },
  tier2: { name: 'Fast/Cheap', models: ['claude-3-haiku', 'gemini-flash'] },
  tier3: { name: 'Local/OSS', models: ['llama-3-70b'] },
} as const;
