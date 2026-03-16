import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import { redis, RedisKeys } from '../lib/redis.js';

interface TerminalSession {
  sessionId: string;
  vmId: string;
  process: ChildProcess;
  ws: WebSocket;
}

const sessions = new Map<string, TerminalSession>();

export const TerminalPTY = {
  async createSession(vmId: string, command: string, ws: WebSocket): Promise<string> {
    const sessionId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[Terminal] Creating session ${sessionId} on VM ${vmId}`);

    // In production, this would exec into the Firecracker VM
    // For simulation, spawn a local process
    const proc = spawn('sh', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const session: TerminalSession = {
      sessionId,
      vmId,
      process: proc,
      ws
    };

    sessions.set(sessionId, session);

    // Stream stdout
    proc.stdout?.on('data', (data: Buffer) => {
      ws.send(data.toString());
      // Also publish to Redis for persistence
      redis.publish(RedisKeys.terminal(sessionId), data.toString());
    });

    // Stream stderr
    proc.stderr?.on('data', (data: Buffer) => {
      ws.send(`\x1b[31m${data.toString()}\x1b[0m`); // Red color
    });

    proc.on('exit', (code) => {
      ws.send(`\n\x1b[33mProcess exited with code ${code}\x1b[0m\n`);
      sessions.delete(sessionId);
    });

    return sessionId;
  },

  handleInput(sessionId: string, data: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Handle special keys
    if (data === '\x03') { // Ctrl+C
      session.process.kill('SIGINT');
    } else if (data === '\x04') { // Ctrl+D
      session.process.kill('SIGTERM');
    } else {
      session.process.stdin?.write(data);
    }
  },

  async closeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;

    session.process.kill();
    session.ws.close();
    sessions.delete(sessionId);

    console.log(`[Terminal] Closed session ${sessionId}`);
  },

  getActiveSessions(): number {
    return sessions.size;
  }
};
