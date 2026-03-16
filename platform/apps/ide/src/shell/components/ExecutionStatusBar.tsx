/**
 * Execution Status Bar
 *
 * Displays AI execution status at the bottom of the IDE.
 * Shows current task state, progress, and connection status.
 *
 * States:
 * - AI Idle (gray)
 * - AI Analyzing Workspace (blue)
 * - AI Generating Patch (yellow)
 * - AI Applying Patch (orange)
 * - AI Running Code (blue)
 * - Execution Failed (red)
 * - Execution Complete (green)
 *
 * Architecture:
 *   executionStore
 *        │
 *   ExecutionStatusBar
 */

import { useExecutionStore, selectExecutionStatus } from '../../state/executionStore';
import styles from './ExecutionStatusBar.module.css';

// ========================================
// TYPES
// ========================================

interface ExecutionStatusBarProps {
  className?: string;
}

// ========================================
// COMPONENT
// ========================================

export function ExecutionStatusBar({ className }: ExecutionStatusBarProps) {
  const executionStatus = useExecutionStore(selectExecutionStatus);
  const connectionStatus = useExecutionStore((s) => s.connectionStatus);
  const activeTask = useExecutionStore((s) => s.getActiveTask?.());
  const pendingPatches = useExecutionStore((s) => s.pendingPatches.length);

  // Get status icon and color
  const getStatusDisplay = () => {
    switch (executionStatus.status) {
      case 'idle':
        return {
          icon: '○',
          label: 'AI Idle',
          color: 'idle',
          tooltip: 'No active AI tasks',
        };
      case 'running':
        return {
          icon: '◉',
          label: executionStatus.message || 'AI Working...',
          color: 'running',
          tooltip: activeTask?.stage ?? 'Processing',
        };
      case 'completed':
        return {
          icon: '✓',
          label: 'Complete',
          color: 'completed',
          tooltip: 'Task completed successfully',
        };
      case 'failed':
        return {
          icon: '✗',
          label: 'Failed',
          color: 'failed',
          tooltip: activeTask?.error?.message ?? 'Task failed',
        };
      default:
        return {
          icon: '○',
          label: 'AI Idle',
          color: 'idle',
          tooltip: 'Unknown status',
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  // Get connection indicator
  const getConnectionDisplay = () => {
    switch (connectionStatus) {
      case 'connected':
        return { icon: '●', label: 'Connected', color: 'connected' };
      case 'connecting':
      case 'reconnecting':
        return { icon: '◐', label: 'Connecting...', color: 'connecting' };
      case 'disconnected':
        return { icon: '○', label: 'Disconnected', color: 'disconnected' };
      default:
        return { icon: '○', label: 'Unknown', color: 'unknown' };
    }
  };

  const connectionDisplay = getConnectionDisplay();

  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      {/* Left: AI Status */}
      <div className={styles.statusSection}>
        <span
          className={`${styles.statusIcon} ${styles[statusDisplay.color]}`}
          title={statusDisplay.tooltip}
        >
          {statusDisplay.icon}
        </span>
        <span className={`${styles.statusLabel} ${styles[statusDisplay.color]}`}>
          {statusDisplay.label}
        </span>

        {/* Progress bar for running tasks */}
        {executionStatus.status === 'running' && executionStatus.progress > 0 && (
          <div className={styles.progressContainer}>
            <div
              className={styles.progressBar}
              style={{ width: `${executionStatus.progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Center: Task info */}
      {activeTask && (
        <div className={styles.taskSection}>
          <span className={styles.taskInfo}>
            {activeTask.filesModified.length > 0 && (
              <span className={styles.fileCount}>
                📁 {activeTask.filesModified.length}
              </span>
            )}
            {pendingPatches > 0 && (
              <span className={styles.patchCount}>
                🔧 {pendingPatches}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Right: Connection status */}
      <div className={styles.connectionSection}>
        <span
          className={`${styles.connectionIcon} ${styles[connectionDisplay.color]}`}
          title={connectionDisplay.label}
        >
          {connectionDisplay.icon}
        </span>
        <span className={styles.connectionLabel}>
          {connectionDisplay.label}
        </span>
      </div>
    </div>
  );
}

export default ExecutionStatusBar;
