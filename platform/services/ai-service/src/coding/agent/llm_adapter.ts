import { 
  LLMProvider, 
  LLMMessage, 
  LLMOptions, 
  LLMResponse, 
  LLMStreamChunk 
} from './agent_types.js';
import { getLLMGateway } from '../../llm/gateway.js';
import type { LLMCompletionRequest } from '../../llm/types.js';

export class GatewayLLMProvider implements LLMProvider {
  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const gateway = await getLLMGateway();
    
    // Convert Agent LLMMessage to Gateway format
    const gatewayMessages = messages.map(msg => ({
      role: msg.role === 'tool' ? 'user' : msg.role,
      content: msg.content
    }));

    // Extract system prompt if present
    const systemMsg = messages.find(m => m.role === 'system');
    const systemPrompt = systemMsg?.content;

    // We need to provide dummy or contextual values for these required fields
    // since CodeAgent doesn't natively supply them.
    const req: LLMCompletionRequest = {
      workflowId: 'code-agent-run',
      projectId: 'code-agent-project',
      agentName: 'CodeAgent',
      stepName: 'Execution',
      taskType: 'codegen',
      modelHint: options?.model || 'claude-3-7-sonnet-20250219',
      messages: gatewayMessages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    };

    const res = await gateway.complete(req);

    return {
      content: res.outputText,
      usage: {
        promptTokens: res.tokensIn,
        completionTokens: res.tokensOut,
        totalTokens: res.tokensIn + res.tokensOut,
      },
      finishReason: 'stop'
    };
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk> {
    const gateway = await getLLMGateway();
    
    // Convert Agent LLMMessage to Gateway format
    const gatewayMessages = messages.map(msg => ({
      role: msg.role === 'tool' ? 'user' : msg.role,
      content: msg.content
    }));

    const systemMsg = messages.find(m => m.role === 'system');
    const systemPrompt = systemMsg?.content;

    const req: LLMCompletionRequest = {
      workflowId: 'code-agent-run',
      projectId: 'code-agent-project',
      agentName: 'CodeAgent',
      stepName: 'Execution',
      taskType: 'codegen',
      modelHint: options?.model || 'claude-3-7-sonnet-20250219',
      messages: gatewayMessages,
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
