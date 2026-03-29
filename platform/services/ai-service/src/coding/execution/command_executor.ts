/**
 * Command Executor - Runs shell commands safely
 *
 * Executes safe commands directly via child_process.
 * Safe commands are auto-approved, unsafe commands require approval.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Commands that are always safe (read-only or common dev operations)
const SAFE_COMMAND_PATTERNS: RegExp[] = [
  // Read-only commands
  /^ls(\s|$)/, /^cat\s+/, /^pwd$/, /^echo\s+/, /^which\s+/, /^find\s+/,
  /^grep\s+/, /^head\s+/, /^tail\s+/, /^wc\s+/, /^date$/, /^whoami$/,
  /^tree(\s|$)/, /^stat\s+/, /^file\s+/, /^du\s+/, /^df\s+/,

  // Common dev commands
  /^npm\s+install$/, /^npm\s+install\s+/, /^npm\s+run\s+/, /^npm\s+list(\s|$)/,
  /^npm\s+test(\s|$)/, /^npm\s+start(\s|$)/, /^npm\s+build(\s|$)/,
  /^npm\s+ci(\s|$)/, /^npm\s+audit(\s|$)/, /^npm\s+outdated(\s|$)/,
  /^npm\s+version(\s|$)/, /^npm\s+info\s+/, /^npm\s+search\s+/,
  /^pnpm\s+install$/, /^pnpm\s+install\s+/, /^pnpm\s+run\s+/, /^pnpm\s+list(\s|$)/,
  /^yarn\s+install$/, /^yarn\s+install\s+/, /^yarn\s+run\s+/, /^yarn\s+list(\s|$)/,
  /^npx\s+/, /^node\s+/, /^node$/,

  // Git read operations
  /^git\s+status(\s|$)/, /^git\s+log(\s|$)/, /^git\s+diff(\s|$)/,
  /^git\s+branch(\s|$)/, /^git\s+show(\s|$)/, /^git\s+remote(\s|$)/,
  /^git\s+config\s+--list(\s|$)/, /^git\s+stash\s+list(\s|$)/,

  // TypeScript/compilation
  /^tsc(\s|$)/, /^npx\s+tsc(\s|$)/, /^npx\s+tsc$/, /^npx\s+eslint\s+/,
  /^npx\s+prettier\s+--check/, /^npx\s+vite(\s|$)/,
];

// Commands that are dangerous (require approval)
const UNSAFE_COMMAND_PATTERNS: RegExp[] = [
  /^rm(\s|$)/, /^rmdir(\s|$)/, /^mv\s+/, /^sudo(\s|$)/,
  /^curl(\s|$)/, /^wget(\s|$)/, /^chmod(\s|$)/, /^chown(\s|$)/,
  /^kill(\s|$)/, /^killall(\s|$)/, /^docker(\s|$)/, /^ssh(\s|$)/,
  /^scp(\s|$)/, /^rsync(\s|$)/, /^dd(\s|$)/, /^mkfs(\s|$)/,
  /^fdisk(\s|$)/, /^mount(\s|$)/, /^umount(\s|$)/,
  /^npm\s+publish(\s|$)/, /^npm\s+unpublish(\s|$)/, /^npm\s+deprecate(\s|$)/,
  /^git\s+push(\s|$)/, /^git\s+reset\s+--hard(\s|$)/, /^git\s+clean\s+-f(\s|$)/,
  /^>\s*[^>]/, /^>>/, /\|\s*sh/, /\|\s*bash/, /;\s*rm/, /&&\s*rm/,
];

export interface CommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  duration: number;
}

export type CommandSafety = 'safe' | 'unsafe' | 'blocked';

/**
 * Classify a command as safe, unsafe, or blocked
 */
export function classifyCommand(command: string): CommandSafety {
  const trimmed = command.trim();

  // Block empty commands
  if (!trimmed) return 'blocked';

  // Block commands with dangerous shell metacharacters
  if (/;\s*(rm|rmdir|mkfs|dd|format)\b/.test(trimmed)) return 'blocked';
  if (/\|\s*(sh|bash|zsh|csh)\b/.test(trimmed)) return 'blocked';
  if (/`[^`]*`/.test(trimmed)) return 'blocked'; // Backtick execution
  if (/\$\([^)]*\)/.test(trimmed)) return 'blocked'; // Command substitution

  // Check unsafe patterns first (more specific)
  for (const pattern of UNSAFE_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) return 'unsafe';
  }

  // Check safe patterns
  for (const pattern of SAFE_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) return 'safe';
  }

  // Default: unknown commands are unsafe (conservative)
  return 'unsafe';
}

/**
 * Execute a command safely with timeout
 */
export async function executeCommand(
  command: string,
  cwd?: string,
  timeoutMs: number = 60000
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd || process.cwd(),
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 10, // 10MB max output
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    return {
      success: true,
      exitCode: 0,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      command,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      exitCode: error.code || 1,
      stdout: (error.stdout || '').toString(),
      stderr: (error.stderr || error.message || '').toString(),
      command,
      duration: Date.now() - startTime,
    };
  }
}
