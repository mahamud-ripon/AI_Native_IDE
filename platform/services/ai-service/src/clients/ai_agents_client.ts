import { config } from '../config.js';

export interface AIRequest {
  projectId: string;
  userId: string;
  prompt: string;
  context?: {
    files?: string[];
    schema?: Record<string, unknown>;
  };
}

export interface AIResponse {
  id: string;
  status: 'streaming' | 'completed' | 'failed';
  data?: unknown;
  error?: string;
}

export class AIAgentsClient {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    this.baseUrl = config.aiAgentsUrl;
    this.timeout = parseInt(process.env.AI_AGENTS_TIMEOUT || '300000');
  }

  async executeTask(request: AIRequest): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.aiAgentsApiKey}`,
        },
        body: JSON.stringify({
          project_id: request.projectId,
          user_id: request.userId,
          prompt: request.prompt,
          context: request.context,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async *streamTask(request: AIRequest): AsyncGenerator<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/execute/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.aiAgentsApiKey}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          project_id: request.projectId,
          user_id: request.userId,
          prompt: request.prompt,
          context: request.context,
        }),
        signal: controller.signal,
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            yield line.slice(6);
          }
        }
      }

      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.aiAgentsApiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const aiAgentsClient = new AIAgentsClient();
