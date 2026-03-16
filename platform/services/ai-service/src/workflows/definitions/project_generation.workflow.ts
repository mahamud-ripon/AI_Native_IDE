/**
 * Project Generation Workflow Definition
 * 
 * Example multi-agent workflow for generating code projects.
 */

import type { WorkflowDefinition } from '../types.js';

export const projectGenerationWorkflow: WorkflowDefinition = {
  name: 'project_generation',
  version: 1,
  description: 'Multi-agent workflow for generating code projects with planning, coding, testing, and fixing phases',
  
  steps: [
    {
      stepIndex: 0,
      stepName: 'plan',
      agentName: 'PlanAgent',
      taskType: 'plan',
      modelHint: 'claude-3-sonnet',
      retryPolicy: {
        maxRetries: 2,
        baseDelayMs: 1000,
      },
      timeoutMs: 120000, // 2 min
    },
    {
      stepIndex: 1,
      stepName: 'generate_code',
      agentName: 'CodeAgent',
      taskType: 'codegen',
      modelHint: 'claude-3-opus',
      retryPolicy: {
        maxRetries: 3,
        baseDelayMs: 2000,
      },
      timeoutMs: 300000, // 5 min
      inputMapping: {
        plan: 'context.plan',
        requirements: 'context.requirements',
      },
      outputMapping: {
        generatedFiles: 'context.generatedFiles',
      },
    },
    {
      stepIndex: 2,
      stepName: 'test',
      agentName: 'TestAgent',
      taskType: 'qa',
      modelHint: 'gpt-4',
      retryPolicy: {
        maxRetries: 2,
      },
      timeoutMs: 180000, // 3 min
      optional: true, // Tests may fail but workflow continues
    },
    {
      stepIndex: 3,
      stepName: 'fix_issues',
      agentName: 'FixAgent',
      taskType: 'codegen',
      modelHint: 'claude-3-sonnet',
      retryPolicy: {
        maxRetries: 3,
      },
      timeoutMs: 180000,
      condition: {
        path: 'progress.failedSteps',
        operator: 'exists',
      },
    },
  ],

  defaultRetryPolicy: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },

  maxDurationMs: 1800000, // 30 min
  checkpointBeforeStep: true,
  checkpointAfterStep: true,
};
