/**
 * Step Executor
 *
 * Handles individual step execution including:
 * - Agent invocation via Python AI Agents (LangGraph)
 * - LLM Gateway fallback
 * - Patch parsing and application
 * - Retry logic
 * - Metrics collection
 * - Timeout handling
 */

import { prisma } from '@workspace/database';
import { StepRunStatus } from '@workspace/database';
import type { WorkflowStep, WorkflowDefinition, WorkflowState, ExecuteStepResult } from '../types.js';
import { getLLMGateway } from '../../llm/gateway.js';
import { emitStepStarted, emitStepCompleted, emitStepFailed } from '../events/workflow_events.js';
import { callPythonAgent, checkPythonAgentsHealth } from '../../python_agents/client.js';
import { parseLLMOutput, validatePatch, formatPatchesForFrontend } from '../utils/patch_parser.js';

// Use shared prisma instance
// prisma is imported from @workspace/database

// Configuration
const USE_PYTHON_AGENTS = process.env.USE_PYTHON_AGENTS !== 'false'; // Default: true

export interface ExecuteStepInput {
  workflowRunId: string;
  stepIndex: number;
  stepDef: WorkflowStep;
  state: WorkflowState;
  definition: WorkflowDefinition;
}

/**
 * Execute a single workflow step
 */
