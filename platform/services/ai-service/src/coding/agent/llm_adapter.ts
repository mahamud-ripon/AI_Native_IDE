import {
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  LLMStreamChunk,
  LLMToolCall
} from './agent_types.js';
import { getLLMGateway } from '../../llm/gateway.js';
import type { LLMCompletionRequest, LLMToolDefinition } from '../../llm/types.js';

export class GatewayLLMProvider implements LLMProvider {
  private defaultModel?: string;

  constructor(model?: string) {
    this.defaultModel = model;
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const gateway = await getLLMGateway();

    const selectedModel = options?.model || this.defaultModel || 'claude-3-7-sonnet-20250219';

    // Convert Agent LLMMessage to Gateway format (preserve tool role + toolCallId)
    const gatewayMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      ...(msg.role === 'tool' ? { toolCallId: msg.toolCallId ?? msg.name } : {}),
    }));

    // Convert tools to gateway format
    const gatewayTools = options?.tools?.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const req: LLMCompletionRequest = {
      workflowId: 'code-agent-run',
      projectId: 'code-agent-project',
      agentName: 'CodeAgent',
      stepName: 'Execution',
      taskType: 'codegen',
      modelHint: selectedModel,
      messages: gatewayMessages as LLMCompletionRequest['messages'],
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      tools: gatewayTools as any,
    };

    const res = await gateway.complete(req);

    return {
      content: res.outputText,
      toolCalls: res.toolCalls as LLMToolCall[] | undefined,
      usage: {
        promptTokens: res.tokensIn,
        completionTokens: res.tokensOut,
        totalTokens: res.tokensIn + res.tokensOut,
      },
      finishReason: res.toolCalls && res.toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk> {
    const gateway = await getLLMGateway();

    // Convert Agent LLMMessage to Gateway format
    const gatewayMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      ...(msg.role === 'tool' ? { toolCallId: msg.toolCallId ?? msg.name } : {}),
    }));

    const selectedModel = options?.model || this.defaultModel || 'claude-3-7-sonnet-20250219';

    const req: LLMCompletionRequest = {
      workflowId: 'code-agent-run',
      projectId: 'code-agent-project',
      agentName: 'CodeAgent',
      stepName: 'Execution',
      taskType: 'codegen',
      modelHint: selectedModel,
      messages: gatewayMessages as LLMCompletionRequest['messages'],
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    };

    const stream = gateway.stream(req);

    for await (const chunk of stream) {
      if (chunk.type === 'chunk') {
        yield {
          content: chunk.data.textDelta,
          done: false
        };
      } else if (chunk.type === 'done') {
        yield {
          done: true
        };
      } else if (chunk.type === 'error') {
        throw new Error(chunk.data.message);
      }
    }
  }
}

let defaultGatewayProvider: GatewayLLMProvider | null = null;

export function getGatewayLLMProvider(): GatewayLLMProvider {
  if (!defaultGatewayProvider) {
    defaultGatewayProvider = new GatewayLLMProvider();
  }
  return defaultGatewayProvider;
}
