/**
 * Chat Controller
 * 
 * HTTP/WebSocket controller for chat endpoints.
 * Handles API requests and real-time streaming.
 */

import {
  ChatRequest,
  ChatResponse,
  ChatConversation,
  ChatMessage,
  ChatHistoryQuery,
  ConversationContext,
  ChatStreamEvent,
} from './chat_types.js';
import { ChatService, getChatService } from './chat_service.js';
import { WorkspaceFS } from '../../coding/workspace/workspace_fs.js';

// Request/Response types for API
export interface CreateConversationRequest {
  workspaceId: string;
  userId: string;
  title?: string;
  context?: ConversationContext;
}

export interface SendMessageRequest {
  conversationId: string;
  workspaceId: string;
  userId: string;
  message: string;
  context?: ConversationContext;
  stream?: boolean;
  executeEdits?: boolean;
  previewPatches?: boolean;
}

export interface UpdateContextRequest {
  activeFiles?: string[];
  selectedCode?: {
    path: string;
    content: string;
    startLine: number;
    endLine: number;
    language: string;
  };
}

// WebSocket event types
export type WebSocketEventType =
  | 'chat:message'
  | 'chat:stream'
  | 'chat:action'
  | 'chat:patch'
  | 'chat:error';

export interface WebSocketEvent {
  type: WebSocketEventType;
  payload: unknown;
  timestamp: Date;
}

/**
 * Chat Controller
 */
export class ChatController {
  private service: ChatService;
  private wsClients: Map<string, Set<string>> = new Map(); // conversationId -> clientIds

  constructor(service?: ChatService) {
    this.service = service ?? getChatService();
  }

  /**
   * Create a new conversation
   */
  async createConversation(req: CreateConversationRequest): Promise<{
    success: boolean;
    conversation?: ChatConversation;
    error?: string;
  }> {
    try {
      const conversation = this.service.createConversation(
        req.workspaceId,
        req.userId,
        req.title,
        req.context
      );

      return {
        success: true,
        conversation,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create conversation',
      };
    }
  }

  /**
   * Send a message
   */
  async sendMessage(req: SendMessageRequest): Promise<ChatResponse> {
    const request: ChatRequest = {
      id: this.generateId(),
      conversationId: req.conversationId,
      workspaceId: req.workspaceId,
      userId: req.userId,
      message: req.message,
      context: req.context,
      options: {
        streamResponse: req.stream,
        executeEdits: req.executeEdits,
        previewPatches: req.previewPatches,
      },
      timestamp: new Date(),
    };

    // Stream events to WebSocket clients if streaming
    const onStream = req.stream
      ? (event: ChatStreamEvent) => this.broadcastToConversation(req.conversationId, {
          type: 'chat:stream',
          payload: event,
          timestamp: new Date(),
        })
      : undefined;

    return this.service.sendMessage(request, onStream);
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId: string): Promise<{
    success: boolean;
    conversation?: ChatConversation;
    error?: string;
  }> {
    const conversation = this.service.getConversation(conversationId);

    if (!conversation) {
      return {
        success: false,
        error: 'Conversation not found',
      };
    }

    return {
      success: true,
      conversation,
    };
  }

  /**
   * Get conversation messages
   */
  async getMessages(conversationId: string): Promise<{
    success: boolean;
    messages?: ChatMessage[];
    error?: string;
  }> {
    const messages = this.service.getMessages(conversationId);

    return {
      success: true,
      messages,
    };
  }

  /**
   * List conversations
   */
  async listConversations(query: ChatHistoryQuery): Promise<{
    success: boolean;
    conversations?: ChatConversation[];
    error?: string;
  }> {
    let conversations: ChatConversation[];

    if (query.workspaceId) {
      conversations = this.service.getConversationsByWorkspace(query.workspaceId);
    } else if (query.userId) {
      conversations = this.service.getConversationsByUser(query.userId);
    } else {
      return {
        success: false,
        error: 'Must provide workspaceId or userId',
      };
    }

    // Apply pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    const paginated = conversations.slice(offset, offset + limit);

    return {
      success: true,
      conversations: paginated,
    };
  }

