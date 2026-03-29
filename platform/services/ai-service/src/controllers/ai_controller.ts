import { FastifyRequest, FastifyReply } from 'fastify';
import { aiAgentsClient, AIRequest } from '../clients/ai_agents_client.js';
import { circuitBreaker } from '../middleware/circuit_breaker.js';
import { maskSecrets, rehydrateSecrets } from '../middleware/data_masking.js';
import { emitBillingEvent } from '../kafka/billing.js';
import { prisma } from '@workspace/database';
import { getLLMGateway } from '../llm/gateway.js';
import { config } from '../config.js';
import type { TaskComplexity, ToolIntent } from '../coding/agent/agent_types.js';

interface ExecuteBody {
  projectId: string;
  prompt: string;
  instruction?: string;
  mode?: 'direct' | 'plan_execute' | 'multi_agent';
  taskComplexity?: TaskComplexity;
  modelHint?: string;
  model?: string;
  toolIntent?: ToolIntent;
  context?: {
    files?: string[];
    schema?: Record<string, unknown>;
  };
  workspaceContext?: {
    fileTree?: string[];
    activeFile?: string | null;
    activeFileContent?: string | null;
    openTabs?: string[];
  };
}

type Intent = 'CHITCHAT' | 'WORKFLOW';

/**
 * Server-side intent classification using LLM Gateway (fast model).
 * Uses Groq Llama-3 for ~50ms classification.
 */
async function classifyIntent(prompt: string, modelHint?: string): Promise<Intent> {
  try {
    const gateway = await getLLMGateway();

    const response = await gateway.complete({
      workflowId: 'intent-classifier',
      projectId: 'system',
      agentName: 'classifier',
      stepName: 'classify',
      taskType: 'chat',
      modelHint: modelHint || undefined,
      messages: [
        {
          role: 'system',
          content: `Classify the user's message into exactly one category.

CHITCHAT: greetings, questions about the system, explanations, small talk, "hello", "how are you", "what can you do", "thanks", help requests, general questions
WORKFLOW: requests to create, build, generate, modify, fix, deploy, or run code, files, or projects

Reply with EXACTLY one word: CHITCHAT or WORKFLOW`,
        },
        { role: 'user', content: prompt },
      ],
      maxTokens: 10,
    });
    const result = response.outputText.trim().toUpperCase();
    return result.includes('WORKFLOW') ? 'WORKFLOW' : 'CHITCHAT';
  } catch {
    // If classification fails, default to WORKFLOW (safer — let ai-agents handle it)
    return 'WORKFLOW';
  }
}

/**
 * Stream a chat response directly from the LLM Gateway.
 */
async function streamChatResponse(
  prompt: string,
  taskId: string,
  userId: string,
  projectId: string,
  modelHint: string | undefined,
  reply: FastifyReply
): Promise<void> {
  const gateway = await getLLMGateway();
  const startTime = Date.now();
  let tokenCount = 0;

  for await (const chunk of gateway.stream({
    workflowId: taskId,
    projectId,
    agentName: 'chat',
    stepName: 'respond',
    taskType: 'chat',
    modelHint: modelHint || undefined,
    messages: [
      {
        role: 'system',
        content: `You are Bolt, a helpful AI coding assistant integrated into a cloud IDE.
You help users with coding questions, explanations, and building software.
Be concise, friendly, and helpful. Use markdown formatting for code blocks.
If the user asks you to build something complex, suggest they use the build pipeline.`,
      },
      { role: 'user', content: prompt },
    ],
    maxTokens: 2048,
    userId,
  })) {
    if (chunk.type === 'chunk') {
      reply.raw.write(`data: ${JSON.stringify({ id: taskId, type: 'chat', data: chunk.data.textDelta })}\n\n`);
      tokenCount += chunk.data.textDelta.split(/\s+/).length;
    }
    if (chunk.type === 'error') {
      reply.raw.write(`data: ${JSON.stringify({ id: taskId, type: 'chat', status: 'failed', error: chunk.data.message })}\n\n`);
      reply.raw.end();
      return;
    }
  }

  const duration = Date.now() - startTime;

  await emitBillingEvent({
    taskId,
    userId,
    projectId,
    tokenCount,
    duration,
    status: 'completed',
  });

  reply.raw.write(`data: ${JSON.stringify({ id: taskId, type: 'chat', status: 'completed' })}\n\n`);
  reply.raw.end();
}

