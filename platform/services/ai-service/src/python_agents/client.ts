/**
 * Python AI Agents Client
 * 
 * HTTP client for communicating with the Python AI Agents service.
 * Handles workflow execution via LangGraph agents.
 */

import dotenv from 'dotenv';
dotenv.config();

const PYTHON_AGENTS_URL = process.env.PYTHON_AGENTS_URL || 'http://ai-native-python-agents:9000';

export interface PythonAgentRequest {
  user_prompt: string;
  project_id?: string;
  stream?: boolean;
}

export interface PythonAgentResponse {
  workflow_id: string;
  status: 'completed' | 'failed' | 'pending';
  result?: Record<string, any>;
  errors?: string[];
  cost_summary?: Record<string, any>;
}

export interface StreamEvent {
  event_type: 'workflow_start' | 'agent_start' | 'agent_progress' | 'agent_complete' | 'agent_error' | 'workflow_complete' | 'workflow_error';
  agent_name?: string;
  message?: string;
  data?: any;
  timestamp: string;
}

/**
 * Call Python AI Agents service to execute a workflow
 */
export async function callPythonAgent(request: PythonAgentRequest): Promise<PythonAgentResponse> {
  try {
    const response = await fetch(`${PYTHON_AGENTS_URL}/api/v1/workflow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Python AI Agents error: ${response.status} - ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[PythonAgentClient] Error calling Python AI Agents:', error);
    throw error;
  }
}

/**
 * Call Python AI Agents service with SSE streaming
 */
export async function* callPythonAgentStream(request: PythonAgentRequest): AsyncGenerator<StreamEvent> {
  try {
    const response = await fetch(`${PYTHON_AGENTS_URL}/api/v1/workflow/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Python AI Agents error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const event: StreamEvent = JSON.parse(data);
            yield event;
          } catch (e) {
            console.warn('[PythonAgentClient] Failed to parse SSE event:', e);
          }
        }
      }
    }
  } catch (error) {
    console.error('[PythonAgentClient] Error streaming from Python AI Agents:', error);
    throw error;
  }
}

/**
 * Health check for Python AI Agents service
 */
export async function checkPythonAgentsHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${PYTHON_AGENTS_URL}/health`, {
      method: 'GET',
      timeout: 5000,
    });
    return response.ok;
  } catch {
    return false;
  }
}
