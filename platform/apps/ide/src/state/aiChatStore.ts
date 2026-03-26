/**
 * AI Chat Store
 *
 * Zustand store for managing AI chat state.
 * Separates chat logic from UI component.
 *
 * Responsibilities:
 * - Chat message history
 * - Message sending and tracking
 * - Conversation management
 * - Task association
 *
 * Architecture:
 *   AIChatPanel
 *        │
 *   aiChatStore ← THIS MODULE
 *        │
 *   Execution API → executionStore
 */

import { create } from 'zustand';
import { groqClient, AI_ASSISTANT_SYSTEM_PROMPT } from '../services/groqClient';
import { localCodingService } from '../services/localCodingService';
import { ideEventBus, useIDEStore, FileNode } from '../stores/ideStore';
import { classifyIntent, getServiceForIntent, getIntentLabel, Intent, IntentResult } from '../services/intentClassifier';
import { logger } from '../lib/logger';
import { apiConfig } from '../lib/apiConfig';

// ========================================
// HELPERS
// ========================================

/** Flatten FileNode tree to list of file paths */
function flattenFileTree(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  const walk = (n: FileNode) => {
    if (n.type === 'file') paths.push(n.path);
    if (n.children) n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return paths;
}

// ========================================
// TYPES
// ========================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  taskId?: string;
  status?: 'pending' | 'streaming' | 'complete' | 'error';
  metadata?: {
    filesModified?: string[];
    patchesGenerated?: number;
    duration?: number;
    error?: string;
    tokens?: number;
    model?: string;
  };
}

export interface Conversation {
  id: string;
  projectId: string;
  workspaceId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  activeTaskId: string | null;
}

// ========================================
// STORE STATE
// ========================================

interface AIChatState {
  // Conversations
  conversations: Map<string, Conversation>;
  activeConversationId: string | null;

  // Current input
  input: string;
  isSending: boolean;

  // Current mode - distinguishes chat from build
  mode: 'idle' | 'chatting' | 'building';
  setMode: (mode: 'idle' | 'chatting' | 'building') => void;

  // Actions - Conversations
  createConversation: (projectId: string, workspaceId: string) => string;
  setActiveConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;

