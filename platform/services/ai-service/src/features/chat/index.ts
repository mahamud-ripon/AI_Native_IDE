/**
 * Chat Feature Module
 * 
 * AI Coding Chat - Cursor-style workspace chat with code execution.
 */

// Service
export {
  ChatService,
  getChatService,
  createChatService,
  sendChatMessage,
} from './chat_service.js';

// Controller
export {
  ChatController,
  getChatController,
  createChatController,
  handleCreateConversation,
  handleSendMessage,
  handleGetConversation,
  handleGetMessages,
  handleListConversations,
  handleDeleteConversation,
} from './chat_controller.js';
export type {
  CreateConversationRequest,
  SendMessageRequest,
  UpdateContextRequest,
  WebSocketEventType,
  WebSocketEvent,
} from './chat_controller.js';

// Prompt Builder
export {
  ChatPromptBuilder,
  getPromptBuilder,
  createPromptBuilder,
  buildChatPrompt,
} from './chat_prompt_builder.js';
export type { BuiltPrompt } from './chat_prompt_builder.js';

// Streamer
export {
  ChatStreamer,
  getChatStreamer,
  createChatStreamer,
  streamChatResponse,
} from './chat_streamer.js';
export type { StreamCallback } from './chat_streamer.js';

// Types
export {
  ChatRole,
  ChatStatus,
  ChatActionType,
  ChatMessage,
  ChatMessageMetadata,
  ChatConversation,
  ConversationContext,
  SelectedCode,
  ContextChunk,
  ProjectContextSummary,
  ChatRequest,
  ChatOptions,
  ChatResponse,
  ChatAction,
  ActionResult,
  ChatPatch,
  ChatMetrics,
  ChatStreamEvent,
  StreamProgress,
  ChatHistoryQuery,
  ChatServiceConfig,
  CHAT_SERVICE_DEFAULTS,
  SYSTEM_PROMPTS,
} from './chat_types.js';
