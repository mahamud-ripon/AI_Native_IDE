import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import fs from 'fs';
import { redis, RedisKeys } from '../lib/redis.js';

// Maximum process lifetime in milliseconds (5 minutes)
const MAX_PROCESS_LIFETIME_MS = 5 * 60 * 1000;
// Sandbox working directory
const SANDBOX_DIR = '/tmp/sandbox';

const isDevelopment = process.env.NODE_ENV === 'development';

interface TerminalSession {
  sessionId: string;
  vmId: string;
  process: ChildProcess;
  ws: WebSocket;
}

const sessions = new Map<string, TerminalSession>();

// Allowed command patterns for safe execution
const ALLOWED_COMMAND_PATTERNS = [
  /^npm\s+(install|run|test|build|start|ci)/,
  /^pip\s+install/,
  /^python\s+/,
  /^node\s+/,
  /^cargo\s+(build|run|test)/,
  /^go\s+(build|run|test|mod)/,
  /^make\s+/,
  /^ls\s*/,
  /^cat\s+/,
  /^echo\s+/,
  /^pwd\s*$/,
  /^whoami\s*$/,
  /^date\s*$/,
  /^clear\s*$/,
  /^cd\s*/,
];

// Dangerous patterns to block
const DANGEROUS_PATTERNS = [
  /[;&|`$]/,                    // Command chaining/substitution
  /\.\./,                       // Directory traversal
  /\/etc\/|\/proc\/|\/sys\//,   // System directories
  />\s*\//,                     // Redirect to root
  /rm\s+-rf\s+\//,              // Recursive delete from root
  /sudo\s+/,                    // Privilege escalation
  /chmod\s+777/,                // Dangerous permissions
  /curl\s+.*\|\s*sh/,           // Remote code execution
  /wget\s+.*\|\s*sh/,           // Remote code execution
  /eval\s+/,                    // Code evaluation
  /exec\s+/,                    // Code execution
  /nc\s+/,                      // Netcat (network access)
  /ncat\s+/,                    // Ncat (network access)
  /\/dev\/tcp/,                  // Bash network redirection
  /\/dev\/udp/,                  // Bash UDP redirection
];

// Relaxed patterns for development mode (allows more commands)
const DEV_ALLOWED_COMMANDS = [
  /^npm\s+/,
  /^pip\s+/,
  /^python[3]?\s+/,
  /^node\s+/,
  /^cargo\s+/,
  /^go\s+/,
  /^make\s+/,
  /^ls\s*/,
  /^cat\s+/,
  /^echo\s+/,
  /^pwd\s*$/,
  /^whoami\s*$/,
  /^date\s*$/,
  /^clear\s*$/,
  /^cd\s*/,
  /^mkdir\s+/,
  /^touch\s+/,
  /^rm\s+/,
  /^cp\s+/,
  /^mv\s+/,
  /^grep\s+/,
  /^find\s+/,
  /^head\s+/,
  /^tail\s+/,
  /^wc\s+/,
  /^sort\s+/,
  /^uniq\s+/,
  /^git\s+/,
  /^vim\s+/,
  /^nano\s+/,
  /^less\s+/,
  /^more\s+/,
  /^env\s*$/,
  /^export\s+/,
  /^which\s+/,
  /^type\s+/,
  /^bash\s*$/,
  /^sh\s*$/,
  /^zsh\s*$/,
];

function validateCommand(command: string, allowDevCommands = false): { valid: boolean; error?: string } {
  // Check for dangerous patterns (always enforced)
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, error: `Command contains dangerous pattern: ${pattern.source}` };
    }
  }

  // Check against allowed patterns
  const patterns = allowDevCommands ? DEV_ALLOWED_COMMANDS : ALLOWED_COMMAND_PATTERNS;
  const isAllowed = patterns.some(pattern => pattern.test(command));
  if (!isAllowed) {
    return { valid: false, error: 'Command not in allowed list for safe execution' };
  }

  return { valid: true };
}

function sanitizeCommand(command: string): string {
  // Remove any null bytes and limit length
  return command.replace(/\0/g, '').substring(0, 4096);
}

/**
 * Send a ready-ack message to confirm the PTY session is ready
 */
function sendReadyAck(ws: WebSocket): void {
  ws.send(JSON.stringify({ type: 'ready' }));
}

/**
 * DevelopmentShellAdapter - Allows PTY access to local /tmp/sandbox without Firecracker VM prefix
 * Only available when NODE_ENV === 'development'
 */
const DevelopmentShellAdapter = {
  createInteractiveSession(ws: WebSocket): TerminalSession {
    const sessionId = `dev-term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[Terminal] Creating dev session ${sessionId}`);

    // Ensure sandbox directory exists
    try {
      if (!fs.existsSync(SANDBOX_DIR)) {
        fs.mkdirSync(SANDBOX_DIR, { recursive: true, mode: 0o700 });
      }
    } catch (err) {
      ws.send(`\x1b[31mError: Sandbox directory unavailable\x1b[0m\n`);
      throw new Error('Sandbox directory /tmp/sandbox does not exist and could not be created');
    }

    // Spawn an interactive shell in the sandbox
    const proc: ChildProcess = spawn('bash', ['--norc', '--noprofile'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: SANDBOX_DIR,
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: SANDBOX_DIR,
        SHELL: '/bin/bash',
        TERM: 'xterm-256color',
        PS1: '\\[\\033[36m\\]\\w\\[\\033[0m\\] $ ',
      },
    });

    const session: TerminalSession = {
      sessionId,
      vmId: 'dev-local',
      process: proc,
      ws,
    };

    sessions.set(sessionId, session);

    // Send ready-ack after shell spawns
    proc.on('spawn', () => {
      sendReadyAck(ws);
    });

    // Stream stdout
    proc.stdout?.on('data', (data: Buffer) => {
      ws.send(data.toString());
      // Also publish to Redis for persistence
      redis.publish(RedisKeys.terminal(sessionId), data.toString());
    });

    // Stream stderr
    proc.stderr?.on('data', (data: Buffer) => {
      ws.send(data.toString());
    });

    proc.on('exit', (code: number | null) => {
      ws.send(`\n\x1b[33mShell exited with code ${code}\x1b[0m\n`);
      sessions.delete(sessionId);
    });

    proc.on('error', (err: Error) => {
      console.error(`[Terminal] Dev shell error:`, err);
      ws.send(`\x1b[31mError: ${err.message}\x1b[0m\n`);
      sessions.delete(sessionId);
    });

    return session;
  },
};

export const TerminalPTY = {
  async createSession(vmId: string, command: string, ws: WebSocket): Promise<string> {
    // Development mode fallback: allow local shell without Firecracker prefix
    if (!vmId.startsWith('fc-')) {
      if (isDevelopment) {
        console.log(`[Terminal] Development mode: allowing local shell for vmId="${vmId}"`);
        const session = DevelopmentShellAdapter.createInteractiveSession(ws);
        return session.sessionId;
      }
      throw new Error(
        `TerminalPTY.createSession must only be used with Firecracker VMs (vmId must start with "fc-"). ` +
        `For browser-tier projects, use WebContainer jsh via the frontend.`
      );
    }

    const sessionId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[Terminal] Creating session ${sessionId} on VM ${vmId}`);

    // Sanitize and validate command
    const sanitizedCommand = sanitizeCommand(command);
    const validation = validateCommand(sanitizedCommand, isDevelopment);
    
    if (!validation.valid) {
      ws.send(`\x1b[31mError: ${validation.error}\x1b[0m\n`);
      throw new Error(`Invalid command: ${validation.error}`);
    }

    // Ensure sandbox directory exists
    try {
      if (!fs.existsSync(SANDBOX_DIR)) {
        fs.mkdirSync(SANDBOX_DIR, { recursive: true, mode: 0o700 });
      }
    } catch (err) {
      ws.send(`\x1b[31mError: Sandbox directory unavailable\x1b[0m\n`);
      throw new Error('Sandbox directory /tmp/sandbox does not exist and could not be created');
    }

    // For development/testing with safety constraints:
    const proc: ChildProcess = spawn('sh', ['-c', sanitizedCommand], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: SANDBOX_DIR,
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: SANDBOX_DIR,
        SHELL: '/bin/sh',
      },
    });

    // Kill process after MAX_PROCESS_LIFETIME_MS to prevent runaway processes
    const killTimer = setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGTERM');
        ws.send(`\x1b[33m\nProcess terminated: exceeded ${MAX_PROCESS_LIFETIME_MS / 1000}s timeout\x1b[0m\n`);
      }
    }, MAX_PROCESS_LIFETIME_MS);

    const session: TerminalSession = {
      sessionId,
      vmId,
      process: proc,
      ws,
    };

    sessions.set(sessionId, session);

    // Send ready-ack after process spawns
    proc.on('spawn', () => {
      sendReadyAck(ws);
    });

    // Stream stdout
    proc.stdout?.on('data', (data: Buffer) => {
      ws.send(data.toString());
      redis.publish(RedisKeys.terminal(sessionId), data.toString());
    });

    // Stream stderr
    proc.stderr?.on('data', (data: Buffer) => {
      ws.send(`\x1b[31m${data.toString()}\x1b[0m`);
    });

    proc.on('exit', (code: number | null) => {
      clearTimeout(killTimer);
      ws.send(`\n\x1b[33mProcess exited with code ${code}\x1b[0m\n`);
      sessions.delete(sessionId);
    });

    proc.on('error', (err: Error) => {
      clearTimeout(killTimer);
      console.error(`[Terminal] Process error:`, err);
      ws.send(`\x1b[31mError: ${err.message}\x1b[0m\n`);
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
      // Sanitize input before writing to process
      const sanitizedInput = data.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      session.process.stdin?.write(sanitizedInput);
    }
  },

  async closeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;

    session.process.kill();
    session.ws.close();
    sessions.delete(sessionId);
  },

  getActiveSessions(): number {
    return sessions.size;
  },
};
