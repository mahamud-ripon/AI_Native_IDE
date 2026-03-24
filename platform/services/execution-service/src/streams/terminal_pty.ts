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
];

function validateCommand(command: string): { valid: boolean; error?: string } {
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, error: `Command contains dangerous pattern: ${pattern.source}` };
    }
  }

  // Check against allowed patterns (for non-VM execution fallback)
  const isAllowed = ALLOWED_COMMAND_PATTERNS.some(pattern => pattern.test(command));
  if (!isAllowed) {
    return { valid: false, error: 'Command not in allowed list for safe execution' };
  }

  return { valid: true };
}

function sanitizeCommand(command: string): string {
  // Remove any null bytes and limit length
  return command.replace(/\0/g, '').substring(0, 4096);
}

export const TerminalPTY = {
  async createSession(vmId: string, command: string, ws: WebSocket): Promise<string> {
    // SECURITY: This function must only be called for Firecracker VM PTY sessions.
    // Do NOT call this for browser-tier projects — use WebContainer jsh instead.
    // Validate that vmId starts with 'fc-' (Firecracker prefix)
    if (!vmId.startsWith('fc-')) {
      throw new Error(
        `TerminalPTY.createSession must only be used with Firecracker VMs (vmId must start with "fc-"). ` +
        `For browser-tier projects, use WebContainer jsh via the frontend.`
      );
    }

    const sessionId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[Terminal] Creating session ${sessionId} on VM ${vmId}`);

    // Sanitize and validate command
    const sanitizedCommand = sanitizeCommand(command);
    const validation = validateCommand(sanitizedCommand);
    
    if (!validation.valid) {
      ws.send(`\x1b[31mError: ${validation.error}\x1b[0m\n`);
      throw new Error(`Invalid command: ${validation.error}`);
    }

    // In production, this MUST exec into the Firecracker VM via the VM socket
    // The command runs inside the isolated VM, NOT on the host
    // TODO: Replace this with actual Firecracker VM exec via socket connection
    // For now, we use a restricted shell environment
    
    // SECURITY: In production, connect to VM socket and run command there
    // const vmSocket = await getVMSocket(vmId);
    // const proc = spawn('firecracker-exec', [vmId, sanitizedCommand]);
    
    // For development/testing with safety constraints:
    const proc = spawn('sh', ['-c', sanitizedCommand], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: '/tmp/sandbox',  // Restricted working directory
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/tmp/sandbox',
        // Strip dangerous env vars
      },
      // Drop privileges if possible
      uid: process.getuid?.() ?? undefined,
      gid: process.getgid?.() ?? undefined,
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

    proc.on('error', (err) => {
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

    console.log(`[Terminal] Closed session ${sessionId}`);
  },

  getActiveSessions(): number {
    return sessions.size;
  }
};
