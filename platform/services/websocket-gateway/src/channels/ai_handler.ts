import { publish } from '../lib/redis';

export const AIHandler = {
  async handleRequest(connId: string, conversationId: string, prompt: string, messageId: string): Promise<void> {
    await publish(`ai:${conversationId}`, {
      type: 'request',
      connId,
      prompt,
      messageId,
    });
  },

  async handleCancel(connId: string, conversationId: string): Promise<void> {
    await publish(`ai:${conversationId}`, {
      type: 'cancel',
      connId,
    });
  },

  async handleFeedback(connId: string, conversationId: string, messageId: string, feedback: 'thumbs_up' | 'thumbs_down'): Promise<void> {
    await publish(`ai:${conversationId}`, {
      type: 'feedback',
      connId,
      messageId,
      feedback,
    });
  },
};

export default AIHandler;
