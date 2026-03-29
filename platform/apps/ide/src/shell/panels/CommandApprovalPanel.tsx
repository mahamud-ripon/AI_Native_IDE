/**
 * CommandApprovalPanel - Shows pending command approvals from AI agent
 *
 * Executes commands in WebContainer (not on server).
 * Safe commands auto-execute, unsafe commands require approval.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useExecutionStore,
  type CommandApproval,
} from '../../state/executionStore';
import { ensureContainer } from '../../core/runtime/webcontainerManager';
import { apiConfig } from '../../lib/apiConfig';
import styles from './CommandApprovalPanel.module.css';

interface CommandApprovalPanelProps {
  onCommandExecuted?: (commandId: string, output: string) => void;
}

export function CommandApprovalPanel({ onCommandExecuted }: CommandApprovalPanelProps) {
  const [executing, setExecuting] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoExecutedRef = useRef<Set<string>>(new Set());

  const pendingApprovals = useExecutionStore((s) => s.getPendingCommandApprovals());
  const addCommandApproval = useExecutionStore((s) => s.addCommandApproval);
  const approveCommand = useExecutionStore((s) => s.approveCommand);
  const denyCommand = useExecutionStore((s) => s.denyCommand);
  const removeCommandApproval = useExecutionStore((s) => s.removeCommandApproval);

  // Execute a command in WebContainer
  const executeInWebContainer = useCallback(
    async (command: string): Promise<{ output: string; success: boolean }> => {
      try {
        const container = await ensureContainer();
        const parts = command.trim().split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);

        const process = await container.spawn(cmd, args, {
          cwd: '/project',
          output: true,
        });

        let output = '';
        const reader = process.output.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            output += value;
          }
        } finally {
          reader.releaseLock();
        }

        const exitCode = await process.exit;

        // Truncate if too long
        if (output.length > 15000) {
          output = output.substring(0, 15000) + '\n... (output truncated)';
        }

        return {
          output: output.trim() || `Command completed (exit code: ${exitCode})`,
          success: exitCode === 0,
        };
      } catch (err) {
        return {
          output: `Error: ${err instanceof Error ? err.message : 'Command execution failed'}`,
          success: false,
        };
      }
    },
    []
  );

  // Send result back to ai-service
  const sendResultToBackend = useCallback(
    async (commandId: string, output: string, success: boolean) => {
      try {
        const token =
          localStorage.getItem('access_token') || localStorage.getItem('auth_token');
        await fetch(`${apiConfig.baseUrl}/api/v1/ai/commands/result`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            commandId,
            output,
            success,
            exitCode: success ? 0 : 1,
          }),
        });
      } catch {
        // Silent fail
      }
    },
    []
  );

  // Poll for pending approvals from ai-service
  useEffect(() => {
    console.log('[CommandApprovalPanel] Polling started');
    
    const fetchPendingApprovals = async () => {
      try {
        const token =
          localStorage.getItem('access_token') || localStorage.getItem('auth_token');
        if (!token) {
          console.warn('[CommandApprovalPanel] No auth token found for polling');
          return;
        }

        const url = `${apiConfig.baseUrl}/api/v1/ai/commands/pending`;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          console.warn(`[CommandApprovalPanel] Poll failed with status: ${response.status}`);
          return;
        }

        const result = await response.json();
        if (result.success && result.data?.approvals) {
          for (const approval of result.data.approvals) {
            const existing = useExecutionStore
              .getState()
              .commandApprovals.get(approval.id);
            
            if (!existing) {
              console.log(`[CommandApprovalPanel] Received new command approval:`, approval);
              
              // Determine risk level from classification
              const riskLevel =
                approval.classification === 'safe'
                  ? 'safe'
                  : approval.classification === 'unsafe'
                  ? 'moderate'
                  : 'dangerous';

              addCommandApproval({
                id: approval.id,
                taskId: '',
                command: approval.command,
                agentName: 'AI Agent',
                riskLevel,
                status: 'pending',
                createdAt: approval.createdAt || Date.now(),
              });

              // Auto-execute safe commands
              if (
                approval.classification === 'safe' &&
                approval.status === 'pending_execution' &&
                !autoExecutedRef.current.has(approval.id)
              ) {
                console.log(`[CommandApprovalPanel] Auto-executing safe command: ${approval.command}`);
                autoExecutedRef.current.add(approval.id);
                // Execute immediately
                handleAutoExecute(approval.id, approval.command);
              }
            }
          }
        }
      } catch (err) {
        console.error('[CommandApprovalPanel] Polling error:', err);
      }
    };

    const handleAutoExecute = async (commandId: string, command: string) => {
      setExecuting(commandId);
      const result = await executeInWebContainer(command);
      console.log(`[CommandApprovalPanel] Auto-executed result:`, result);
      approveCommand(commandId);
      await sendResultToBackend(commandId, result.output, result.success);
      onCommandExecuted?.(commandId, result.output);
      setExecuting(null);
      // Auto-dismiss after a short delay
      setTimeout(() => removeCommandApproval(commandId), 3000);
    };

    // Poll every 2 seconds
    fetchPendingApprovals();
    pollingRef.current = setInterval(fetchPendingApprovals, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [addCommandApproval, approveCommand, executeInWebContainer, sendResultToBackend, onCommandExecuted, removeCommandApproval]);

  const handleApprove = useCallback(
    async (approval: CommandApproval) => {
      setExecuting(approval.id);
      try {
        // Execute in WebContainer
        const result = await executeInWebContainer(approval.command);
        approveCommand(approval.id);
        await sendResultToBackend(approval.id, result.output, result.success);
        onCommandExecuted?.(approval.id, result.output);
      } catch (err) {
        approveCommand(approval.id);
        const errorMsg = `Error: ${err instanceof Error ? err.message : 'Failed to execute command'}`;
        await sendResultToBackend(approval.id, errorMsg, false);
        onCommandExecuted?.(approval.id, errorMsg);
      } finally {
        setExecuting(null);
      }
    },
    [approveCommand, executeInWebContainer, sendResultToBackend, onCommandExecuted]
  );

  const handleDeny = useCallback(
    async (approval: CommandApproval) => {
      try {
        const token =
          localStorage.getItem('access_token') || localStorage.getItem('auth_token');
        await fetch(`${apiConfig.baseUrl}/api/v1/ai/commands/deny`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ commandId: approval.id }),
        });
      } catch {
        // Silent fail
      }
      denyCommand(approval.id);
      onCommandExecuted?.(approval.id, 'Command denied by user.');
    },
    [denyCommand, onCommandExecuted]
  );

  const handleDismiss = useCallback(
    (commandId: string) => {
      removeCommandApproval(commandId);
    },
    [removeCommandApproval]
  );

  // Filter to only show unsafe commands that need manual approval
  const needsApproval = pendingApprovals.filter((a) => a.riskLevel !== 'safe');

  if (needsApproval.length === 0) return null;

  return (
    <div className={styles.container}>
      {needsApproval.map((approval) => (
        <div key={approval.id} className={styles.approvalCard}>
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <span className={styles.icon}>
                {approval.riskLevel === 'dangerous' ? '⚠️' : '🔧'}
              </span>
              <span className={styles.title}>Command Approval Required</span>
            </div>
            <span
              className={`${styles.riskBadge} ${
                styles[`risk_${approval.riskLevel}`]
              }`}
            >
              {approval.riskLevel}
            </span>
          </div>

          <div className={styles.commandBox}>
            <code className={styles.command}>{approval.command}</code>
          </div>

          <div className={styles.meta}>
            <span className={styles.agentName}>
              Requested by: {approval.agentName || 'AI Agent'}
            </span>
          </div>

          <div className={styles.actions}>
            <button
              className={styles.denyBtn}
              onClick={() => handleDeny(approval)}
              disabled={executing === approval.id}
            >
              Deny
            </button>
            <button
              className={styles.approveBtn}
              onClick={() => handleApprove(approval)}
              disabled={executing === approval.id}
            >
              {executing === approval.id ? 'Executing...' : 'Approve & Run'}
            </button>
          </div>

          <button
            className={styles.dismissBtn}
            onClick={() => handleDismiss(approval.id)}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export default CommandApprovalPanel;
