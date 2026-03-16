/**
 * Chat Service
 * 
 * Core service for AI coding chat operations.
 * Manages conversations, messages, and integrates with CodeAgent.
 */

import * as crypto from 'crypto';
import {
  ChatMessage,
  ChatConversation,
  ChatRequest,
  ChatResponse,
  ChatAction,
  ChatPatch,
  ChatMetrics,
  ConversationContext,
  ChatServiceConfig,
  CHAT_SERVICE_DEFAULTS,
  ChatHistoryQuery,
  ChatRole,
  ChatActionType,
} from './chat_types.js';
import { ChatPromptBuilder, getPromptBuilder, BuiltPrompt } from './chat_prompt_builder.js';
import { ChatStreamer, getChatStreamer, StreamCallback } from './chat_streamer.js';
import { WorkspaceFS } from '../../coding/workspace/workspace_fs.js';
import { CodeAgent, createCodeAgent } from '../../coding/agent/code_agent.js';
import { getContextBuilder } from '../../coding/context/project_context_builder.js';
import { getCodeIndex } from '../../coding/retrieval/code_index.js';
import { ProjectContext } from '../../coding/context/context_types.js';
import { SearchResult } from '../../coding/retrieval/retrieval_types.js';
import { getTracer } from '../../observability/agent_tracing.js';
import { recordTokenUsage } from '../../observability/token_usage.js';
import { recordTaskMetrics } from '../../observability/task_metrics.js';

// LLM Provider type
import { LLMProvider } from '../../coding/agent/agent_types.js';
import { getLLMProvider } from '../../coding/agent/plan_generator.js';

/**
 * Chat Service
 */
export class ChatService {
  private config: Required<ChatServiceConfig>;
  private conversations: Map<string, ChatConversation> = new Map();
  private messages: Map<string, ChatMessage[]> = new Map();
  private promptBuilder: ChatPromptBuilder;
  private streamer: ChatStreamer;
  private provider: LLMProvider | null = null;
  private workspaces: Map<string, WorkspaceFS> = new Map();

  constructor(config?: Partial<ChatServiceConfig>) {
    this.config = { ...CHAT_SERVICE_DEFAULTS, ...config } as Required<ChatServiceConfig>;
    this.promptBuilder = getPromptBuilder();
    this.streamer = getChatStreamer();
    this.provider = getLLMProvider();
  }

