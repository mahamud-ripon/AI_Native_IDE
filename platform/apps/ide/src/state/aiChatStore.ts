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

  // Conversation actions
  createConversation: (projectId, workspaceId) => {
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

    // Add user message
    const userMessageId = state.addMessage(conversationId, {
      role: 'user',
      content: input,
      status: 'complete',
    });

    // Clear input and set sending
    set({ input: '', isSending: true });

    try {
      // Try backend API first
      const response = await fetch('/api/ai/execution/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          workspaceId,
          instruction: input,
          metadata: {
            agent: 'ai-chat',
            clientInfo: { type: 'ide' },
            conversationId,
          },
        }),
      });

      if (!response.ok) {
        // Backend not available, use Groq directly
        return await sendWithGroq(conversationId, input, state);
      }

      const data = await response.json();

      // Add pending assistant message
      const assistantMessageId = state.addMessage(conversationId, {
        role: 'assistant',
        content: 'Starting execution...',
        taskId: data.taskId,
        status: 'pending',
      });

      // Associate task with conversation
      state.associateTask(conversationId, data.taskId);

      set({ isSending: false });

      return data.taskId;
    } catch (error) {
      // Add error message
      state.addMessage(conversationId, {
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
    // Build messages from conversation history
    const conversation = state.conversations.get(conversationId);
    const historyMessages = conversation?.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
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
