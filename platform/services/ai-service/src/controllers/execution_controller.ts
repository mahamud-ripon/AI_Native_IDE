/**
 * Execution Controller
 * 
 * REST API endpoints for the Execution Control Plane (Phase-6A).
 * Provides task creation, status tracking, and event streaming.
 * 
 * Rate limiting:
 * - POST /ai/execution/tasks: 10 requests/minute/user
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ExecutionTaskPriority, ExecutionTaskStatus, ExecutionEventType } from '@prisma/client';
import Redis from 'ioredis';
import {
  getExecutionTaskService,
  CreateExecutionTaskRequest,
  ExecutionTaskOptions,
} from '../execution/index.js';
import { config } from '../config.js';

// Redis for rate limiting
const redis = new Redis(config.redisUrl);

// Rate limit configuration
const RATE_LIMIT_WINDOW_SECONDS = 60; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per window

/**
 * Check rate limit for user
 * Returns true if allowed, false if rate limited
 */
async function checkRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const key = `ratelimit:execution:${userId}`;
  
  // Get current count
  const current = await redis.get(key);
  const count = current ? parseInt(current, 10) : 0;
  
  // Get TTL for reset time
  const ttl = await redis.ttl(key);
  const resetIn = ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS;
  
  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetIn };
  }
  
  // Increment counter
  const newCount = await redis.incr(key);
  
  // Set expiry on first request
  if (newCount === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }
  
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - newCount,
    resetIn: await redis.ttl(key),
  };
}

// Request schemas
interface CreateTaskBody {
  projectId: string;
  workspaceId: string;
  instruction: string;
  conversationId?: string;
  branch?: string;
  priority?: ExecutionTaskPriority;
  agentName?: string;
  workflowRunId?: string;
  options?: ExecutionTaskOptions;
  // Execution metadata for observability
  metadata?: {
    agent?: string;
    workflowStage?: string;
    requestId?: string;
    parentTaskId?: string;
    clientInfo?: {
      type: 'ide' | 'api' | 'cli' | 'web';
      version?: string;
    };
    context?: Record<string, unknown>;
  };
}

interface GetTaskParams {
  taskId: string;
}

interface ListTasksQuery {
  status?: ExecutionTaskStatus;
  limit?: number;
  offset?: number;
}

interface GetEventsParams {
  taskId: string;
}

interface GetEventsQuery {
  limit?: number;
  offset?: number;
  /** Replay events since this sequence number (for reconnection) */
  sinceSequence?: number;
}

interface CancelTaskParams {
  taskId: string;
}

/**
 * Create execution task
 * POST /ai/execution/tasks
 * 
 * Rate limited: 10 requests/minute/user
 */
