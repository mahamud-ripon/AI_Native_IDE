import { describe, expect, it } from 'vitest';

import {
  MIN_WORKFLOW_TIMEOUT_MS,
  normalizeWorkflowTimeout,
} from './execution_timeout_policy.js';

describe('normalizeWorkflowTimeout', () => {
  it('defaults to the workflow minimum when timeout is missing', () => {
    expect(normalizeWorkflowTimeout()).toBe(MIN_WORKFLOW_TIMEOUT_MS);
  });

  it('raises too-small timeouts up to the workflow minimum', () => {
    expect(normalizeWorkflowTimeout(20000)).toBe(MIN_WORKFLOW_TIMEOUT_MS);
  });

  it('preserves larger timeouts', () => {
    expect(normalizeWorkflowTimeout(180000)).toBe(180000);
  });
});
