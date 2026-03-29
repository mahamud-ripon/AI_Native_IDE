/**
 * Pending Approvals Store
 *
 * Stores command approval requests in memory.
 * IDE polls for pending approvals and executes them in WebContainer.
 */

interface PendingApproval {
  id: string;
  command: string;
  cwd: string;
  commandId: string;
  classification: 'safe' | 'unsafe' | 'blocked';
  createdAt: number;
  status: 'pending_execution' | 'pending_approval' | 'approved' | 'denied' | 'completed' | 'failed';
  result?: string;
}

// In-memory store for pending approvals
const pendingApprovals = new Map<string, PendingApproval>();

// Auto-cleanup after 5 minutes
const CLEANUP_INTERVAL = 60_000; // 1 minute
const MAX_AGE = 5 * 60_000; // 5 minutes

setInterval(() => {
  const now = Date.now();
  for (const [id, approval] of pendingApprovals) {
    if (now - approval.createdAt > MAX_AGE) {
      pendingApprovals.delete(id);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Create a new pending approval
 */
export function createPendingApproval(
  command: string,
  cwd: string,
  commandId: string,
  classification: 'safe' | 'unsafe' | 'blocked' = 'unsafe'
): PendingApproval {
  const approval: PendingApproval = {
    id: commandId,
    command,
    cwd,
    commandId,
    classification,
    createdAt: Date.now(),
    status: classification === 'safe' ? 'pending_execution' : 'pending_approval',
  };
  pendingApprovals.set(commandId, approval);
  return approval;
}

/**
 * Get pending approvals (both pending_execution and pending_approval)
 */
export function getPendingApprovals(): PendingApproval[] {
  return Array.from(pendingApprovals.values()).filter(
    (a) => a.status === 'pending_execution' || a.status === 'pending_approval'
  );
}

/**
 * Get a specific pending approval
 */
export function getPendingApproval(commandId: string): PendingApproval | undefined {
  return pendingApprovals.get(commandId);
}

/**
 * Approve a command
 */
export function approveApproval(commandId: string): boolean {
  const approval = pendingApprovals.get(commandId);
  if (!approval || approval.status !== 'pending_approval') return false;
  approval.status = 'approved';
  return true;
}

/**
 * Deny a command
 */
export function denyApproval(commandId: string): boolean {
  const approval = pendingApprovals.get(commandId);
  if (!approval || (approval.status !== 'pending_approval' && approval.status !== 'pending_execution')) return false;
  approval.status = 'denied';
  return true;
}

/**
 * Mark command as completed with result
 */
export function completeApproval(commandId: string, result: string, success: boolean): boolean {
  const approval = pendingApprovals.get(commandId);
  if (!approval) return false;
  approval.status = success ? 'completed' : 'failed';
  approval.result = result;
  return true;
}

/**
 * Remove a completed approval
 */
export function removeApproval(commandId: string): void {
  pendingApprovals.delete(commandId);
}