  /**
   * Set LLM provider
   */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
    this.streamer.setProvider(provider);
  }

  /**
   * Register workspace
   */
  registerWorkspace(workspaceId: string, workspace: WorkspaceFS): void {
    this.workspaces.set(workspaceId, workspace);
  }

  /**
   * Create a new conversation
   */
  createConversation(
    workspaceId: string,
    userId: string,
    title?: string,
    context?: ConversationContext
  ): ChatConversation {
    const id = this.generateId();

    const conversation: ChatConversation = {
      id,
      workspaceId,
      userId,
      title: title ?? 'New Chat',
      messages: [],
      context: context ?? { activeFiles: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
    };

    this.conversations.set(id, conversation);
    this.messages.set(id, []);

    return conversation;
  }

  /**
   * Send a message and get response
   */
  async sendMessage(
    request: ChatRequest,
    onStream?: StreamCallback
  ): Promise<ChatResponse> {
    const startTime = Date.now();
    const tracer = getTracer();

    // Start trace
    const traceId = tracer.startAgentTrace({
      agentId: 'chat-service',
      taskId: request.id,
      workspaceId: request.workspaceId,
      userId: request.userId,
      prompt: request.message,
    });

    try {
      // Get or create conversation
      let conversation = this.conversations.get(request.conversationId);
      if (!conversation) {
        conversation = this.createConversation(
          request.workspaceId,
          request.userId,
          request.message.slice(0, 50)
        );
        request.conversationId = conversation.id;
      }

      // Create user message
      const userMessage: ChatMessage = {
        id: this.generateId(),
        conversationId: conversation.id,
        role: 'user',
        content: request.message,
        status: 'completed',
        timestamp: new Date(),
      };

      // Add to conversation
      this.addMessage(conversation.id, userMessage);

      // Get workspace
      const workspace = this.workspaces.get(request.workspaceId);

      // Build context
      const { projectContext, searchResults } = await this.buildContext(
        request,
        workspace
      );

      // Get history
      const history = this.messages.get(conversation.id) ?? [];

      // Build prompt
      const prompt = this.promptBuilder.buildPrompt(
        request,
        history,
        projectContext,
        searchResults
      );

      // Record LLM call start
      const llmStartTime = Date.now();

      // Stream or complete
      let assistantContent = '';
      let tokensUsed = 0;

      if (request.options?.streamResponse ?? this.config.streamEnabled) {
        assistantContent = await this.streamer.streamResponse(
          conversation.id,
          request.userId,
          prompt.messages,
          {
            model: request.options?.model ?? this.config.defaultModel,
            temperature: request.options?.temperature ?? this.config.defaultTemperature,
            maxTokens: request.options?.maxTokens,
            onEvent: onStream,
          }
        );
      } else if (this.provider) {
        const response = await this.provider.complete(
          prompt.messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
          {
            model: request.options?.model ?? this.config.defaultModel,
            temperature: request.options?.temperature ?? this.config.defaultTemperature,
            maxTokens: request.options?.maxTokens,
          }
        );
        assistantContent = response.content;
        tokensUsed = response.usage?.totalTokens ?? 0;
      }

      const llmLatencyMs = Date.now() - llmStartTime;

      // Record LLM call
      tracer.recordLLMCall(traceId, {
        model: request.options?.model ?? this.config.defaultModel,
        provider: 'default',
        promptTokens: prompt.totalTokens,
        completionTokens: tokensUsed,
        totalTokens: prompt.totalTokens + tokensUsed,
        durationMs: llmLatencyMs,
        success: true,
        cached: false,
      });

      // Parse response for actions and patches
      const { action, patches } = this.parseResponse(assistantContent);

      // Create assistant message
      const assistantMessage: ChatMessage = {
        id: this.generateId(),
        conversationId: conversation.id,
        role: 'assistant',
        content: assistantContent,
        status: 'completed',
        timestamp: new Date(),
        metadata: {
          action: action?.type,
          filesModified: patches?.map(p => p.path),
          patchesGenerated: patches?.map(p => p.id),
          tokensUsed,
          model: request.options?.model ?? this.config.defaultModel,
          latencyMs: Date.now() - startTime,
          traceId,
        },
      };

      // Add to conversation
      this.addMessage(conversation.id, assistantMessage);

      // Execute patches if requested and auto-execute enabled
      if (patches && patches.length > 0 && request.options?.executeEdits && workspace) {
        await this.executePatches(patches, workspace, traceId);
      }

      // Record token usage
      recordTokenUsage({
        workspaceId: request.workspaceId,
        userId: request.userId,
        taskId: request.id,
        provider: 'default',
        model: request.options?.model ?? this.config.defaultModel,
        promptTokens: prompt.totalTokens,
        completionTokens: tokensUsed,
      });

      // End trace
      tracer.endAgentTrace(traceId, true);

      // Build metrics
      const metrics: ChatMetrics = {
        promptTokens: prompt.totalTokens,
        completionTokens: tokensUsed,
        totalTokens: prompt.totalTokens + tokensUsed,
        latencyMs: Date.now() - startTime,
        contextTokens: prompt.contextTokens,
      };

      return {
        id: this.generateId(),
        requestId: request.id,
        conversationId: conversation.id,
        message: assistantMessage,
        action,
        patches,
        context: request.context,
        metrics,
      };
    } catch (error) {
      tracer.endAgentTrace(traceId, false, error instanceof Error ? error.message : 'Unknown error');

      throw error;
    }
  }

  /**
   * Build context for request
   */
  private async buildContext(
    request: ChatRequest,
    workspace?: WorkspaceFS
  ): Promise<{
    projectContext?: ProjectContext;
    searchResults?: SearchResult[];
  }> {
    const result: { projectContext?: ProjectContext; searchResults?: SearchResult[] } = {};

    if (!workspace) {
      return result;
    }

    // Build project context
    if (request.options?.includeContext ?? true) {
      try {
        const builder = getContextBuilder();
        const contextResult = await builder.buildContext(workspace, {
          userPrompt: request.message,
          maxTokens: request.options?.contextMaxTokens ?? this.config.contextMaxTokens,
        });

        if (contextResult.success && contextResult.context) {
          result.projectContext = contextResult.context;
        }
      } catch {
        // Context building failed, continue without
      }
    }

    // Search for relevant code
    try {
      const codeIndex = getCodeIndex();
      result.searchResults = await codeIndex.search(request.message, {
        mode: 'hybrid',
        maxResults: 5,
        minScore: 0.5,
      });
    } catch {
      // Search failed, continue without
    }

    return result;
  }

  /**
   * Parse response for actions and patches
   */
  private parseResponse(content: string): {
    action?: ChatAction;
    patches?: ChatPatch[];
  } {
    const patches: ChatPatch[] = [];

    // Extract code blocks that look like patches
    const codeBlockRegex = /```(?:diff|patch)?\n([\s\S]*?)```/g;
    let match;
    let patchIndex = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const patchContent = match[1];

      // Check if it looks like a diff
      if (patchContent.includes('---') || patchContent.includes('+++') || patchContent.includes('@@')) {
        const pathMatch = patchContent.match(/(?:---|\+\+\+)\s+(?:a\/)?([^\n]+)/);
        const filePath = pathMatch ? pathMatch[1] : `unknown-${patchIndex}.ts`;

        patches.push({
          id: this.generateId(),
          path: filePath,
          operation: 'modify',
          patch: patchContent,
          preview: patchContent.slice(0, 200),
          linesAdded: (patchContent.match(/^\+/gm) || []).length,
          linesRemoved: (patchContent.match(/^-/gm) || []).length,
          status: 'pending',
        });

        patchIndex++;
      }
    }

    // Determine action type
    let actionType: ChatActionType | undefined;
    if (patches.length > 0) {
      actionType = 'code_edit';
    } else if (content.toLowerCase().includes('explain')) {
      actionType = 'explain';
    } else if (content.toLowerCase().includes('refactor')) {
      actionType = 'refactor';
    }

    const action: ChatAction | undefined = actionType ? {
      type: actionType,
      description: `Detected ${actionType} action`,
      files: patches.map(p => p.path),
      status: 'pending',
    } : undefined;

    return { action, patches: patches.length > 0 ? patches : undefined };
  }

  /**
   * Execute patches
   */
  private async executePatches(
    patches: ChatPatch[],
    workspace: WorkspaceFS,
    traceId: string
  ): Promise<void> {
    for (const patch of patches) {
      try {
        await workspace.applyPatch(patch.patch);
        patch.status = 'applied';
      } catch (error) {
        patch.status = 'rejected';
      }
    }
  }

  /**
   * Add message to conversation
   */
  private addMessage(conversationId: string, message: ChatMessage): void {
    const messages = this.messages.get(conversationId) ?? [];
    messages.push(message);
    this.messages.set(conversationId, messages);

    // Update conversation
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.messages = messages;
      conversation.updatedAt = new Date();
    }
  }

  /**
   * Get conversation
   */
  getConversation(conversationId: string): ChatConversation | undefined {
    return this.conversations.get(conversationId);
  }

  /**
   * Get conversation messages
   */
  getMessages(conversationId: string): ChatMessage[] {
    return this.messages.get(conversationId) ?? [];
  }

  /**
   * Get conversations by workspace
   */
  getConversationsByWorkspace(workspaceId: string): ChatConversation[] {
    return Array.from(this.conversations.values())
      .filter(c => c.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /**
   * Get conversations by user
   */
  getConversationsByUser(userId: string): ChatConversation[] {
    return Array.from(this.conversations.values())
      .filter(c => c.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /**
   * Archive conversation
   */
  archiveConversation(conversationId: string): boolean {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return false;

    conversation.status = 'archived';
    return true;
  }

  /**
   * Delete conversation
   */
  deleteConversation(conversationId: string): boolean {
    if (!this.conversations.has(conversationId)) return false;

    this.conversations.delete(conversationId);
    this.messages.delete(conversationId);
    return true;
  }

  /**
   * Update conversation context
   */
  updateContext(conversationId: string, context: Partial<ConversationContext>): boolean {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return false;

    conversation.context = { ...conversation.context, ...context };
    conversation.updatedAt = new Date();
    return true;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`chat-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultService: ChatService | null = null;

/**
 * Get default chat service
 */
export function getChatService(): ChatService {
  if (!defaultService) {
    defaultService = new ChatService();
  }
  return defaultService;
}

/**
 * Create chat service
 */
export function createChatService(config?: Partial<ChatServiceConfig>): ChatService {
  return new ChatService(config);
}

/**
 * Send message helper
 */
export async function sendChatMessage(
  request: ChatRequest,
  onStream?: StreamCallback
): Promise<ChatResponse> {
  return getChatService().sendMessage(request, onStream);
}
