import { publish } from '../lib/redis';

const MAX_INPUT_LENGTH = 64 * 1024; // 64KB max terminal input

function sanitizeId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

export const TerminalHandler = {
  async handleInput(connId: string, sessionId: string, input: string): Promise<void> {
    if (!sanitizeId(sessionId)) throw new Error('Invalid sessionId');
    if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) {
      throw new Error('Terminal input exceeds maximum length');
    }

    await publish(`terminal:${sessionId}`, {
      type: 'input',
      connId,
      input,
    });
  },

  async handleResize(connId: string, sessionId: string, cols: number, rows: number): Promise<void> {
    if (!sanitizeId(sessionId)) throw new Error('Invalid sessionId');
    if (!Number.isInteger(cols) || cols < 1 || cols > 9999) throw new Error('Invalid cols');
    if (!Number.isInteger(rows) || rows < 1 || rows > 9999) throw new Error('Invalid rows');

    await publish(`terminal:${sessionId}`, {
      type: 'resize',
      connId,
      cols,
      rows,
    });
  },

  async handleStartSession(connId: string, sessionId: string, projectId: string): Promise<void> {
    if (!sanitizeId(sessionId)) throw new Error('Invalid sessionId');
    if (!sanitizeId(projectId)) throw new Error('Invalid projectId');

    await publish(`terminal:${sessionId}`, {
      type: 'start',
      connId,
      projectId,
    });
  },

  async handleCloseSession(connId: string, sessionId: string): Promise<void> {
    if (!sanitizeId(sessionId)) throw new Error('Invalid sessionId');

    await publish(`terminal:${sessionId}`, {
      type: 'close',
      connId,
    });
  },
};

export default TerminalHandler;
