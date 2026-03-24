/**
 * useAIStream Hook
 *
 * Provides streaming AI responses with real-time token updates.
 * Connects to backend SSE endpoint for progressive response display.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:8000';

export interface StreamEvent {
  event_type: string;
  agent_name?: string;
  message?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
  event_id?: string;
}

export interface UseAIStreamOptions {
  onToken?: (token: string, agentName?: string) => void;
  onComplete?: (fullResponse: string) => void;
  onError?: (error: string) => void;
  onProgress?: (progress: number, message: string, agentName?: string) => void;
  onAgentStart?: (agentName: string, message: string) => void;
  onAgentComplete?: (agentName: string, output: unknown) => void;
}

export interface UseAIStreamReturn {
  isStreaming: boolean;
  response: string;
  error: string | null;
  startStream: (prompt: string, projectId?: string, workspaceId?: string) => Promise<void>;
  abortStream: () => void;
  progress: number;
  currentAgent: string | null;
}

/**
 * Hook for streaming AI responses
 * 
 * @example
 * const { isStreaming, response, error, startStream, abortStream } = useAIStream({
 *   onToken: (token) => setDisplayText(prev => prev + token),
 *   onComplete: (full) => setFinalText(full),
 *   onProgress: (pct, msg) => setStatus(`${pct}% - ${msg}`),
 * });
 */
export function useAIStream(options: UseAIStreamOptions = {}): UseAIStreamReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const responseRef = useRef('');
  
  const startStream = useCallback(async (
    prompt: string,
    projectId?: string,
    workspaceId?: string
  ) => {
    // Reset state
    setIsStreaming(true);
    setResponse('');
    setError(null);
    setProgress(0);
    setCurrentAgent(null);
    responseRef.current = '';
    
    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();
    
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');
      
      // Use the workflow stream endpoint for SSE
      const response = await fetch(`${API_BASE}/api/v1/workflow/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          user_prompt: prompt,
          project_id: projectId || 'default',
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }
      
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        
        // Parse SSE events
        const events = parseSSEEvents(chunk);
        
        for (const event of events) {
          handleEvent(event);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
        options.onError?.(err.message);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, []);
  
  const handleEvent = useCallback((event: StreamEvent) => {
    switch (event.event_type) {
      case 'workflow_start':
        setProgress(0);
        options.onProgress?.(0, 'Starting workflow...');
        break;
        
      case 'agent_start':
        setCurrentAgent(event.agent_name || 'unknown');
        options.onAgentStart?.(event.agent_name || 'unknown', event.message || '');
        options.onProgress?.(10, event.message || `Starting ${event.agent_name}...`, event.agent_name);
        break;
        
      case 'agent_progress':
        const prog = event.data?.progress as number || 0;
        setProgress(prog);
        options.onProgress?.(prog, event.message || '', event.agent_name);
        break;
        
      case 'agent_complete':
        setCurrentAgent(null);
        setProgress(100);
        options.onAgentComplete?.(event.agent_name || 'unknown', event.data?.output);
        
        // If there's output, add it to response
        if (event.data?.output) {
          const outputStr = typeof event.data.output === 'string' 
            ? event.data.output 
            : JSON.stringify(event.data.output, null, 2);
          responseRef.current += outputStr;
          setResponse(responseRef.current);
        }
        break;
        
      case 'token':
        // Individual token from streaming LLM
        const token = event.data?.token as string || '';
        responseRef.current += token;
        setResponse(responseRef.current);
        options.onToken?.(token, event.agent_name);
        break;
        
      case 'workflow_complete':
        setProgress(100);
        if (event.data?.result) {
          const resultStr = typeof event.data.result === 'string'
            ? event.data.result
            : JSON.stringify(event.data.result, null, 2);
          responseRef.current += '\n\n' + resultStr;
          setResponse(responseRef.current);
        }
        options.onComplete?.(responseRef.current);
        break;
        
      case 'workflow_error':
      case 'agent_error':
        const errorMsg = String(event.data?.error || event.message || 'Unknown error');
        setError(errorMsg);
        options.onError?.(errorMsg);
        break;
        
      case 'error':
        setError(String(event.data?.message || 'Stream error'));
        options.onError?.(String(event.data?.message || 'Stream error'));
        break;
    }
  }, []);
  
  const abortStream = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setCurrentAgent(null);
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);
  
  return {
    isStreaming,
    response,
    error,
    startStream,
    abortStream,
    progress,
    currentAgent,
  };
}

/**
 * Parse SSE events from chunk
 * SSE format:
 * event: <event_type>
 * id: <event_id>
 * data: <json_data>
 */
function parseSSEEvents(chunk: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  const lines = chunk.split('\n');
  
  let currentEvent: Partial<StreamEvent> = {};
  
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent.event_type = line.slice(7).trim();
    } else if (line.startsWith('id: ')) {
      currentEvent.event_id = line.slice(4).trim();
    } else if (line.startsWith('data: ')) {
      try {
        currentEvent.data = JSON.parse(line.slice(6));
      } catch {
        // Not JSON, treat as plain text
        currentEvent.data = { raw: line.slice(6) };
      }
    } else if (line === '') {
      // Empty line - event complete
      if (currentEvent.event_type) {
        events.push(currentEvent as StreamEvent);
        currentEvent = {};
      }
    }
  }
  
  return events;
}

export default useAIStream;