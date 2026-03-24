/**
 * Status Bar Component
 *
 * Bottom status bar showing execution status, git info, cursor position,
 * and other IDE status indicators.
 */

import * as React from 'react';
import {
  GitBranch,
  GitCommit,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Zap,
  Wifi,
  WifiOff,
  Type,
  Layout,
  Bell,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { SimpleTooltip } from '../ui/Tooltip';
import { Button } from '../ui/Button';

// ========================================
// TYPES
// ========================================

interface StatusBarProps {
  className?: string;
}

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
type ExecutionStatus = 'idle' | 'running' | 'completed' | 'error';

// ========================================
// COMPONENTS
// ========================================

/**
 * Status indicator with icon and label
 */
function StatusItem({
  icon: Icon,
  label,
  status,
  className,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  status?: 'default' | 'success' | 'warning' | 'error' | 'active';
  className?: string;
  onClick?: () => void;
}) {
  const statusColors = {
    default: 'text-[var(--text-muted)]',
    success: 'text-[var(--accent-success)]',
    warning: 'text-[var(--accent-warning)]',
    error: 'text-[var(--accent-error)]',
    active: 'text-[var(--accent-primary)]',
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 text-xs transition-colors hover:bg-[var(--bg-elevated)] rounded',
        statusColors[status || 'default'],
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/**
 * Connection status indicator
 */
function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const config = {
    connected: { icon: Wifi, color: 'text-[var(--accent-success)]', label: 'Connected' },
    connecting: { icon: Loader2, color: 'text-[var(--accent-warning)]', label: 'Connecting...' },
    disconnected: { icon: WifiOff, color: 'text-[var(--accent-error)]', label: 'Disconnected' },
  };

  const { icon: Icon, color, label } = config[status];

  return (
    <div className={cn('flex items-center gap-1.5', color)}>
      <Icon className={cn('h-3.5 w-3.5', status === 'connecting' && 'animate-spin')} />
      <span className="hidden md:inline text-xs">{label}</span>
    </div>
  );
}

/**
 * Execution status indicator
 */
function ExecutionIndicator({ status }: { status: ExecutionStatus }) {
  const config = {
    idle: { icon: Zap, color: 'text-[var(--text-muted)]', label: 'Ready' },
    running: { icon: Loader2, color: 'text-[var(--accent-primary)]', label: 'Processing...' },
    completed: { icon: CheckCircle2, color: 'text-[var(--accent-success)]', label: 'Done' },
    error: { icon: AlertCircle, color: 'text-[var(--accent-error)]', label: 'Error' },
  };

  const { icon: Icon, color, label } = config[status];

  return (
    <div className={cn('flex items-center gap-1.5', color)}>
      <Icon className={cn('h-3.5 w-3.5', status === 'running' && 'animate-spin')} />
      <span className="text-xs">{label}</span>
    </div>
  );
}

/**
 * Main status bar component
 */
export function StatusBar({ className }: StatusBarProps) {
  const [connectionStatus] = React.useState<ConnectionStatus>('connected');
  const [executionStatus] = React.useState<ExecutionStatus>('idle');
  const [cursorPosition] = React.useState({ line: 1, column: 1 });
  const [encoding] = React.useState('UTF-8');
  const [language] = React.useState('TypeScript');

  return (
    <footer
      className={cn(
        'flex h-6 items-center justify-between border-t border-[var(--border-muted)] bg-[var(--bg-secondary)] px-2 text-xs',
        className
      )}
    >
      {/* Left section */}
      <div className="flex items-center gap-1">
        {/* Execution status */}
        <SimpleTooltip content="AI Execution Status">
          <div className="flex items-center">
            <ExecutionIndicator status={executionStatus} />
          </div>
        </SimpleTooltip>

        <div className="h-3 w-px bg-[var(--border-muted)] mx-1" />

        {/* Connection status */}
        <ConnectionIndicator status={connectionStatus} />

        <div className="h-3 w-px bg-[var(--border-muted)] mx-1" />

        {/* Git branch */}
        <SimpleTooltip content="Git Branch: main">
          <StatusItem
            icon={GitBranch}
            label="main"
            status="default"
          />
        </SimpleTooltip>

        {/* Git sync status */}
        <SimpleTooltip content="Synchronized">
          <div className="flex items-center text-[var(--accent-success)]">
            <CheckCircle2 className="h-3 w-3" />
          </div>
        </SimpleTooltip>
      </div>

      {/* Center section - Notifications */}
      <div className="hidden md:flex items-center">
        <SimpleTooltip content="No notifications">
          <button className="flex items-center gap-1 px-2 py-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
            <Bell className="h-3 w-3" />
            <span>0</span>
          </button>
        </SimpleTooltip>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-1">
        {/* Line/Column position */}
        <SimpleTooltip content="Cursor Position">
          <div className="flex items-center gap-1.5 px-2 text-[var(--text-muted)]">
            <span>Ln {cursorPosition.line}</span>
            <span>Col {cursorPosition.column}</span>
          </div>
        </SimpleTooltip>

        <div className="h-3 w-px bg-[var(--border-muted)] mx-1" />

        {/* Encoding */}
        <SimpleTooltip content="File Encoding">
          <span className="px-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer">
            {encoding}
          </span>
        </SimpleTooltip>

        <div className="h-3 w-px bg-[var(--border-muted)] mx-1" />

        {/* Language mode */}
        <SimpleTooltip content="Language Mode">
          <span className="px-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer">
            {language}
          </span>
        </SimpleTooltip>

        <div className="h-3 w-px bg-[var(--border-muted)] mx-1" />

        {/* Layout toggle */}
        <SimpleTooltip content="Toggle Panel">
          <button className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
            <Layout className="h-3.5 w-3.5" />
          </button>
        </SimpleTooltip>
      </div>
    </footer>
  );
}

export default StatusBar;
