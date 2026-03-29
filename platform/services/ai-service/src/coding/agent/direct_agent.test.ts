import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LLMMessage, LLMOptions, LLMProvider, LLMResponse } from './agent_types.js';
import { DirectAgent } from './direct_agent.js';
import { createToolRouter } from './tool_router.js';
import { createWorkspace } from '../workspace/workspace_fs.js';

class StubLLMProvider implements LLMProvider {
  private readonly responses: LLMResponse[];
  readonly modelsSeen: string[] = [];

  constructor(responses: LLMResponse[]) {
    this.responses = [...responses];
  }

  async complete(_messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    this.modelsSeen.push(options?.model ?? '');
    const response = this.responses.shift();

    if (!response) {
      throw new Error('No stubbed LLM response left');
    }

    return response;
  }

  async *stream(): AsyncIterable<never> {
    throw new Error('Not implemented in tests');
  }
}

function makeResponse(content: string, toolCalls?: LLMResponse['toolCalls']): LLMResponse {
  return {
    content,
    toolCalls,
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    },
    finishReason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop',
  };
}

const tempDirs: string[] = [];

async function createTempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-agent-'));
  tempDirs.push(root);
  return createWorkspace(root);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('DirectAgent', () => {
  it('retries a create request after a text-only clarification turn', async () => {
    const workspace = await createTempWorkspace();
    const provider = new StubLLMProvider([
      makeResponse('I need more details to create the config file.'),
      makeResponse('', [
        {
          id: 'tool-1',
          name: 'write_file',
          arguments: {
            path: 'config.json',
            content: '{\n  "name": "demo"\n}',
          },
        },
      ]),
      makeResponse('Created config.json.'),
    ]);

    const agent = new DirectAgent({
      workspace,
      llmProvider: provider,
      toolRouter: createToolRouter(workspace),
    });

    const result = await agent.run('create a config file', {
      provider: 'nvidia',
      model: 'stepfun-ai/step-3.5-flash',
    });

    expect(result.success).toBe(true);
    expect(result.filesChanged).toEqual(['config.json']);
    await expect(workspace.readFile('config.json')).resolves.toContain('"name": "demo"');
    expect(provider.modelsSeen).toEqual([
      'stepfun-ai/step-3.5-flash',
      'stepfun-ai/step-3.5-flash',
      'stepfun-ai/step-3.5-flash',
    ]);
  });

  it('parses XML-style tool calls from text-only model responses', async () => {
    const workspace = await createTempWorkspace();
    const provider = new StubLLMProvider([
      makeResponse([
        '<tool_call>',
        '<function=write_file>',
        '<parameter=path>README.md</parameter>',
        '<parameter=content># Hello</parameter>',
        '</tool_call>',
      ].join('')),
      makeResponse('Created README.md.'),
    ]);

    const agent = new DirectAgent({
      workspace,
      llmProvider: provider,
      toolRouter: createToolRouter(workspace),
    });

    const result = await agent.run('create a README file', {
      provider: 'nvidia',
      model: 'stepfun-ai/step-3.5-flash',
    });

    expect(result.success).toBe(true);
    expect(result.filesChanged).toContain('README.md');
    await expect(workspace.readFile('README.md')).resolves.toBe('# Hello');
  });

  it('falls back to the default direct model when the selected model refuses tools twice', async () => {
    const workspace = await createTempWorkspace();
    const provider = new StubLLMProvider([
      makeResponse('I need more details.'),
      makeResponse('Please clarify the file path.'),
      makeResponse('', [
        {
          id: 'tool-2',
          name: 'write_file',
          arguments: {
            path: 'settings.json',
            content: '{\n  "enabled": true\n}',
          },
        },
      ]),
      makeResponse('Created settings.json.'),
    ]);

    const agent = new DirectAgent({
      workspace,
      llmProvider: provider,
      toolRouter: createToolRouter(workspace),
    });

    const result = await agent.run(
      'create a settings config file',
      {
        provider: 'nvidia',
        model: 'stepfun-ai/step-3.5-flash',
      },
      {
        fallbackModelConfig: {
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.filesChanged).toEqual(['settings.json']);
    expect(provider.modelsSeen).toEqual([
      'stepfun-ai/step-3.5-flash',
      'stepfun-ai/step-3.5-flash',
      'llama-3.3-70b-versatile',
      'llama-3.3-70b-versatile',
    ]);
  });
});
