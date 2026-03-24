import { publish } from '../lib/redis';

const MAX_PROMPT_LENGTH = 100_000; // 100KB max prompt

function sanitizeId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

export const AIHandler = {
  async handleRequest(connId: string, conversationId: string, prompt: string, messageId: string): Promise<void> {
    if (!sanitizeId(conversationId)) throw new Error('Invalid conversationId');
    if (!sanitizeId(messageId)) throw new Error('Invalid messageId');
    if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error('Prompt exceeds maximum length');
    }

    await publish(`ai:${conversationId}`, {
      type: 'request',
      connId,
      prompt,
      messageId,
    });
  },

  async handleCancel(connId: string, conversationId: string): Promise<void> {
    if (!sanitizeId(conversationId)) throw new Error('Invalid conversationId');

    await publish(`ai:${conversationId}`, {
      type: 'cancel',
      connId,
    });
  },

  async handleFeedback(connId: string, conversationId: string, messageId: string, feedback: 'thumbs_up' | 'thumbs_down'): Promise<void> {
    if (!sanitizeId(conversationId)) throw new Error('Invalid conversationId');
    if (!sanitizeId(messageId)) throw new Error('Invalid messageId');
    if (feedback !== 'thumbs_up' && feedback !== 'thumbs_down') throw new Error('Invalid feedback');

    await publish(`ai:${conversationId}`, {
      type: 'feedback',
      connId,
      messageId,
      feedback,
    });
  },
};

export default AIHandler;