  // Actions - Messages
  addMessage: (conversationId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  clearMessages: (conversationId: string) => void;

  // Actions - Input
  setInput: (input: string) => void;
  setIsSending: (isSending: boolean) => void;

  // Actions - Task association
  associateTask: (conversationId: string, taskId: string) => void;

  // Actions - API
  sendMessage: (conversationId: string, projectId: string, workspaceId: string) => Promise<string | null>;
  loadHistory: (projectId: string) => Promise<void>;

  // Getters
  getConversation: (conversationId: string) => Conversation | undefined;
  getActiveConversation: () => Conversation | undefined;
  getMessages: (conversationId: string) => ChatMessage[];
  getLastMessage: (conversationId: string) => ChatMessage | undefined;
}

// ========================================
// STORE IMPLEMENTATION
// ========================================

export const useAIChatStore = create<AIChatState>((set, get) => ({
  // Initial state
  conversations: new Map(),
  activeConversationId: null,
  input: '',
  isSending: false,
  mode: 'idle',

  // Mode actions
  setMode: (mode) => set({ mode }),

  // Conversation actions
  createConversation: (projectId, workspaceId) => {
    // Check if a conversation for this project already exists — reuse it
    // to prevent duplicate conversations that orphan messages.
    const existing = get().conversations;
    for (const [existingId, conv] of existing) {
      if (conv.projectId === projectId) {
        // Reuse existing conversation, just ensure it's active
        if (get().activeConversationId !== existingId) {
          set({ activeConversationId: existingId });
        }
        return existingId;
      }
    }

    const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conversation: Conversation = {
      id,
      projectId,
      workspaceId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activeTaskId: null,
    };

    set((state) => {
      const newConversations = new Map(state.conversations);
      newConversations.set(id, conversation);
      return {
        conversations: newConversations,
        activeConversationId: id,
      };
    });

    return id;
  },

  setActiveConversation: (conversationId) => {
    set({ activeConversationId: conversationId });
  },

  deleteConversation: (conversationId) => {
    set((state) => {
      const newConversations = new Map(state.conversations);
      newConversations.delete(conversationId);
      return {
        conversations: newConversations,
        activeConversationId: state.activeConversationId === conversationId
          ? null
          : state.activeConversationId,
      };
    });
  },

  // Message actions
  addMessage: (conversationId, message) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const fullMessage: ChatMessage = {
      ...message,
      id,
      timestamp: Date.now(),
    };

    set((state) => {
      const conversation = state.conversations.get(conversationId);
      if (!conversation) return state;

      const newConversations = new Map(state.conversations);
      newConversations.set(conversationId, {
        ...conversation,
        messages: [...conversation.messages, fullMessage],
        updatedAt: Date.now(),
      });

      return { conversations: newConversations };
    });

    return id;
  },

  updateMessage: (conversationId, messageId, updates) => {
    set((state) => {
      const conversation = state.conversations.get(conversationId);
      if (!conversation) return state;

      const newMessages = conversation.messages.map((m) =>
        m.id === messageId ? { ...m, ...updates } : m
      );

      const newConversations = new Map(state.conversations);
      newConversations.set(conversationId, {
        ...conversation,
        messages: newMessages,
        updatedAt: Date.now(),
      });

      return { conversations: newConversations };
    });
  },

  deleteMessage: (conversationId, messageId) => {
    set((state) => {
      const conversation = state.conversations.get(conversationId);
      if (!conversation) return state;

      const newConversations = new Map(state.conversations);
      newConversations.set(conversationId, {
        ...conversation,
        messages: conversation.messages.filter((m) => m.id !== messageId),
        updatedAt: Date.now(),
      });

      return { conversations: newConversations };
    });
  },

  clearMessages: (conversationId) => {
    set((state) => {
      const conversation = state.conversations.get(conversationId);
      if (!conversation) return state;

      const newConversations = new Map(state.conversations);
      newConversations.set(conversationId, {
        ...conversation,
        messages: [],
        updatedAt: Date.now(),
      });

      return { conversations: newConversations };
    });
  },

  // Input actions
  setInput: (input) => {
    set({ input });
  },

  setIsSending: (isSending) => {
    set({ isSending });
  },

  // Task association
  associateTask: (conversationId, taskId) => {
    set((state) => {
      const conversation = state.conversations.get(conversationId);
      if (!conversation) return state;

      const newConversations = new Map(state.conversations);
      newConversations.set(conversationId, {
        ...conversation,
        activeTaskId: taskId,
        updatedAt: Date.now(),
      });

      return { conversations: newConversations };
    });
  },

  // API actions
  sendMessage: async (conversationId, projectId, workspaceId) => {
    const state = get();
    const input = state.input.trim();

    if (!input || state.isSending) return null;

    // === STEP 1: Classify Intent ===
    const intentResult = classifyIntent(input);
    const { intent, confidence } = intentResult;
    const service = getServiceForIntent(intent);
    
    logger.debug(`[IntentClassifier] "${input.slice(0, 50)}..." → ${intent} (${(confidence * 100).toFixed(0)}% confidence)`);

    // Add user message with intent metadata
    const userMessageId = state.addMessage(conversationId, {
      role: 'user',
      content: input,
      status: 'complete',
    });

    // Clear input and set sending
    set({ input: '', isSending: true });

    try {
      // === STEP 2: Route based on Intent ===
      // Always go through ai-service — the server-side LLM classifier
      // handles CHITCHAT vs WORKFLOW routing with higher accuracy.

      switch (intent) {
        case 'complex_build':
          // High-confidence build request → direct to ai-agents pipeline
          logger.debug('[Router] Using ai-agents for complex build');
          set({ mode: 'building' });
          const aiAgentsResult = await sendToAIAgents(
            conversationId,
            input,
            projectId,
            workspaceId,
            state,
            intent
          );
          set({ isSending: false, mode: 'idle' });
          return aiAgentsResult;

        default:
          // ALL other cases → go through ai-service (server-side LLM classifier decides)
          // The server will classify as CHITCHAT (chat response) or WORKFLOW (build response)
          logger.debug(`[Router] Routing via ai-service (frontend intent: ${intent})`);
          set({ mode: intent === 'conversation' ? 'chatting' : 'building' });
          const aiServiceResult = await sendToAIService(
            conversationId, 
            input, 
            projectId, 
            workspaceId, 
            state,
            intent
          );
          set({ isSending: false, mode: 'idle' });
          return aiServiceResult;
      }
    } catch (error) {
      // Add error message
      set({ mode: 'idle' });
      get().addMessage(conversationId, {
        role: 'system',
        content: `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        status: 'error',
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
      });

      set({ isSending: false });

      return null;
    }
  },

  // Getters
  getConversation: (conversationId) => {
    return get().conversations.get(conversationId);
  },

  getActiveConversation: () => {
    const state = get();
    if (!state.activeConversationId) return undefined;
    return state.conversations.get(state.activeConversationId);
  },

  getMessages: (conversationId) => {
    const conversation = get().conversations.get(conversationId);
    return conversation?.messages ?? [];
  },

  getLastMessage: (conversationId) => {
    const messages = get().getMessages(conversationId);
    return messages[messages.length - 1];
  },

  // Load chat history from backend database
  loadHistory: async (projectId: string) => {
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');
      const response = await fetch(`${apiConfig.baseUrl}/api/v1/ai/chat/history/${projectId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) return;

      const data = await response.json();
      if (!data.conversations?.length) return;

      // Pick the most recent conversation with messages
      const latest = data.conversations[0];
      if (!latest.messages?.length) return;

      const conversationId = latest.id;

      // Rebuild conversation in zustand store
      const convMessages: ChatMessage[] = latest.messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt).getTime(),
        status: 'complete' as const,
      }));

      set((state) => {
        const newConversations = new Map(state.conversations);
        newConversations.set(conversationId, {
          id: conversationId,
          projectId,
          workspaceId: latest.workspaceId || 'default',
          messages: convMessages,
          createdAt: new Date(latest.createdAt).getTime(),
          updatedAt: Date.now(),
          activeTaskId: null,
        });
        return {
          conversations: newConversations,
          activeConversationId: conversationId,
        };
      });

      logger.debug(`[AIChat] Loaded ${convMessages.length} messages from history`);
    } catch (err) {
      logger.debug('[AIChat] Failed to load history:', err);
    }
  },
}));

