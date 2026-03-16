import { WebSocket } from 'ws';
import { redis, RedisKeys } from '../lib/redis.js';
import { TerminalPTY } from '../streams/terminal_pty.js';
import { SnapshotManager } from '../vm_manager/snapshot_manager.js';

export const GatewayHandler = {
  async handleConnection(ws: WebSocket, sessionId: string): Promise<void> {
    console.log(`[Gateway] New WebSocket connection for session ${sessionId}`);

    // Get session info from Redis
    const sessionData = await redis.get(RedisKeys.session(sessionId));

    if (!sessionData) {
      ws.close(4004, 'Session not found');
      return;
    }

    const { vmId, command } = JSON.parse(sessionData);

    // Create PTY session
    const termSessionId = await TerminalPTY.createSession(vmId, command, ws);

    ws.on('message', (data) => {
      TerminalPTY.handleInput(termSessionId, data.toString());
    });

    ws.on('close', async () => {
      await TerminalPTY.closeSession(termSessionId);
    });
  },

  async handleHibernateCommand(projectId: string): Promise<void> {
    const vmId = await redis.get(`vm:project:${projectId}:active`);

    if (vmId) {
      await SnapshotManager.hibernateVM(vmId, projectId);
    }
  }
};
