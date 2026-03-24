import { WebSocket } from 'ws';
import { redis, RedisKeys } from '../lib/redis.js';
import { TerminalPTY } from '../streams/terminal_pty.js';
import { SnapshotManager } from '../vm_manager/snapshot_manager.js';

export const GatewayHandler = {
  async handleConnection(ws: WebSocket, sessionId: string): Promise<void> {
    console.log(`[Gateway] New WebSocket connection for session ${sessionId}`);

    // Get session info from Redis
    let sessionData = await redis.get(RedisKeys.session(sessionId));
    let vmId: string;
    let command: string;

    if (!sessionData) {
      // It might be a projectId from the IDE connecting directly. Check for an active VM.
      const activeVmId = await redis.get(`vm:project:${sessionId}:active`);
      if (activeVmId) {
        vmId = activeVmId;
        command = '/bin/bash'; // default fallback shell
      } else {
        ws.close(4004, 'Session or VM not found');
        return;
      }
    } else {
      const parsed = JSON.parse(sessionData);
      vmId = parsed.vmId;
      command = parsed.command;
    }

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
