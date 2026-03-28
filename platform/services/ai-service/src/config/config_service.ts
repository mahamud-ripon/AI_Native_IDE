/**
 * Platform Config Service
 *
 * Reads/writes runtime configuration from the platform_config DB table.
 * Caches values in-memory with a configurable TTL (default 60s).
 * Admin panel updates take effect within cache TTL.
 */

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { config as appConfig } from '../config.js';

const prisma = new PrismaClient();

// Default config values used when no DB row exists
const DEFAULT_CONFIG: Record<string, unknown> = {
  'ai.mode1.model': { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  'ai.mode2.model': { provider: 'openai', model: 'gpt-4.1' },
  'ai.mode3.fallback': 'mode2',
  'ai.mode3.enabled': true,
  'ai.max_turns.direct': 10,
  'ai.mode_selection.user_allowed': true,
  'ai.mode_selection.default': 'direct',
  'ai.fallback_chain': [
    { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
    { provider: 'openai', model: 'gpt-4.1' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'google', model: 'gemini-2.0-flash' },
  ],
  'ai.available_modes': ['direct', 'plan_execute', 'multi_agent'],
};

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export class ConfigService {
  private memoryCache: Map<string, CacheEntry> = new Map();
  private cacheTtlMs: number;
  private redis: Redis | null = null;
  private redisPrefix = 'platform_config:';

  constructor(options?: { cacheTtlMs?: number; redis?: Redis }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 60_000;
    this.redis = options?.redis ?? null;
  }

  /**
   * Get a config value by key.
   * Checks memory cache → Redis → DB → defaults.
   */
  async getConfig<T = unknown>(key: string, fallback?: T): Promise<T> {
    // 1. Memory cache
    const cached = this.memoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    // 2. Redis cache
    if (this.redis) {
      try {
        const redisVal = await this.redis.get(`${this.redisPrefix}${key}`);
        if (redisVal !== null) {
          const parsed = JSON.parse(redisVal) as T;
          this.setMemoryCache(key, parsed);
          return parsed;
        }
      } catch {
        // Redis unavailable, continue to DB
      }
    }

    // 3. Database
    try {
      const row = await prisma.platformConfig.findUnique({
        where: { configKey: key },
      });

      if (row) {
        const value = row.configValue as T;
        this.setMemoryCache(key, value);
        await this.setRedisCache(key, value);
        return value;
      }
    } catch {
      // DB unavailable, fall through to defaults
    }

    // 4. Defaults
    const defaultValue = (DEFAULT_CONFIG[key] ?? fallback) as T;
    return defaultValue;
  }

  /**
   * Get all config values for a category.
   */
  async getAllConfig(category: string = 'ai'): Promise<Record<string, unknown>> {
    try {
      const rows = await prisma.platformConfig.findMany({
        where: { category },
      });

      const result: Record<string, unknown> = {};
      for (const row of rows) {
        result[row.configKey] = row.configValue;
        this.setMemoryCache(row.configKey, row.configValue);
      }

      // Fill in defaults for missing keys
      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        if (key.startsWith(`${category}.`) && !(key in result)) {
          result[key] = value;
        }
      }

      return result;
    } catch {
      // Return defaults if DB is unavailable
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        if (key.startsWith(`${category}.`)) {
          result[key] = value;
        }
      }
      return result;
    }
  }

  /**
   * Set a config value (admin only).
   */
  async setConfig(key: string, value: unknown, updatedBy?: string): Promise<void> {
    await prisma.platformConfig.upsert({
      where: { configKey: key },
      update: {
        configValue: value as any,
        updatedBy: updatedBy ?? null,
        updatedAt: new Date(),
      },
      create: {
        configKey: key,
        configValue: value as any,
        category: key.split('.')[0] || 'general',
        updatedBy: updatedBy ?? null,
      },
    });

    // Invalidate caches
    this.memoryCache.delete(key);
    if (this.redis) {
      try {
        await this.redis.del(`${this.redisPrefix}${key}`);
      } catch {
        // Redis unavailable
      }
    }
  }

  /**
   * Refresh all cached values from DB.
   */
  async refreshCache(): Promise<void> {
    this.memoryCache.clear();
    try {
      const rows = await prisma.platformConfig.findMany();
      for (const row of rows) {
        this.setMemoryCache(row.configKey, row.configValue);
        await this.setRedisCache(row.configKey, row.configValue);
      }
    } catch {
      // DB unavailable
    }
  }

  /**
   * Get all available models from DB.
   * If no models exist in DB, seeds with defaults on first call.
   */
  async getAvailableModelsAsync(): Promise<Array<{
    provider: string; model: string; label: string;
    apiKey?: string; baseUrl?: string;
    supportsTools?: boolean; supportsVision?: boolean; maxContextTokens?: number;
  }>> {
    try {
      const dbModels = await this.getConfig<Array<any>>('ai.models', []);

      if (dbModels && Array.isArray(dbModels) && dbModels.length > 0) {
        return dbModels;
      }

      // First run or empty: seed with default models
      const defaults = this.getDefaultModels();
      await this.setConfig('ai.models', defaults, 'system');
      return defaults;
    } catch {
      // DB unavailable — return defaults without saving
      return this.getDefaultModels();
    }
  }

  /**
   * Synchronous fallback — returns empty array (use async version).
   */
  getAvailableModels(): Array<{ provider: string; model: string; label: string }> {
    return [];
  }

  /**
   * Default models seeded on first run.
   */
  private getDefaultModels(): Array<{
    provider: string; model: string; label: string;
    supportsTools: boolean; supportsVision: boolean; maxContextTokens: number;
  }> {
    return [
      { provider: 'groq', model: 'llama-3.3-70b-versatile', label: 'Groq Llama 3.3 70B (Fast)', supportsTools: true, supportsVision: false, maxContextTokens: 131072 },
      { provider: 'openai', model: 'gpt-4.1-mini', label: 'OpenAI GPT-4.1 Mini (Balanced)', supportsTools: true, supportsVision: false, maxContextTokens: 128000 },
      { provider: 'openai', model: 'gpt-4.1', label: 'OpenAI GPT-4.1 (Best Quality)', supportsTools: true, supportsVision: true, maxContextTokens: 128000 },
      { provider: 'anthropic', model: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet (Best Reasoning)', supportsTools: true, supportsVision: true, maxContextTokens: 200000 },
      { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek V3.2 (Budget)', supportsTools: true, supportsVision: false, maxContextTokens: 128000 },
      { provider: 'google', model: 'gemini-2.0-flash', label: 'Google Gemini 2.0 Flash (Fast)', supportsTools: true, supportsVision: true, maxContextTokens: 1000000 },
    ];
  }

  private setMemoryCache(key: string, value: unknown): void {
    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private async setRedisCache(key: string, value: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        `${this.redisPrefix}${key}`,
        JSON.stringify(value),
        'PX',
        this.cacheTtlMs
      );
    } catch {
      // Redis unavailable
    }
  }
}

// Singleton
let instance: ConfigService | null = null;

export function getConfigService(): ConfigService {
  if (!instance) {
    let redis: Redis | null = null;
    try {
      redis = new Redis(appConfig.redisUrl);
    } catch {
      // Redis not available
    }
    instance = new ConfigService({ redis: redis ?? undefined });
  }
  return instance;
}
