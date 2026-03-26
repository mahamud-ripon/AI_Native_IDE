import { FastifyRequest, FastifyReply } from 'fastify';
import { aiAgentsClient, AIRequest } from '../clients/ai_agents_client.js';
import { circuitBreaker } from '../middleware/circuit_breaker.js';
import { maskSecrets, rehydrateSecrets } from '../middleware/data_masking.js';
import { emitBillingEvent } from '../kafka/billing.js';
import { prisma } from '@workspace/database';
import { getLLMGateway } from '../llm/gateway.js';

interface ExecuteBody {
  projectId: string;
  prompt: string;
  context?: {
    files?: string[];
    schema?: Record<string, unknown>;
  };
}

type Intent = 'CHITCHAT' | 'WORKFLOW';

/**
 * Server-side intent classification using LLM Gateway (fast model).
 * Uses Groq Llama-3 for ~50ms classification.
 */
async function classifyIntent(prompt: string): Promise<Intent> {
  try {
    const gateway = await getLLMGateway();
    const response = await gateway.complete({
      workflowId: 'intent-classifier',
      projectId: 'system',
      agentName: 'classifier',
      stepName: 'classify',
      taskType: 'chat',
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

  const { projectId, prompt, context } = request.body;

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
  const intent = await classifyIntent(maskedPrompt);

  // CHITCHAT → stream chat response directly from ai-service
  if (intent === 'CHITCHAT') {
    await streamChatResponse(maskedPrompt, taskId, userId, projectId, reply);
    return;
  }

  // WORKFLOW → forward to ai-agents pipeline
  const aiRequest: AIRequest = {
    projectId,
    userId,
    prompt: maskedPrompt,
    context,
  };

  try {
    const startTime = Date.now();
    let tokenCount = 0;

    for await (const chunk of circuitBreaker.executeGenerator(() => aiAgentsClient.streamTask(aiRequest))) {
      const rehydratedChunk = rehydrateSecrets(chunk);
      
      reply.raw.write(`data: ${JSON.stringify({ id: taskId, type: 'workflow', data: rehydratedChunk })}\n\n`);
      
      tokenCount += chunk.split(/\s+/).length;
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

    reply.raw.write(`data: ${JSON.stringify({ id: taskId, type: 'workflow', status: 'completed' })}\n\n`);
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

  const { projectId, prompt, context } = request.body;

  if (!projectId || !prompt) {
    return reply.status(400).send({ error: 'Missing required fields: projectId, prompt' });
  }

  const maskedPrompt = maskSecrets(prompt);

  const aiRequest: AIRequest = {
    projectId,
    userId,
    prompt: maskedPrompt,
    context,
  };

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    const response = await circuitBreaker.execute(() => aiAgentsClient.executeTask(aiRequest));
    
    if (!response.ok) {
      const error = await response.text();
      return reply.status(response.status).send({ error: 'AI service error', details: error });
    }

    const data = await response.json();
    const rehydratedData = rehydrateSecrets(JSON.stringify(data));

    return reply.send({
      id: taskId,
      status: 'completed',
      data: JSON.parse(rehydratedData),
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