export async function executeStep(input: ExecuteStepInput): Promise<ExecuteStepResult> {
  const { workflowRunId, stepIndex, stepDef, state, definition } = input;
  
  const maxRetries = stepDef.retryPolicy?.maxRetries ?? definition.defaultRetryPolicy?.maxRetries ?? 3;
  const timeoutMs = stepDef.timeoutMs ?? 300000; // 5 min default

  // Create or get existing step run
  let stepRun = await prisma.stepRun.findUnique({
    where: {
      workflowRunId_stepIndex: { workflowRunId, stepIndex },
    },
  });

  if (!stepRun) {
    stepRun = await prisma.stepRun.create({
      data: {
        workflowRunId,
        stepIndex,
        stepName: stepDef.stepName,
        agentName: stepDef.agentName,
        status: StepRunStatus.pending,
        maxRetries,
        inputJson: JSON.parse(JSON.stringify(mapInput(state, stepDef.inputMapping))),
      },
    });
  }

  // Check if already completed (idempotency)
  if (stepRun.status === StepRunStatus.completed) {
    return {
      stepRunId: stepRun.id,
      status: 'completed',
      output: stepRun.outputJson,
    };
  }

  // Check retry limit
  if (stepRun.retryCount >= maxRetries) {
    await prisma.stepRun.update({
      where: { id: stepRun.id },
      data: {
        status: StepRunStatus.failed,
        errorMessage: `Max retries (${maxRetries}) exceeded`,
      },
    });

    return {
      stepRunId: stepRun.id,
      status: 'failed',
      error: `Max retries (${maxRetries}) exceeded`,
    };
  }

  // Emit step started event
  await emitStepStarted({
    workflowRunId,
    stepRunId: stepRun.id,
    stepIndex,
    stepName: stepDef.stepName,
    agentName: stepDef.agentName,
  });

  // Update to running
  stepRun = await prisma.stepRun.update({
    where: { id: stepRun.id },
    data: {
      status: StepRunStatus.running,
      startedAt: new Date(),
      attemptNumber: { increment: 1 },
    },
  });

  console.log(`[StepExecutor] Executing step ${stepIndex}: ${stepDef.stepName} (Agent: ${stepDef.agentName})`);

  // Try Python AI Agents first (if enabled)
  if (USE_PYTHON_AGENTS) {
    try {
      console.log(`[StepExecutor] Calling Python AI Agents for step: ${stepDef.stepName}`);
      
      // Check if Python Agents service is healthy
      const isHealthy = await checkPythonAgentsHealth();
      
      if (isHealthy) {
        // Call Python AI Agents
        const pythonResult = await callPythonAgent({
          user_prompt: state.context.variables.userPrompt as string || state.context.variables.instruction as string || 'Execute workflow step',
          project_id: state.context.projectId,
          stream: false,
        });

        console.log(`[StepExecutor] Python AI Agents response:`, pythonResult);

        if (pythonResult.status === 'completed' && pythonResult.result) {
          // Calculate duration
          const durationMs = Date.now() - (stepRun.startedAt?.getTime() ?? Date.now());

          // Update step run with success
          await prisma.stepRun.update({
            where: { id: stepRun.id },
            data: {
              status: StepRunStatus.completed,
              completedAt: new Date(),
              durationMs,
              outputJson: pythonResult.result,
              tokensIn: pythonResult.cost_summary?.input_tokens || 0,
              tokensOut: pythonResult.cost_summary?.output_tokens || 0,
              costUsd: pythonResult.cost_summary?.total_cost_usd || 0,
              provider: 'python-agents',
              model: 'langgraph',
              requestId: pythonResult.workflow_id,
            },
          });

          // Emit step completed event
          await emitStepCompleted({
            workflowRunId,
            stepRunId: stepRun.id,
            stepIndex,
            stepName: stepDef.stepName,
            agentName: stepDef.agentName,
            tokensIn: pythonResult.cost_summary?.input_tokens || 0,
            tokensOut: pythonResult.cost_summary?.output_tokens || 0,
            costUsd: pythonResult.cost_summary?.total_cost_usd || 0,
            durationMs,
          });

          console.log(`[StepExecutor] Step ${stepIndex} completed successfully via Python AI Agents`);

          return {
            stepRunId: stepRun.id,
            status: 'completed',
            output: pythonResult.result,
            metrics: {
              tokensIn: pythonResult.cost_summary?.input_tokens || 0,
              tokensOut: pythonResult.cost_summary?.output_tokens || 0,
              costUsd: pythonResult.cost_summary?.total_cost_usd || 0,
              latencyMs: durationMs,
              provider: 'python-agents',
              model: 'langgraph',
            },
          };
        } else if (pythonResult.status === 'failed') {
          throw new Error(`Python AI Agents failed: ${pythonResult.errors?.join(', ') || 'Unknown error'}`);
        }
      } else {
        console.warn('[StepExecutor] Python AI Agents not healthy, falling back to LLM Gateway');
      }
    } catch (pythonError) {
      console.error('[StepExecutor] Python AI Agents error, falling back to LLM Gateway:', pythonError);
      // Continue to LLM Gateway fallback
    }
  }

  try {
    // Get agent memory
    const agentMemory = state.agentMemory[stepDef.agentName] ?? {
      messages: [],
      variables: {},
    };

    // Build messages for LLM
    const messages = [
      ...agentMemory.messages,
      { role: 'user' as const, content: buildPrompt(state, stepDef) },
    ];

    // Call LLM Gateway (fallback)
    const gateway = await getLLMGateway();
    const response = await gateway.complete({
      workflowId: workflowRunId,
      projectId: state.context.projectId,
      agentName: stepDef.agentName,
      stepName: stepDef.stepName,
      taskType: stepDef.taskType,
      messages,
      modelHint: stepDef.modelHint,
      maxTokens: 4096,
      temperature: 0.7,
    });

    console.log(`[StepExecutor] LLM response received, parsing patches...`);
    
    // Parse LLM output to extract patches
    const patches = parseLLMOutput(response.outputText);
    const validPatches = patches.filter(validatePatch);
    
    console.log(`[StepExecutor] Extracted ${patches.length} patches, ${validPatches.length} valid`);
    
    // Calculate duration
    const durationMs = Date.now() - (stepRun.startedAt?.getTime() ?? Date.now());

    // Update step run with success
    await prisma.stepRun.update({
      where: { id: stepRun.id },
      data: {
        status: StepRunStatus.completed,
        completedAt: new Date(),
        durationMs,
        outputJson: { 
          output: response.outputText,
          patches: formatPatchesForFrontend(validPatches),
          patchCount: validPatches.length,
        },
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
        costUsd: response.costUsd,
        provider: response.provider,
        model: response.model,
        requestId: response.requestId,
      },
    });

    // Emit step completed event
    await emitStepCompleted({
      workflowRunId,
      stepRunId: stepRun.id,
      stepIndex,
      stepName: stepDef.stepName,
      agentName: stepDef.agentName,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      costUsd: response.costUsd,
      durationMs,
    });

    console.log(`[StepExecutor] Step ${stepIndex} completed with ${validPatches.length} patches`);

    return {
      stepRunId: stepRun.id,
      status: 'completed',
      output: { 
        output: response.outputText,
        patches: formatPatchesForFrontend(validPatches),
      },
      metrics: {
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
        costUsd: response.costUsd,
        latencyMs: response.latencyMs,
        provider: response.provider,
        model: response.model,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Update step run with failure
    await prisma.stepRun.update({
      where: { id: stepRun.id },
      data: {
        status: StepRunStatus.failed,
        errorMessage,
        errorStack,
        retryCount: { increment: 1 },
      },
    });

    // Emit step failed event
    await emitStepFailed({
      workflowRunId,
      stepRunId: stepRun.id,
      stepIndex,
      stepName: stepDef.stepName,
      agentName: stepDef.agentName,
      errorMessage,
    });

    return {
      stepRunId: stepRun.id,
      status: 'failed',
      error: errorMessage,
    };
  }
}

/**
 * Map input from state using input mapping
 */
function mapInput(
  state: WorkflowState, 
  mapping?: Record<string, string>
): Record<string, unknown> {
  if (!mapping) {
    return { context: state.context.variables };
  }

  const input: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(mapping)) {
    input[key] = getValueByPath(state, path);
  }
  return input;
}

/**
 * Build prompt for agent
 */
function buildPrompt(state: WorkflowState, stepDef: WorkflowStep): string {
  const contextVars = Object.entries(state.context.variables)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');

  return `Execute step "${stepDef.stepName}" as ${stepDef.agentName}.

Context variables:
${contextVars || '(none)'}

Task type: ${stepDef.taskType}

Please complete this step and provide your output.`;
}

/**
 * Get value from state by dot-notation path
 */
function getValueByPath(state: WorkflowState, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = state;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}
