import { publish } from '../lib/redis';

export const TerminalHandler = {
  async handleInput(connId: string, sessionId: string, input: string): Promise<void> {
    await publish(`terminal:${sessionId}`, {
      type: 'input',
      connId,
      input,
    });
  },

  async handleResize(connId: string, sessionId: string, cols: number, rows: number): Promise<void> {
    await publish(`terminal:${sessionId}`, {
      type: 'resize',
      connId,
      cols,
      rows,
    });
  },

  async handleStartSession(connId: string, sessionId: string, projectId: string): Promise<void> {
    await publish(`terminal:${sessionId}`, {
      type: 'start',
      connId,
      projectId,
    });
  },

  async handleCloseSession(connId: string, sessionId: string): Promise<void> {
    await publish(`terminal:${sessionId}`, {
      type: 'close',
      connId,
    });
  },
};

export default TerminalHandler;