  /**
   * Update conversation context
   */
  async updateContext(
    conversationId: string,
    req: UpdateContextRequest
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    const context: Partial<ConversationContext> = {};

    if (req.activeFiles) {
      context.activeFiles = req.activeFiles;
    }

    if (req.selectedCode) {
      context.selectedCode = req.selectedCode;
    }

    const success = this.service.updateContext(conversationId, context);

    return { success };
  }

  /**
   * Archive conversation
   */
  async archiveConversation(conversationId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const success = this.service.archiveConversation(conversationId);

    return { success };
  }

  /**
   * Delete conversation
   */
  async deleteConversation(conversationId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const success = this.service.deleteConversation(conversationId);

    return { success };
  }

  /**
   * Register WebSocket client
   */
  registerWebSocketClient(conversationId: string, clientId: string): void {
    if (!this.wsClients.has(conversationId)) {
      this.wsClients.set(conversationId, new Set());
    }
    this.wsClients.get(conversationId)!.add(clientId);
  }

  /**
   * Unregister WebSocket client
   */
  unregisterWebSocketClient(conversationId: string, clientId: string): void {
    const clients = this.wsClients.get(conversationId);
    if (clients) {
      clients.delete(clientId);
      if (clients.size === 0) {
        this.wsClients.delete(conversationId);
      }
    }
  }

  /**
   * Broadcast event to conversation clients
   */
  private broadcastToConversation(conversationId: string, event: WebSocketEvent): void {
    // In production, this would send via WebSocket server
    // For now, just log the event
    console.log(`[WS] Broadcasting to ${conversationId}:`, event.type);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Register workspace
   */
  registerWorkspace(workspaceId: string, workspace: WorkspaceFS): void {
    this.service.registerWorkspace(workspaceId, workspace);
  }
}

// Singleton instance
let defaultController: ChatController | null = null;

/**
 * Get default chat controller
 */
export function getChatController(): ChatController {
  if (!defaultController) {
    defaultController = new ChatController();
  }
  return defaultController;
}

/**
 * Create chat controller
 */
export function createChatController(service?: ChatService): ChatController {
  return new ChatController(service);
}

// Express/Fastify route handlers (can be adapted to any framework)

/**
 * Route: POST /chat/conversations
 */
export async function handleCreateConversation(
  body: CreateConversationRequest
): Promise<{ status: number; body: unknown }> {
  const controller = getChatController();
  const result = await controller.createConversation(body);

  return {
    status: result.success ? 201 : 400,
    body: result,
  };
}

/**
 * Route: POST /chat/messages
 */
export async function handleSendMessage(
  body: SendMessageRequest
): Promise<{ status: number; body: unknown }> {
  const controller = getChatController();

  try {
    const response = await controller.sendMessage(body);
    return {
      status: 200,
      body: response,
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send message',
      },
    };
  }
}

/**
 * Route: GET /chat/conversations/:id
 */
export async function handleGetConversation(
  conversationId: string
): Promise<{ status: number; body: unknown }> {
  const controller = getChatController();
  const result = await controller.getConversation(conversationId);

  return {
    status: result.success ? 200 : 404,
    body: result,
  };
}

/**
 * Route: GET /chat/conversations/:id/messages
 */
export async function handleGetMessages(
  conversationId: string
): Promise<{ status: number; body: unknown }> {
  const controller = getChatController();
  const result = await controller.getMessages(conversationId);

  return {
    status: 200,
    body: result,
  };
}

/**
 * Route: GET /chat/conversations
 */
export async function handleListConversations(
  query: ChatHistoryQuery
): Promise<{ status: number; body: unknown }> {
  const controller = getChatController();
  const result = await controller.listConversations(query);

  return {
    status: 200,
    body: result,
  };
}

/**
 * Route: DELETE /chat/conversations/:id
 */
export async function handleDeleteConversation(
  conversationId: string
): Promise<{ status: number; body: unknown }> {
  const controller = getChatController();
  const result = await controller.deleteConversation(conversationId);

  return {
    status: result.success ? 200 : 404,
    body: result,
  };
}