// ========================================
// GROQ HELPER
// ========================================

/**
 * Send message using Groq API directly (when backend is not available)
 */
async function sendWithGroq(
  conversationId: string,
  input: string,
  state: AIChatState
): Promise<string | null> {
  // Check if Groq is configured
  if (!groqClient.isConfigured()) {
    state.addMessage(conversationId, {
      role: 'system',
      content: 'Groq API key not configured. Click the settings icon to configure.',
      status: 'error',
    });
    return null;
  }

  // Add streaming assistant message
  const assistantMessageId = state.addMessage(conversationId, {
    role: 'assistant',
    content: '',
    status: 'streaming',
  });

  try {
    // Build messages from conversation history (exclude the placeholder assistant message)
    const conversation = state.conversations.get(conversationId);
    const historyMessages = conversation?.messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.id !== assistantMessageId)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })) ?? [];

    // Add system prompt at the beginning
    const messages = [
      { role: 'system' as const, content: AI_ASSISTANT_SYSTEM_PROMPT },
      ...historyMessages,
    ];

    // Stream response
    let fullContent = '';
    await groqClient.chatStream(
      messages,
      (chunk, done) => {
        fullContent += chunk;
        state.updateMessage(conversationId, assistantMessageId, {
          content: fullContent,
          status: done ? 'complete' : 'streaming',
        });
      },
      { model: 'llama-3.3-70b-versatile' }
    );

    return assistantMessageId;
  } catch (error) {
    state.updateMessage(conversationId, assistantMessageId, {
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      status: 'error',
    });
    return null;
  }
}

// ========================================
// SELECTORS
// ========================================

/**
 * Send a code generation request using localCodingService.
 * Generates code, creates/modifies files, and streams progress back to chat.
 */