export async function executeTask(
  request: FastifyRequest<{ Body: ExecuteBody }>,
  reply: FastifyReply
) {
  const userId = request.headers['x-user-id'] as string;
  
  if (!userId) {
    return reply.status(401).send({ error: 'Unauthorized: missing user ID' });
  }

  const { projectId, prompt, context, taskComplexity, toolIntent, workspaceContext } = request.body;
  const modelHint = request.body.modelHint || request.body.model;

  if (!projectId || !prompt) {
    return reply.status(400).send({ error: 'Missing required fields: projectId, prompt' });
  }

  const maskedPrompt = maskSecrets(prompt);
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Set up SSE stream
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Classify intent using fast LLM
  const intent = await classifyIntent(maskedPrompt, modelHint);

  // CHITCHAT → stream chat response directly from ai-service
  if (intent === 'CHITCHAT') {
    await streamChatResponse(maskedPrompt, taskId, userId, projectId, modelHint, reply);
    return;
  }

  // WORKFLOW → use local orchestrator with ModeRouter (NOT the Python ai-agents client)
  // This ensures Mode 1 (DirectAgent) is used for simple tasks like "delete a file"
  const { getTaskOrchestrator } = await import('../coding/execution/task_orchestrator.js');
  const { createRemoteWorkspace } = await import('../coding/workspace/index.js');
  const { getDiffEngine } = await import('../coding/patch/index.js');

  const orchestrator = getTaskOrchestrator();

  // Create remote workspace
  const workspace = createRemoteWorkspace({
    projectId,
    projectServiceUrl: config.projectServiceUrl,
    internalApiKey: config.internalApiKey,
    userId,
  });
  workspace.setDiffEngine(getDiffEngine());
  const workspaceId = `ws-${projectId}`;
  orchestrator.registerWorkspace(workspaceId, workspace as any);

  // Set up progress streaming
  orchestrator.setProgressCallback(async (event) => {
    reply.raw.write(`data: ${JSON.stringify({
      id: taskId,
      type: 'progress',
      data: {
        stage: event.stage,
        progress: event.progress,
        message: event.message,
        modeDecision: event.modeDecision,
        details: event.details,
      },
    })}\n\n`);
  });

  try {
    const startTime = Date.now();

    const result = await orchestrator.runTask({
      id: taskId,
      workspaceId,
      prompt: maskedPrompt,
      userId,
      modelHint,
      mode: request.body.mode as any,
      routing: {
        complexity: taskComplexity,
        toolIntent,
        contextFiles: context?.files,
      },
      metadata: {
        projectId,
        context,
      },
      workspaceContext,
      options: {
        timeoutMs: 120000,
        enableRollback: true,
        enableSandbox: false,
        streamProgress: true,
      },
      createdAt: new Date(),
    });

    const duration = Date.now() - startTime;

    await emitBillingEvent({
      taskId,
      userId,
      projectId,
      tokenCount: result.agentResult?.metrics?.llmCalls ?? 0,
      duration,
      status: result.success ? 'completed' : 'failed',
    });

    reply.raw.write(`data: ${JSON.stringify({
      id: taskId,
      type: 'workflow',
      status: result.success ? 'completed' : 'failed',
      modeUsed: result.modeUsed,
      modeDecision: result.modeDecision,
      filesChanged: result.agentResult?.filesChanged ?? [],
      summary: result.agentResult?.summary ?? result.error?.message,
    })}\n\n`);
    reply.raw.end();

  } catch (error: any) {
    await emitBillingEvent({
      taskId,
      userId,
      projectId,
      tokenCount: 0,
      duration: 0,
      status: 'failed',
      error: error.message,
    });

    reply.raw.write(`data: ${JSON.stringify({ id: taskId, type: 'workflow', status: 'failed', error: error.message })}\n\n`);
    reply.raw.end();
  }
}

export async function executeTaskSync(
  request: FastifyRequest<{ Body: ExecuteBody }>,
  reply: FastifyReply
) {
  const userId = request.headers['x-user-id'] as string;
  
  if (!userId) {
    return reply.status(401).send({ error: 'Unauthorized: missing user ID' });
  }

  const { projectId, prompt, context, taskComplexity, toolIntent, workspaceContext } = request.body;

  if (!projectId || !prompt) {
    return reply.status(400).send({ error: 'Missing required fields: projectId, prompt' });
  }

  const maskedPrompt = maskSecrets(prompt);
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const modelHint = request.body.modelHint || request.body.model;

  try {
    const { getTaskOrchestrator } = await import('../coding/execution/task_orchestrator.js');
    const { createRemoteWorkspace } = await import('../coding/workspace/index.js');
    const { getDiffEngine } = await import('../coding/patch/index.js');

    const orchestrator = getTaskOrchestrator();
    const workspace = createRemoteWorkspace({
      projectId,
      projectServiceUrl: config.projectServiceUrl,
      internalApiKey: config.internalApiKey,
      userId,
    });
    workspace.setDiffEngine(getDiffEngine());
    const workspaceId = `ws-${projectId}`;
    orchestrator.registerWorkspace(workspaceId, workspace as any);

    const result = await orchestrator.runTask({
      id: taskId,
      workspaceId,
      prompt: maskedPrompt,
      userId,
      modelHint,
      mode: request.body.mode as any,
      routing: {
        complexity: taskComplexity,
        toolIntent,
        contextFiles: context?.files,
      },
      metadata: {
        projectId,
        context,
      },
      workspaceContext,
      options: {
        timeoutMs: 120000,
        enableRollback: true,
        enableSandbox: false,
        streamProgress: false,
      },
      createdAt: new Date(),
    });

    return reply.send({
      id: taskId,
      status: result.success ? 'completed' : 'failed',
      modeUsed: result.modeUsed,
      modeDecision: result.modeDecision,
      filesChanged: result.agentResult?.filesChanged ?? [],
      summary: result.agentResult?.summary ?? result.error?.message,
    });

  } catch (error: any) {
    return reply.status(500).send({
      id: taskId,
      status: 'failed',
      error: error.message,
    });
  }
}

export async function getTaskStatus(
  request: FastifyRequest<{ Params: { taskId: string } }>,
  reply: FastifyReply
) {
  const { taskId } = request.params;

  const task = await prisma.auditLog.findFirst({
    where: {
      action: 'ai_task',
      metadata: { path: ['taskId'], equals: taskId },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!task) {
    return reply.status(404).send({ error: 'Task not found' });
  }

  const metadata = task.metadata as Record<string, unknown> | null;
  
  return reply.send({
    taskId,
    status: metadata?.['status'] || 'unknown',
    createdAt: task.createdAt,
  });
}
