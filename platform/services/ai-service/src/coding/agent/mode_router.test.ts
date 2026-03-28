import { describe, expect, it, vi } from 'vitest';
import { ModeRouter } from './mode_router.js';

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    getConfig: vi.fn(async (key: string, fallback?: unknown) => {
      if (key in overrides) {
        return overrides[key];
      }
      return fallback;
    }),
  };
}

describe('ModeRouter', () => {
  it('honors an allowed user-selected mode', async () => {
    const router = new ModeRouter(createConfig() as any);

    const decision = await router.decide('delete src/foo.ts', 'direct');

    expect(decision.mode).toBe('direct');
    expect(decision.reason).toBe('user_selected');
  });

  it('uses a complexity hint and preserves tool intent', async () => {
    const router = new ModeRouter(createConfig() as any);

    const decision = await router.decide('analyze this service and improve the routing', {
      taskComplexity: 'medium',
      toolIntent: {
        preferredTools: ['read_file', 'search_code'],
        readOnly: true,
      },
      availableTools: ['read_file', 'search_code', 'write_file'],
    });

    expect(decision.mode).toBe('plan_execute');
    expect(decision.reason).toBe('hint_medium');
    expect(decision.selectedTools).toEqual(['read_file', 'search_code']);
    expect(decision.toolIntent?.readOnly).toBe(true);
  });

  it('keeps short read-only prompts in direct mode', async () => {
    const router = new ModeRouter(createConfig() as any);

    const decision = await router.decide('explain this auth middleware', {
      toolIntent: { readOnly: true },
      activeFile: 'src/middleware/auth.ts',
    });

    expect(decision.mode).toBe('direct');
    expect(decision.complexity).toBe('low');
    expect(decision.selectedTools).toEqual(
      expect.arrayContaining(['read_file', 'search_code', 'list_files', 'get_context']),
    );
  });

  it('falls back to structured mode when multi-agent is disabled', async () => {
    const router = new ModeRouter(createConfig({
      'ai.mode3.enabled': false,
    }) as any);

    const decision = await router.decide('build a full stack app with auth, billing, and CI/CD');

    expect(decision.mode).toBe('plan_execute');
    expect(decision.reason).toBe('auto_high_fallback');
    expect(decision.complexity).toBe('medium');
  });
});
