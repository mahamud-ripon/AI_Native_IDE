/**
 * Chat Streamer
 * 
 * Handles streaming responses for real-time chat interactions.
 * Integrates with WebSocket infrastructure for live updates.
 */

import * as crypto from 'crypto';
import {
  ChatStreamEvent,
  StreamProgress,
  ChatAction,
  ChatPatch,
  ChatRole,
} from './chat_types.js';
import { LLMProvider, LLMStreamChunk, LLMMessage } from '../../coding/agent/agent_types.js';

// Stream session
interface StreamSession {
  id: string;
  conversationId: string;
  userId: string;
  startedAt: Date;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  events: ChatStreamEvent[];
}

// Stream callback
export type StreamCallback = (event: ChatStreamEvent) => void;

/**
 * Chat Streamer
 */
export class ChatStreamer {
  private provider: LLMProvider | null = null;
  private sessions: Map<string, StreamSession> = new Map();
  private activeStreams: Map<string, AbortController> = new Map();

  /**
   * Set LLM provider
   */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  /**
   * Stream a response
   */
  async streamResponse(
    conversationId: string,
    userId: string,
    messages: Array<{ role: string; content: string }>,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      onEvent?: StreamCallback;
    }
  ): Promise<string> {
    const sessionId = this.generateId();

    // Create session
    const session: StreamSession = {
      id: sessionId,
      conversationId,
      userId,
      startedAt: new Date(),
      status: 'active',
      events: [],
    };
    this.sessions.set(sessionId, session);

    // Create abort controller
    const abortController = new AbortController();
    this.activeStreams.set(sessionId, abortController);

    let fullContent = '';

    try {
      if (!this.provider) {
        throw new Error('LLM provider not configured');
      }

      // Emit start event
      this.emitEvent(session, {
        type: 'progress',
        progress: {
          stage: 'thinking',
          progress: 0,
          message: 'Starting response...',
        },
      }, options?.onEvent);

      // Cast messages to LLM format
      const llmMessages: LLMMessage[] = messages.map(m => ({
        role: m.role as LLMMessage['role'],
        content: m.content,
      }));

      // Stream from LLM
      const stream = this.provider.stream(llmMessages, {
        model: options?.model,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      });

      for await (const chunk of stream) {
        // Check for cancellation
        if (abortController.signal.aborted) {
          session.status = 'cancelled';
          break;
        }

        // Process chunk
        if (chunk.content) {
          fullContent += chunk.content;

          this.emitEvent(session, {
            type: 'content',
            content: chunk.content,
          }, options?.onEvent);
        }

        if (chunk.done) {
          break;
        }
      }

      // Emit completion
      session.status = 'completed';
      this.emitEvent(session, {
        type: 'done',
      }, options?.onEvent);

      return fullContent;
    } catch (error) {
      session.status = 'failed';
      this.emitEvent(session, {
        type: 'error',
        error: error instanceof Error ? error.message : 'Stream failed',
      }, options?.onEvent);
      throw error;
    } finally {
      this.activeStreams.delete(sessionId);
    }
  }

  /**
   * Stream with progress stages
   */
  async streamWithProgress(
    conversationId: string,
    userId: string,
    stages: Array<{
      stage: StreamProgress['stage'];
      action: () => Promise<string | void>;
    }>,
    options?: {
      onEvent?: StreamCallback;
    }
  ): Promise<string> {
    const sessionId = this.generateId();

    const session: StreamSession = {
      id: sessionId,
      conversationId,
      userId,
      startedAt: new Date(),
      status: 'active',
      events: [],
    };
    this.sessions.set(sessionId, session);

    const results: string[] = [];

    try {
      for (let i = 0; i < stages.length; i++) {
        const { stage, action } = stages[i];
        const progress = (i + 1) / stages.length;

        // Emit progress
        this.emitEvent(session, {
          type: 'progress',
          progress: {
            stage,
            progress,
            message: `${stage}...`,
          },
        }, options?.onEvent);

        // Execute action
        const result = await action();
        if (result) {
          results.push(result);

          // Emit content
          this.emitEvent(session, {
            type: 'content',
            content: result,
          }, options?.onEvent);
        }
      }

      // Emit done
      session.status = 'completed';
      this.emitEvent(session, { type: 'done' }, options?.onEvent);

      return results.join('\n');
    } catch (error) {
      session.status = 'failed';
      this.emitEvent(session, {
        type: 'error',
        error: error instanceof Error ? error.message : 'Stream failed',
      }, options?.onEvent);
      throw error;
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Stream action updates
   */
  streamAction(
    conversationId: string,
    action: ChatAction,
    onEvent?: StreamCallback
  ): void {
    const session = this.getSessionByConversation(conversationId);
    if (!session) return;

    this.emitEvent(session, {
      type: 'action',
      action,
    }, onEvent);
  }

  /**
   * Stream patch updates
   */
  streamPatch(
    conversationId: string,
    patch: ChatPatch,
    onEvent?: StreamCallback
  ): void {
    const session = this.getSessionByConversation(conversationId);
    if (!session) return;

    this.emitEvent(session, {
      type: 'patch',
      patch,
    }, onEvent);
  }

  /**
   * Cancel active stream
   */
  cancelStream(sessionId: string): boolean {
    const controller = this.activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'cancelled';
      }
      return true;
    }
    return false;
  }

  /**
   * Get session by conversation
   */
  private getSessionByConversation(conversationId: string): StreamSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Get session
   */
  getSession(sessionId: string): StreamSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get active streams
   */
  getActiveStreams(): StreamSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  /**
   * Emit event
   */
  private emitEvent(
    session: StreamSession,
    event: ChatStreamEvent,
    callback?: StreamCallback
  ): void {
    session.events.push(event);

    if (callback) {
      callback(event);
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`stream-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }

  /**
   * Clear old sessions
   */
  clearOldSessions(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleared = 0;

    for (const [id, session] of this.sessions) {
      if (session.startedAt.getTime() < cutoff && session.status !== 'active') {
        this.sessions.delete(id);
        cleared++;
      }
    }

    return cleared;
  }
}

// Singleton instance
let defaultStreamer: ChatStreamer | null = null;

/**
 * Get default streamer
 */
export function getChatStreamer(): ChatStreamer {
  if (!defaultStreamer) {
    defaultStreamer = new ChatStreamer();
  }
  return defaultStreamer;
}

/**
 * Create streamer
 */
export function createChatStreamer(): ChatStreamer {
  return new ChatStreamer();
}

/**
 * Stream response helper
 */
export async function streamChatResponse(
  conversationId: string,
  userId: string,
  messages: Array<{ role: string; content: string }>,
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    onEvent?: StreamCallback;
  }
): Promise<string> {
  return getChatStreamer().streamResponse(conversationId, userId, messages, options);
}
