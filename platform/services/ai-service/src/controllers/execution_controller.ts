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
import { getLLMGateway } from '../llm/gateway.js';
import { prisma } from '@workspace/database';

// Redis for rate limiting
const redis = new Redis(config.redisUrl);

// Rate limit configuration
const RATE_LIMIT_WINDOW_SECONDS = 60; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per window

// ========================================
// PROMPT CLASSIFICATION
// ========================================

const VAGUE_PATTERNS = [
  /^\s*(hi|hello|hey|sup|yo|hiya)\s*[!.?]*\s*$/i,
  /^\s*how are you\s*[?]*\s*$/i,
  /^\s*what (can|do) you do\s*[?]*\s*$/i,
  /^\s*(thanks|thank you|ty)\s*[!.]*\s*$/i,
  /^\s*(help|help me)\s*[!.?]*\s*$/i,
  /^\s*(ok|okay|sure|cool|nice|great)\s*[!.]*\s*$/i,
];

/**
 * Check if prompt is an obvious short greeting.
 * Only returns true for clear-cut cases; everything else goes to the LLM classifier.
 */
function isVagueGreeting(prompt: string): boolean {
  const p = prompt.trim();
  for (const pattern of VAGUE_PATTERNS) {
    if (pattern.test(p)) return true;
  }
  return false;
}

/**
 * Classify intent using LLM Gateway (fast model).
 * Falls back to rule-based if LLM fails.
 */
async function classifyIntent(
  prompt: string,
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<'CHITCHAT' | 'WORKFLOW'> {
  // Fast path: only short-circuit for obvious greetings
  if (isVagueGreeting(prompt)) return 'CHITCHAT';

  try {
    const gateway = await getLLMGateway();

    // Build classification messages with optional history for context
    const systemContent = chatHistory && chatHistory.length > 0
      ? `You are an intent classifier for an AI coding assistant. Classify the user's message as CHITCHAT or WORKFLOW.

CHITCHAT: greetings, questions about the AI, asking how it works, small talk, opinions, "what can you do", "tell me about", casual conversation, asking for explanations or advice
WORKFLOW: ONLY when the user explicitly asks to CREATE, BUILD, GENERATE, WRITE, ADD, MODIFY, FIX, DELETE, DEPLOY, or REFACTOR actual code, files, or projects

Important rules:
- Questions like "what is X?" or "how does X work?" are CHITCHAT
- "build me a project" is WORKFLOW but "how to build a project?" is CHITCHAT
- If the user is repeating themselves, classify as CHITCHAT
- When in doubt, classify as CHITCHAT

Reply with exactly one word: CHITCHAT or WORKFLOW`
      : `You are an intent classifier for an AI coding assistant. Classify the user's message as CHITCHAT or WORKFLOW.

CHITCHAT: greetings, questions about the AI, asking how it works, small talk, opinions, "what can you do", "tell me about", casual conversation, asking for explanations or advice
WORKFLOW: ONLY when the user explicitly asks to CREATE, BUILD, GENERATE, WRITE, ADD, MODIFY, FIX, DELETE, DEPLOY, or REFACTOR actual code, files, or projects

Important rules:
- Questions like "what is X?" or "how does X work?" are CHITCHAT
- "build me a project" is WORKFLOW but "how to build a project?" is CHITCHAT
- When in doubt, classify as CHITCHAT

Reply with exactly one word: CHITCHAT or WORKFLOW`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemContent },
    ];

    // Append recent history (last 4 messages) for context
    if (chatHistory && chatHistory.length > 0) {
      for (const entry of chatHistory.slice(-4)) {
        messages.push({ role: entry.role, content: entry.content });
      }
    }

    messages.push({ role: 'user', content: prompt });

    const response = await gateway.complete({
      workflowId: 'intent-classifier',
      projectId: 'system',
      agentName: 'classifier',
      stepName: 'classify',
      taskType: 'chat',
      messages,
      maxTokens: 10,
    });
    const result = response.outputText.trim().toUpperCase();
    console.log(`[classifyIntent] LLM classified "${prompt.slice(0, 50)}..." as ${result} (provider: ${response.provider})`);
    return result.includes('WORKFLOW') ? 'WORKFLOW' : 'CHITCHAT';
  } catch (err: any) {
    console.warn(`[classifyIntent] LLM failed (${err.message}), defaulting to CHITCHAT`);
    return 'CHITCHAT';
  }
}

/**
 * Handle CHITCHAT: stream a chat response directly from LLM Gateway.
 */
/**
 * Handle CHITCHAT: collect full response and return as JSON.
 * The frontend's sendToAIService expects a JSON response with { type: 'chat' }.
 */
