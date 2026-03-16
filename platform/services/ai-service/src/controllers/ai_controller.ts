import { FastifyRequest, FastifyReply } from 'fastify';
import { aiAgentsClient, AIRequest } from '../clients/ai_agents_client.js';
import { circuitBreaker } from '../middleware/circuit_breaker.js';
import { maskSecrets, rehydrateSecrets } from '../middleware/data_masking.js';
import { emitBillingEvent } from '../kafka/billing.js';
import { prisma } from '@workspace/database';

interface ExecuteBody {
  projectId: string;
  prompt: string;
  context?: {
    files?: string[];
    schema?: Record<string, unknown>;
  };
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

  const aiRequest: AIRequest = {
    projectId,
    userId,
    prompt: maskedPrompt,
    context,
  };

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const startTime = Date.now();
    let tokenCount = 0;

    for await (const chunk of circuitBreaker.executeGenerator(() => aiAgentsClient.streamTask(aiRequest))) {
      const rehydratedChunk = rehydrateSecrets(chunk);
      
      reply.raw.write(`data: ${JSON.stringify({ id: taskId, data: rehydratedChunk })}\n\n`);
      
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

    reply.raw.write(`data: ${JSON.stringify({ id: taskId, status: 'completed' })}\n\n`);
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

    reply.raw.write(`data: ${JSON.stringify({ id: taskId, status: 'failed', error: error.message })}\n\n`);
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