async function sendWithCodeGeneration(
  conversationId: string,
  input: string,
  projectId: string,
  workspaceId: string,
  state: AIChatState
): Promise<string | null> {
  if (!groqClient.isConfigured()) {
    state.addMessage(conversationId, {
      role: 'system',
      content: 'Groq API key not configured. Click the settings icon to configure.',
      status: 'error',
    });
    return null;
  }

  // Add progress message that will be updated
  const progressMessageId = state.addMessage(conversationId, {
    role: 'assistant',
    content: 'Analyzing your request...',
    status: 'streaming',
  });

  try {
    const result = await localCodingService.generateAndApply({
      projectId,
      workspaceId,
      instruction: input,
      onProgress: (stage, message) => {
        state.updateMessage(conversationId, progressMessageId, {
          content: message,
          status: 'streaming',
        });
      },
    });

    if (result.success && result.applied.length > 0) {
      // Build a rich success response
      const fileList = result.applied.map(f => `- \`${f}\``).join('\n');
      const successContent = `I've generated and applied the following files:\n\n${fileList}\n\n${
        result.patches.length > 0
          ? `Here's a summary of what was created:\n\n${result.patches
              .slice(0, 3)
              .map(p => `\`\`\`${p.filePath.split('.').pop() || 'typescript'}\n// ${p.filePath}\n${p.content.slice(0, 200)}${p.content.length > 200 ? '\n// ...' : ''}\n\`\`\``)
              .join('\n\n')}`
          : ''
      }`;

      state.updateMessage(conversationId, progressMessageId, {
        content: successContent,
        status: 'complete',
        metadata: {
          filesModified: result.applied,
          patchesGenerated: result.patches.length,
        },
      });

      // Emit file:created events for each applied file so the file tree refreshes
      result.applied.forEach(filePath => {
        ideEventBus.emit('file:created', { path: filePath });
      });
    } else if (result.patches.length > 0 && result.failed.length > 0) {
      // Partial failure
      state.updateMessage(conversationId, progressMessageId, {
        content: `Code was generated but some files could not be applied:\n\nFailed: ${result.failed.join(', ')}\n\nError: ${result.error ?? 'Unknown error'}`,
        status: 'error',
        metadata: { error: result.error },
      });
    } else {
      // No patches generated — fall back to regular chat for explanation
      state.updateMessage(conversationId, progressMessageId, {
        content: 'Could not generate code files directly. Let me explain instead...',
        status: 'streaming',
      });

      // Fall back to Groq for a chat response
      let fullContent = 'Could not generate code files directly. Let me explain instead...\n\n';
      const conversation = state.conversations.get(conversationId);
      const historyMessages = conversation?.messages
        .filter(m => (m.role === 'user' || m.role === 'assistant') && m.id !== progressMessageId)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })) ?? [];

      const messages = [
        { role: 'system' as const, content: AI_ASSISTANT_SYSTEM_PROMPT },
        ...historyMessages,
      ];

      await groqClient.chatStream(
        messages,
        (chunk, done) => {
          fullContent += chunk;
          state.updateMessage(conversationId, progressMessageId, {
            content: fullContent,
            status: done ? 'complete' : 'streaming',
          });
        },
        { model: 'llama-3.3-70b-versatile' }
      );
    }

    return progressMessageId;
  } catch (error) {
    state.updateMessage(conversationId, progressMessageId, {
      content: `Error generating code: ${error instanceof Error ? error.message : 'Unknown error'}`,
      status: 'error',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return null;
  }
}

// ========================================
// ROUTING HELPERS - send to appropriate service
// ========================================

/**
 * Send to ai-service (CodeAgent) for simple edits
 */
async function sendToAIService(
  conversationId: string,
  input: string,
  projectId: string,
  workspaceId: string,
  state: AIChatState,
  intent: Intent
): Promise<string | null> {
  const intentLabel = getIntentLabel(intent);
  
  // Add pending assistant message
  const assistantMessageId = state.addMessage(conversationId, {
    role: 'assistant',
    content: `${intentLabel} - Processing...`,
    status: 'streaming',
  });

  try {
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');

    // Build chat history from conversation for context
    const conversation = state.conversations.get(conversationId);
    const chatHistory = conversation?.messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.id !== assistantMessageId)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })) ?? [];

    // Build workspace context from IDE state
    const ideState = useIDEStore.getState();
    const fileTree = flattenFileTree(ideState.fileTree);
    const activeFile = ideState.activeTabPath;
    const activeFileContent = activeFile ? ideState.fileContents.get(activeFile) ?? null : null;
    const openTabs = ideState.openTabs.map(t => t.path);

    const response = await fetch(`${apiConfig.baseUrl}/api/v1/ai/execution/tasks`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        projectId,
        workspaceId,
        instruction: input,
        chatHistory,
        workspaceContext: {
          fileTree,
          activeFile,
          activeFileContent: activeFileContent?.slice(0, 8000),
          openTabs,
        },
        metadata: {
          agent: 'ai-chat',
          clientInfo: { type: 'ide' },
          conversationId,
          intent: intent,
        },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      
      // Check if the server classified this as CHITCHAT (chat response, not a task)
      if (data.type === 'chat') {
        // Detect fallback or error responses from the backend
        const isFallback = data._meta?.wasFallback || data.status === 'error';
        const messageContent = data.message || '';
        
        if (isFallback || !messageContent) {
          console.warn(
            `[AIChat] Received ${data.status === 'error' ? 'error' : 'empty'} response from chat service`,
            { taskId: data.taskId, provider: data._meta?.provider, chunkCount: data._meta?.chunkCount }
          );
        }

        state.updateMessage(conversationId, assistantMessageId, {
          content: messageContent || 'No response received from the AI service.',
          status: data.status === 'error' ? 'error' : 'complete',
          metadata: isFallback ? { model: data._meta?.provider ?? 'unknown' } : undefined,
        });
        return assistantMessageId;
      }

      // WORKFLOW response — update message with task info
      state.updateMessage(conversationId, assistantMessageId, {
        content: `${intentLabel} - Task started`,
        taskId: data.taskId,
        status: 'pending',
      });

      // Associate task with conversation
      state.associateTask(conversationId, data.taskId);
      
      return data.taskId;
    } else {
      // If ai-service fails, fall back to Groq
      logger.warn('[Router] ai-service failed, falling back to Groq');
      state.updateMessage(conversationId, assistantMessageId, {
        content: 'Processing with local AI...',
        status: 'streaming',
      });
      
      return await sendWithGroq(conversationId, input, state);
    }
  } catch (error) {
    console.error('[Router] ai-service error:', error);
    // Fall back to Groq
    state.updateMessage(conversationId, assistantMessageId, {
      content: 'Processing with local AI...',
      status: 'streaming',
    });
    
    return await sendWithGroq(conversationId, input, state);
  }
}

