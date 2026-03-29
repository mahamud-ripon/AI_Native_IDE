export const MIN_WORKFLOW_TIMEOUT_MS = 120000;

/**
 * Keep workflow tasks alive long enough for slower frontier models to return
 * their first long generation without getting cancelled by aggressive client
 * defaults.
 */
export function normalizeWorkflowTimeout(timeoutMs?: number): number {
  return Math.max(timeoutMs ?? MIN_WORKFLOW_TIMEOUT_MS, MIN_WORKFLOW_TIMEOUT_MS);
}