async function handleChitchat(
  prompt: string,
  userId: string,
  projectId: string,
  reply: FastifyReply,
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  workspaceContext?: {
    fileTree?: string[];
    activeFile?: string | null;
    activeFileContent?: string | null;
    openTabs?: string[];
  }
): Promise<void> {
  const taskId = `chat_${Date.now()}`;
  let fullContent = '';
  let chunkCount = 0;
  let errorDetail: string | null = null;
  let providerName: string | undefined;

  try {
    const gateway = await getLLMGateway();

    // Build workspace context block for the system prompt
    let workspaceBlock = '';
    if (workspaceContext) {
      const parts: string[] = [];

      if (workspaceContext.fileTree && workspaceContext.fileTree.length > 0) {
        const fileList = workspaceContext.fileTree.slice(80).map(f => `  ${f}`).join('\n');
        parts.push(`PROJECT FILES (${workspaceContext.fileTree.length} total):\n${fileList}`);
      }

      if (workspaceContext.activeFile) {
        parts.push(`ACTIVE FILE: ${workspaceContext.activeFile}`);
      }

      if (workspaceContext.activeFileContent) {
        const content = workspaceContext.activeFileContent.slice(0, 8000);
        parts.push(`ACTIVE FILE CONTENT:\n\`\`\`\n${content}\n\`\`\``);
      }

      if (workspaceContext.openTabs && workspaceContext.openTabs.length > 0) {
        parts.push(`OPEN TABS: ${workspaceContext.openTabs.join(', ')}`);
      }

      if (parts.length > 0) {
        workspaceBlock = `\n\n## Workspace Context\n${parts.join('\n\n')}`;
      }
    }

    // Build system prompt with workspace awareness
    const systemPrompt = `You are Bolt, a friendly AI coding assistant in a cloud IDE.${workspaceBlock}

IMPORTANT INSTRUCTIONS:
- You CAN see the user's project files listed above. Reference them by name when relevant.
- For greetings and small talk, respond warmly and briefly. Do NOT generate code for greetings.
- When the user asks about their files or project, refer to the file list you can see.
- If the user asks "what files do I have?" or "what can you see?", list the files from the PROJECT FILES section.
- Only generate code when explicitly asked to build or modify something.
- If generating code, consider existing files to avoid duplicates.`;

    // Build messages with optional context from chat history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Append recent chat history (last 6 messages) for context awareness
    if (chatHistory && chatHistory.length > 0) {
      for (const entry of chatHistory.slice(-6)) {
        messages.push({ role: entry.role, content: entry.content });
      }
    }

    messages.push({ role: 'user', content: prompt });

    for await (const chunk of gateway.stream({
      workflowId: taskId,
      projectId,
      agentName: 'chat',
      stepName: 'respond',
      taskType: 'chat',
      messages,
      maxTokens: 1024,
      userId,
    })) {
      chunkCount++;

      if (chunk.type === 'meta') {
        providerName = chunk.data.provider;
        console.log(`[handleChitchat] Stream started: provider=${chunk.data.provider}, model=${chunk.data.model}`);
      }

      if (chunk.type === 'chunk') {
        fullContent += chunk.data.textDelta;
        console.log(`[handleChitchat] chunk #${chunkCount}: "${chunk.data.textDelta.slice(0, 40)}..."`);
      }

      if (chunk.type === 'done') {
        console.log(`[handleChitchat] Stream done: tokensIn=${chunk.data.tokensIn}, tokensOut=${chunk.data.tokensOut}, latency=${chunk.data.latencyMs}ms`);
      }

      if (chunk.type === 'error') {
        errorDetail = chunk.data.message;
        console.error(`[handleChitchat] Stream error chunk: ${chunk.data.message}, retryable=${chunk.data.retryable}`);
        break;
      }
    }

    console.log(`[handleChitchat] Stream finished: totalChunks=${chunkCount}, contentLength=${fullContent.length}, provider=${providerName ?? 'unknown'}`);
  } catch (err: any) {
    errorDetail = err?.message ?? 'Unknown LLM error';
    console.error('[handleChitchat] LLM exception:', err.message, err.stack);
  }

  // Determine response: real content > error message > fallback prompt
  let responseMessage: string;
  let responseStatus: 'completed' | 'error' = 'completed';

  if (fullContent.trim()) {
    // Real LLM response
    responseMessage = fullContent;
  } else if (errorDetail) {
    // LLM failed — surface the error, don't fake success
    responseMessage = `Sorry, I couldn't process your message right now. The AI service reported: ${errorDetail}`;
    responseStatus = 'error';
  } else {
    // Empty response with no error (shouldn't happen with mock fallback, but defensive)
    responseMessage = 'I received your message but could not generate a response. Please try again or rephrase your question.';
    responseStatus = 'error';
  }

  // Persist assistant response to DB (fire-and-forget)
  try {
    const dbConvId = await getOrCreateConversation(projectId, userId, prompt);
    if (dbConvId) await saveMessage(dbConvId, 'assistant', responseMessage);
  } catch (err: any) {
    console.warn('[handleChitchat] Failed to persist assistant message:', err.message);
  }

  reply.code(200).send({
    taskId,
    type: 'chat',
    status: responseStatus,
    message: responseMessage,
    _meta: {
      provider: providerName,
      chunkCount,
      wasFallback: !fullContent.trim(),
    },
  });
}

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

