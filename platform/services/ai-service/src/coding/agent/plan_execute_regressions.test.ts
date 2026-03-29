import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LLMMessage, LLMOptions, LLMProvider, LLMResponse } from './agent_types.js';
import { createCodeAgent } from './code_agent.js';
import { createPlanGenerator } from './plan_generator.js';
import type { ProjectContext } from '../context/context_types.js';
import { createWorkspace } from '../workspace/workspace_fs.js';

class QueueLLMProvider implements LLMProvider {
  private readonly responses: LLMResponse[];
  readonly calls: string[] = [];

  constructor(
    private readonly name: string,
    responses: LLMResponse[],
  ) {
    this.responses = [...responses];
  }

  async complete(_messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    this.calls.push(options?.model ?? this.name);
    const response = this.responses.shift();

    if (!response) {
      throw new Error(`No stubbed LLM response left for ${this.name}`);
    }

    return response;
  }

  async *stream(): AsyncIterable<never> {
    throw new Error('Not implemented in tests');
  }
}

function makeResponse(content: string): LLMResponse {
  return {
    content,
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    },
    finishReason: 'stop',
  };
}

function makeCreateFilePlan(pathname: string): LLMResponse {
  return makeResponse(
    JSON.stringify({
      goal: `Create ${pathname}`,
      steps: [
        {
          step: 1,
          action: 'create_file',
          file: pathname,
          description: `Create ${pathname}`,
          dependencies: [],
          estimatedComplexity: 'low',
        },
      ],
      affectedFiles: [pathname],
      newFiles: [pathname],
      deletedFiles: [],
      confidence: 0.95,
      reasoning: 'A single file is needed.',
    }),
  );
}

function makeModifyFilePlan(pathname: string, description: string): LLMResponse {
  return makeResponse(
    JSON.stringify({
      goal: `Update ${pathname}`,
      steps: [
        {
          step: 1,
          action: 'modify_file',
          file: pathname,
          description,
          dependencies: [],
          estimatedComplexity: 'low',
        },
      ],
      affectedFiles: [pathname],
      newFiles: [],
      deletedFiles: [],
      confidence: 0.9,
      reasoning: 'A single low-complexity edit is needed.',
    }),
  );
}

const baseContext: ProjectContext = {
  projectType: 'unknown',
  language: 'typescript',
  dependencies: [],
  fileTree: [
    {
      name: 'src',
      path: 'src',
      type: 'directory',
      children: [
        {
          name: 'index.ts',
          path: 'src/index.ts',
          type: 'file',
        },
      ],
    },
  ],
  relevantFiles: [],
  summary: 'Test workspace',
  tokenCount: 0,
  buildTimeMs: 0,
};

const tempDirs: string[] = [];

async function createTempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-execute-'));
  tempDirs.push(root);

  const workspace = createWorkspace(root);
  await workspace.writeFile(
    'package.json',
    JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2),
  );
  await workspace.writeFile('src/index.ts', 'export const fixture = true;\n', {
    createDirectories: true,
  });

  return workspace;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('Plan & Execute regressions', () => {
  it('repairs truncated planner JSON responses', async () => {
    const provider = new QueueLLMProvider('planner', [
      makeResponse([
        'Here is the plan:',
        '```json',
        '{',
        '  "goal": "Create hello.txt",',
        '  "steps": [',
        '    {',
        '      "step": 1,',
        '      "action": "create_file",',
        '      "file": "hello.txt",',
        '      "description": "Create the file",',
        '      "dependencies": [],',
        '      "estimatedComplexity": "low"',
        '    }',
        '  ],',
        '  "affectedFiles": ["hello.txt"],',
        '  "newFiles": ["hello.txt"],',
        '  "deletedFiles": [],',
        '  "confidence": 0.92,',
        '  "reasoning": "This only needs one new file"',
      ].join('\n')),
    ]);

    const generator = createPlanGenerator({ provider });
    const plan = await generator.generate('create hello.txt', baseContext);

    expect(plan.goal).toBe('Create hello.txt');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.file).toBe('hello.txt');
    expect(plan.confidence).toBeCloseTo(0.92);
  });

  it('keeps each CodeAgent run pinned to its own provider', async () => {
    const workspaceA = await createTempWorkspace();
    const providerA = new QueueLLMProvider('provider-a', [
      makeCreateFilePlan('alpha.txt'),
      makeResponse('alpha'),
    ]);

    const agentA = createCodeAgent({
      workspace: workspaceA,
      provider: providerA,
      config: {
        enableVerification: false,
      },
    });

    const resultA = await agentA.run('create alpha.txt');

    expect(resultA.success).toBe(true);
    await expect(workspaceA.readFile('alpha.txt')).resolves.toBe('alpha');
    expect(providerA.calls).toHaveLength(2);

    const workspaceB = await createTempWorkspace();
    const providerB = new QueueLLMProvider('provider-b', [
      makeCreateFilePlan('beta.txt'),
      makeResponse('beta'),
    ]);

    const agentB = createCodeAgent({
      workspace: workspaceB,
      provider: providerB,
      config: {
        enableVerification: false,
      },
    });

    const resultB = await agentB.run('create beta.txt');

    expect(resultB.success).toBe(true);
    await expect(workspaceB.readFile('beta.txt')).resolves.toBe('beta');
    expect(providerA.calls).toHaveLength(2);
    expect(providerB.calls).toHaveLength(2);
  });

  it('skips the extra instruction-generation LLM turn for simple modify steps', async () => {
    const workspace = await createTempWorkspace();
    const provider = new QueueLLMProvider('provider-modify', [
      makeModifyFilePlan('src/index.ts', 'Change fixture to false.'),
      makeResponse('export const fixture = false;'),
    ]);

    const agent = createCodeAgent({
      workspace,
      provider,
      config: {
        enableVerification: false,
      },
    });

    const result = await agent.run('change fixture to false');

    expect(result.success).toBe(true);
    await expect(workspace.readFile('src/index.ts')).resolves.toContain('false');
    expect(provider.calls).toHaveLength(2);
  });
});