/**
 * Send to ai-agents (multi-agent pipeline) for complex builds
 * Uses SSE streaming for real-time progress
 */
async function sendToAIAgents(
  conversationId: string,
  input: string,
  projectId: string,
  workspaceId: string,
  state: AIChatState,
  intent: Intent
): Promise<string | null> {
  // SSE parser - defined here for proper scoping
  const parseSSEvents = (chunk: string): Array<{event_type: string; agent_name?: string; message?: string; data?: Record<string, unknown>}> => {
    const events: Array<{event_type: string; agent_name?: string; message?: string; data?: Record<string, unknown>}> = [];
    const lines = chunk.split('\n');
    let currentEvent: Partial<{event_type: string; agent_name: string; message: string; data: Record<string, unknown>}> = {};
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent.event_type = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try { currentEvent.data = JSON.parse(line.slice(6)); } catch { currentEvent.data = { raw: line.slice(6) }; }
      } else if (line === '') {
        if (currentEvent.event_type) { events.push(currentEvent as any); currentEvent = {}; }
      }
    }
    return events;
  };

  const intentLabel = getIntentLabel(intent);
  
  // Add pending assistant message with streaming
  const assistantMessageId = state.addMessage(conversationId, {
    role: 'assistant',
    content: `${intentLabel} - Analyzing requirements...`,
    status: 'streaming',
  });

  try {
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');

    // Build chat history from conversation for context
    const conversation = state.conversations.get(conversationId);
    const chatHistory = conversation?.messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.id !== assistantMessageId)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })) ?? [];

    // Use the workflow stream endpoint for SSE
    const response = await fetch(`${apiConfig.baseUrl}/api/v1/workflow/stream`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        user_prompt: input,
        project_id: projectId,
        workspace_id: workspaceId,
        stream: true,
        intent: intent,
        chat_history: chatHistory,
      }),
    });

    if (response.ok) {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let currentAgent = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        
        // Parse SSE events
        const events = parseSSEvents(chunk);
        
        for (const event of events) {
          // Handle different event types
          switch (event.event_type) {
            case 'workflow_start':
              state.updateMessage(conversationId, assistantMessageId, {
                content: 'Starting development workflow...',
              });
              break;
              
            case 'agent_start':
              currentAgent = event.agent_name || '';
              state.updateMessage(conversationId, assistantMessageId, {
                content: `Running ${currentAgent}... ${event.message || ''}`,
              });
              break;
              
            case 'agent_progress':
              const progress = event.data?.progress || 0;
              state.updateMessage(conversationId, assistantMessageId, {
                content: `${currentAgent}: ${progress}% - ${event.message || ''}`,
              });
              break;
              
            case 'token':
              // Individual tokens - accumulate
              const token = event.data?.token || '';
              fullContent += token;
              state.updateMessage(conversationId, assistantMessageId, {
                content: fullContent + '▋',
                status: 'streaming',
              });
              break;
              
            case 'agent_complete':
              const output = event.data?.output;
              if (output) {
                const outputStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
                fullContent += '\n\n' + outputStr;
              }
              state.updateMessage(conversationId, assistantMessageId, {
                content: fullContent,
                status: 'streaming',
              });
              break;
              
            case 'workflow_complete':
              const result = event.data?.result;
              const finalContent = result 
                ? (typeof result === 'string' ? result : JSON.stringify(result, null, 2))
                : fullContent;
              
              state.updateMessage(conversationId, assistantMessageId, {
                content: finalContent,
                status: 'complete',
                metadata: {
                  model: String(event.data?.model || ''),
                  tokens: Number(event.data?.tokens_out) || undefined,
                },
              });
              break;
              
            case 'workflow_error':
            case 'error':
              const errorMsg = String(event.data?.error || event.message || 'Unknown error');
              state.updateMessage(conversationId, assistantMessageId, {
                content: `Error: ${errorMsg}`,
                status: 'error',
                metadata: { error: errorMsg },
              });
              break;
          }
        }
      }

      return assistantMessageId;
    } else {
      // If ai-agents fails, fall back to local coding service
      logger.warn('[Router] ai-agents failed, falling back to local coding service');
      state.updateMessage(conversationId, assistantMessageId, {
        content: 'Processing locally...',
        status: 'streaming',
      });
      
      return await sendWithCodeGeneration(conversationId, input, projectId, workspaceId, state);
    }
  } catch (error) {
    console.error('[Router] ai-agents error:', error);
    // Fall back to local coding service
    state.updateMessage(conversationId, assistantMessageId, {
      content: 'Processing locally...',
      status: 'streaming',
    });
    
    return await sendWithCodeGeneration(conversationId, input, projectId, workspaceId, state);
  }
}

// ========================================
// SELECTORS
// ========================================

/** Select messages for active conversation */
export const selectActiveMessages = (state: AIChatState): ChatMessage[] => {
  if (!state.activeConversationId) return [];
  const conversation = state.conversations.get(state.activeConversationId);
  return conversation?.messages ?? [];
};

/** Select conversation by project */
export const selectConversationByProject = (projectId: string) => (state: AIChatState): Conversation | undefined => {
  for (const conversation of state.conversations.values()) {
    if (conversation.projectId === projectId) {
      return conversation;
    }
  }
  return undefined;
};

/** Check if any message is streaming */
export const selectIsStreaming = (state: AIChatState): boolean => {
  const activeConv = state.getActiveConversation?.();
  if (!activeConv) return false;
  return activeConv.messages.some((m) => m.status === 'streaming' || m.status === 'pending');
};

export default useAIChatStore;