// ========================================
// CHAT PERSISTENCE (Database)
// ========================================

/**
 * Get or create an ai_conversation row for a project+user pair.
 * Reuses the most recent active conversation within 24h.
 * Falls back gracefully if user doesn't exist in DB.
 */
async function getOrCreateConversation(
  projectId: string,
  userId: string,
  firstMessage: string
): Promise<string | null> {
  // Verify user exists before creating conversation (avoid FK constraint violation)
  const userExists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!userExists) {
    console.warn(`[getOrCreateConversation] User ${userId} not found in DB, skipping persistence`);
    return null;
  }

  // Try to find an existing active conversation for this project (within 24h)
  const recent = await prisma.aiConversation.findFirst({
    where: {
      projectId,
      userId,
      status: { in: ['pending', 'running'] },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (recent) return recent.id;

  // Create a new conversation
  const conv = await prisma.aiConversation.create({
    data: {
      projectId,
      userId,
      title: firstMessage.slice(0, 100),
      initialPrompt: firstMessage,
      status: 'running',
    },
  });
  return conv.id;
}

/**
 * Save a message to the ai_messages table.
 */
async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  tokensUsed?: number
): Promise<void> {
  if (!content.trim()) return;
  try {
    await prisma.aiMessage.create({
      data: {
        conversationId,
        role,
        content,
        tokensUsed: tokensUsed ?? null,
      },
    });
  } catch (err: any) {
    console.error(`[saveMessage] Failed to save ${role} message:`, err.message);
  }
}

// Request schemas
interface CreateTaskBody {
  projectId: string;
  workspaceId: string;
  instruction: string;
  conversationId?: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  branch?: string;
  priority?: ExecutionTaskPriority;
  agentName?: string;
  workflowRunId?: string;
  options?: ExecutionTaskOptions;
  // Workspace context from IDE
  workspaceContext?: {
    fileTree?: string[];           // List of file paths in the project
    activeFile?: string | null;    // Currently open file path
    activeFileContent?: string | null; // Content of the active file
    openTabs?: string[];           // List of open file tabs
  };
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

  const { projectId, workspaceId, instruction, conversationId, chatHistory, workspaceContext, branch, priority, agentName, workflowRunId, options, metadata } = request.body;

  if (!projectId || !workspaceId || !instruction) {
    reply.code(400).send({ error: 'Missing required fields: projectId, workspaceId, instruction' });
    return;
  }

  // ========================================
  // PERSISTENCE: Save user message to DB
  // ========================================
  let dbConversationId: string | null = null;
  try {
    dbConversationId = await getOrCreateConversation(projectId, userId, instruction);
    if (dbConversationId) await saveMessage(dbConversationId, 'user', instruction);
  } catch (err: any) {
    console.warn('[createTask] Failed to persist user message:', err.message);
  }

  // ========================================
  // INTENT CLASSIFICATION: CHITCHAT vs WORKFLOW
  // ========================================
  try {
    const intent = await classifyIntent(instruction, chatHistory);

    if (intent === 'CHITCHAT') {
      // Return chat response directly — don't create a task
      await handleChitchat(instruction, userId, projectId, reply, chatHistory, workspaceContext);
      return;
    }
  } catch (err: any) {
    console.error('[createTask] Intent classification failed:', err.message);
    // Fall through to create a task (WORKFLOW)
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
 * Get chat history for a project
 * GET /ai/chat/history/:projectId
 * Returns recent conversations with their messages
 */
async function getChatHistory(
  request: FastifyRequest<{ Params: { projectId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { projectId } = request.params;
  let userId = request.headers['x-user-id'] as string;
  if (!userId) userId = 'default-user';

  try {
    const conversations = await prisma.aiConversation.findMany({
      where: {
        projectId,
        userId,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 100,
        },
      },
    });

    reply.send({ conversations });
  } catch (err: any) {
    console.error('[getChatHistory] Error:', err.message);
    reply.code(500).send({ error: 'Failed to load chat history' });
  }
}

/**
 * Register execution routes
 */
export async function registerExecutionRoutes(fastify: FastifyInstance): Promise<void> {
  // Chat history
  fastify.get('/ai/chat/history/:projectId', getChatHistory);

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
