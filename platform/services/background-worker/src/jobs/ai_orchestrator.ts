import { prisma } from '@workspace/database';
import { redisClient } from '../lib/redis.js';

const logger = {
  info: (msg: string) => console.log(`[AI Orchestrator] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[AI Orchestrator] ${msg}`, err),
};

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8003';

interface OrchestrateTask {
  conversationId: string;
  userId: string;
  projectId: string;
  prompt: string;
  model?: string;
  context?: any;
}

export async function orchestrateAIGeneration(data: OrchestrateTask): Promise<void> {
  const { conversationId, userId, projectId, prompt, model, context } = data;

  logger.info(`Starting AI orchestration for conversation ${conversationId}`);

  try {
    // Record task start in Redis for idempotency
    const taskKey = `ai:task:${conversationId}`;
    const existing = await redisClient.get(taskKey);

    if (existing) {
      logger.info(`Task ${conversationId} already processed, skipping`);
      return;
    }

    // Mark task as in-progress
    await redisClient.setex(taskKey, 3600, JSON.stringify({ status: 'processing', startedAt: Date.now() }));

    // Call AI service for orchestration
    const response = await fetch(`${AI_SERVICE_URL}/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': process.env.INTERNAL_API_KEY || '',
      },
      body: JSON.stringify({
        conversationId,
        userId,
        projectId,
        prompt,
        model: model || 'claude-3-sonnet',
        context,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service returned ${response.status}`);
    }

    const result = await response.json() as { taskId: string; status: string };

    // Update task status
    await redisClient.setex(taskKey, 3600, JSON.stringify({
      status: 'completed',
      completedAt: Date.now(),
      result: result.taskId,
    }));

    logger.info(`AI orchestration completed for conversation ${conversationId}`);

  } catch (error: any) {
    logger.error(`AI orchestration failed for ${conversationId}:`, error.message);

    // Update task status to failed
    await redisClient.setex(`ai:task:${conversationId}`, 3600, JSON.stringify({
      status: 'failed',
      failedAt: Date.now(),
      error: error.message,
    }));

    throw error;
  }
}

export async function handleFallbackProvider(data: {
  taskId: string;
  conversationId: string;
  failedProvider: string;
  error: string;
}): Promise<void> {
  const { taskId, conversationId, failedProvider } = data;

  logger.info(`Switching to fallback provider for task ${taskId}`);

  const fallbackOrder = ['claude-3-sonnet', 'gpt-4o', 'gemini-1.5-flash'];
  const currentIndex = fallbackOrder.indexOf(failedProvider);
  const fallbackProvider = fallbackOrder[currentIndex + 1] || 'gemini-1.5-flash';

  try {
    // Re-queue with fallback provider
    const response = await fetch(`${AI_SERVICE_URL}/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': process.env.INTERNAL_API_KEY || '',
      },
      body: JSON.stringify({
        conversationId,
        taskId,
        model: fallbackProvider,
        isFallback: true,
        originalProvider: failedProvider,
      }),
    });

    if (!response.ok) {
      throw new Error(`Fallback failed with status ${response.status}`);
    }

    logger.info(`Fallback to ${fallbackProvider} succeeded for task ${taskId}`);

  } catch (error: any) {
    logger.error(`Fallback failed for task ${taskId}:`, error.message);
    throw error;
  }
}