async function createTask(
  request: FastifyRequest<{ Body: CreateTaskBody }>,
  reply: FastifyReply
): Promise<void> {
  let userId = request.headers['x-user-id'] as string || ((request as any).user as { id: string } | undefined)?.id;

  if (!userId && request.headers.authorization) {
    try {
      const token = request.headers.authorization.split(' ')[1];
      if (token) {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        userId = payload.sub;
      }
    } catch (e) {
      // Ignore parsing errors, it will just remain unauthorized
    }
  }

  if (!userId) {
    reply.code(401).send({ error: 'Unauthorized: Missing user authentication context' });
    return;
  }

  // ========================================
  // RATE LIMITING: Check user quota
  // ========================================
  const rateLimit = await checkRateLimit(userId);
  
  // Set rate limit headers
  reply.header('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  reply.header('X-RateLimit-Remaining', rateLimit.remaining);
  reply.header('X-RateLimit-Reset', rateLimit.resetIn);
  
  if (!rateLimit.allowed) {
    reply.code(429).send({
      error: 'Rate limit exceeded',
      message: `Maximum ${RATE_LIMIT_MAX_REQUESTS} tasks per minute exceeded`,
      retryAfter: rateLimit.resetIn,
    });
    return;
  }

  const { projectId, workspaceId, instruction, conversationId, branch, priority, agentName, workflowRunId, options, metadata } = request.body;

  if (!projectId || !workspaceId || !instruction) {
    reply.code(400).send({ error: 'Missing required fields: projectId, workspaceId, instruction' });
    return;
  }

  const taskService = getExecutionTaskService();

  const createRequest: CreateExecutionTaskRequest = {
    projectId,
    workspaceId,
    instruction,
    userId,
    conversationId,
    branch,
    priority,
    agentName,
    workflowRunId,
    options,
    metadata,
  };

  // Create and enqueue task
  const task = await taskService.createAndEnqueue(createRequest);

  reply.code(201).send({
    taskId: task.id,
    status: task.status,
    message: 'Task created and enqueued',
  });
}

/**
 * Get task by ID
 * GET /ai/execution/tasks/:taskId
 */
async function getTask(
  request: FastifyRequest<{ Params: GetTaskParams }>,
  reply: FastifyReply
): Promise<void> {
  const { taskId } = request.params;

  const taskService = getExecutionTaskService();
  const task = await taskService.getTask(taskId);

  if (!task) {
    reply.code(404).send({ error: 'Task not found' });
    return;
  }

  reply.send(task);
}

/**
 * Get task summary (lighter response)
 * GET /ai/execution/tasks/:taskId/summary
 */
async function getTaskSummary(
  request: FastifyRequest<{ Params: GetTaskParams }>,
  reply: FastifyReply
): Promise<void> {
  const { taskId } = request.params;

  const taskService = getExecutionTaskService();
  const summary = await taskService.getTaskSummary(taskId);

  if (!summary) {
    reply.code(404).send({ error: 'Task not found' });
    return;
  }

  reply.send(summary);
}

/**
 * Get task result (for completed tasks)
 * GET /ai/execution/tasks/:taskId/result
 */
async function getTaskResult(
  request: FastifyRequest<{ Params: GetTaskParams }>,
  reply: FastifyReply
): Promise<void> {
  const { taskId } = request.params;

  const taskService = getExecutionTaskService();
  const result = await taskService.getTaskResult(taskId);

  if (!result) {
    reply.code(404).send({ error: 'Task not found' });
    return;
  }

  reply.send(result);
}

/**
 * Get task events
 * GET /ai/execution/tasks/:taskId/events
 * 
 * Query params:
 * - limit: Max events to return
 * - offset: Pagination offset
 * - sinceSequence: Replay events since this sequence number (for reconnection)
 */
async function getTaskEvents(
  request: FastifyRequest<{ Params: GetEventsParams; Querystring: GetEventsQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { taskId } = request.params;
  const { limit, offset, sinceSequence } = request.query;

  const taskService = getExecutionTaskService();
  
  // Verify task exists
  const task = await taskService.getTask(taskId);
  if (!task) {
    reply.code(404).send({ error: 'Task not found' });
    return;
  }

  // If sinceSequence is provided, replay from that point
  if (sinceSequence !== undefined) {
    const events = await taskService.getTaskEventsSince(taskId, sinceSequence);
    reply.send({
      taskId,
      events,
      count: events.length,
      sinceSequence,
      replay: true,
    });
    return;
  }

  const events = await taskService.getTaskEvents(taskId, { limit, offset });

  reply.send({
    taskId,
    events,
    count: events.length,
  });
}

/**
 * Stream task events (SSE)
 * GET /ai/execution/tasks/:taskId/stream
 */
async function streamTaskEvents(
  request: FastifyRequest<{ Params: GetEventsParams }>,
  reply: FastifyReply
): Promise<void> {
  const { taskId } = request.params;

  const taskService = getExecutionTaskService();

  // Verify task exists
  const task = await taskService.getTask(taskId);
  if (!task) {
    reply.code(404).send({ error: 'Task not found' });
    return;
  }

  // Set up SSE
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send initial status
  const sendEvent = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send current task state
  sendEvent('task_status', task);

  // Poll for events (simple approach - could use Kafka consumer for production)
  let lastSequence = -1;
  let isComplete = false;

  const pollInterval = setInterval(async () => {
    try {
      const events = await taskService.getTaskEvents(taskId, { limit: 100, offset: lastSequence + 1 });

      for (const event of events) {
        if (event.sequence > lastSequence) {
          sendEvent(event.eventType, event);
          lastSequence = event.sequence;

          // Check for terminal events
          if (
            event.eventType === ExecutionEventType.task_completed ||
            event.eventType === ExecutionEventType.task_failed ||
            event.eventType === ExecutionEventType.task_cancelled
          ) {
            isComplete = true;
          }
        }
      }

      // Check if task is complete
      if (isComplete) {
        clearInterval(pollInterval);
        reply.raw.end();
      }
    } catch (error) {
      console.error('[ExecutionController] Error polling events:', error);
    }
  }, 1000);

  // Handle client disconnect
  request.raw.on('close', () => {
    clearInterval(pollInterval);
  });
}

/**
 * List tasks by project
 * GET /ai/execution/projects/:projectId/tasks
 */
async function listProjectTasks(
  request: FastifyRequest<{ Params: { projectId: string }; Querystring: ListTasksQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { projectId } = request.params;
  const { status, limit, offset } = request.query;

  const taskService = getExecutionTaskService();
  const tasks = await taskService.listTasksByProject(projectId, { status, limit, offset });

  reply.send({
    projectId,
    tasks,
    count: tasks.length,
  });
}

/**
 * Cancel task
 * POST /ai/execution/tasks/:taskId/cancel
 */
async function cancelTask(
  request: FastifyRequest<{ Params: CancelTaskParams }>,
  reply: FastifyReply
): Promise<void> {
  const { taskId } = request.params;

  const taskService = getExecutionTaskService();

  try {
    const task = await taskService.cancelTask(taskId);
    reply.send({
      taskId: task.id,
      status: task.status,
      message: 'Task cancelled',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    reply.code(400).send({ error: message });
  }
}

/**
 * Retry task
 * POST /ai/execution/tasks/:taskId/retry
 */
async function retryTask(
  request: FastifyRequest<{ Params: CancelTaskParams }>,
  reply: FastifyReply
): Promise<void> {
  const { taskId } = request.params;

  const taskService = getExecutionTaskService();

  try {
    const task = await taskService.retryTask(taskId);
    reply.send({
      taskId: task.id,
      status: task.status,
      retryCount: task.retryCount,
      message: 'Task re-queued for execution',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    reply.code(400).send({ error: message });
  }
}

/**
 * Register execution routes
 */
export async function registerExecutionRoutes(fastify: FastifyInstance): Promise<void> {
  // Create task
  fastify.post('/ai/execution/tasks', createTask);

  // Get task
  fastify.get('/ai/execution/tasks/:taskId', getTask);

  // Get task summary
  fastify.get('/ai/execution/tasks/:taskId/summary', getTaskSummary);

  // Get task result
  fastify.get('/ai/execution/tasks/:taskId/result', getTaskResult);

  // Get task events
  fastify.get('/ai/execution/tasks/:taskId/events', getTaskEvents);

  // Stream task events (SSE)
  fastify.get('/ai/execution/tasks/:taskId/stream', streamTaskEvents);

  // List project tasks
  fastify.get('/ai/execution/projects/:projectId/tasks', listProjectTasks);

  // Cancel task
  fastify.post('/ai/execution/tasks/:taskId/cancel', cancelTask);

  // Retry task
  fastify.post('/ai/execution/tasks/:taskId/retry', retryTask);
}
