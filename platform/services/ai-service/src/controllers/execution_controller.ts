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
import { normalizeWorkflowTimeout } from '../execution/execution_timeout_policy.js';
import { config } from '../config.js';
import { getLLMGateway } from '../llm/gateway.js';
import { LLMStreamChunkEvent } from '../llm/types.js';
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

const CODING_INTENT_PATTERNS = [
  /create\s+.*(file|script|app|project|template|function|class)/i,
  /build\s+.*(project|app|application|page|ui)/i,
  /design\s+.*(monorepo|workspace|folder structure|project structure|architecture|scaffold)/i,
  /generate\s+.*(code|logic|test|file)/i,
  /write\s+.*(code|function|class|logic|file|script)/i,
  /modify\s+.*(file|code|logic|content)/i,
  /update\s+.*(file|code|logic|dependency)/i,
  /fix\s+.*(bug|error|issue|code|vulnerability)/i,
  /refactor\s+.*(code|logic|file|function)/i,
  /add\s+.*(test|feature|route|endpoint|component|file)/i,
  /delete\s+.*(file|directory|folder|asset)/i,
  /remove\s+.*(file|directory|folder|asset)/i,
  /deploy\s+.*/i,
  /initialize\s+.*(project|repo|git)/i,
  /(monorepo|workspace|folder structure|project structure|boilerplate|starter|scaffold|package\.json|tsconfig\.json|vite\.config|turbo\.json|pnpm-workspace)/i,
  /\.(html|js|ts|tsx|py|css|json|md|go|rs|java|cpp|h|rb|php|sh|yml|yaml|dockerfile|makefile)$/i,
];

const PROJECT_SCAFFOLDING_PATTERNS = [
  /design\s+.*(monorepo|workspace|folder structure|project structure|scaffold)/i,
  /(monorepo|workspace)\s+(structure|setup|scaffold|starter)/i,
  /(folder|project)\s+structure/i,
  /set\s+up\s+.*(workspace|monorepo|project|folder structure)/i,
  /start\s+from\s+scratch/i,
  /(package\.json|tsconfig\.json|vite\.config|turbo\.json|pnpm-workspace|apps\/|packages\/)/i,
  /create\s+.*(monorepo|workspace|starter|boilerplate)/i,
];

const HEAVY_BUILD_PATTERNS = [
  /authentication|login|signup|oauth/i,
  /database|postgres|mysql|mongodb|redis/i,
  /backend|server|api|endpoint|microservice/i,
  /docker|kubernetes|ci\/cd|deployment/i,
  /payment|billing|stripe|webhook/i,
  /queue|worker|kafka|socket|websocket/i,
  /full.?stack/i,
];

/**
 * Check if prompt is an obvious short greeting.
 */
function isVagueGreeting(prompt: string): boolean {
  const p = prompt.trim();
  return VAGUE_PATTERNS.some(pattern => pattern.test(p));
}

/**
 * Check if prompt is an obvious coding intent.
 */
function isObviousCodingIntent(prompt: string): boolean {
  const p = prompt.trim();
  // Check if prompt is literally a file path
  if (/\.[a-z0-9]+$/i.test(p) && p.length < 50 && !p.includes(' ')) return true;
  return CODING_INTENT_PATTERNS.some(pattern => pattern.test(p));
}

function isProjectScaffoldingIntent(prompt: string): boolean {
  const p = prompt.trim();
  return PROJECT_SCAFFOLDING_PATTERNS.some(pattern => pattern.test(p));
}

function hasHeavyBuildSignals(prompt: string): boolean {
  return HEAVY_BUILD_PATTERNS.some(pattern => pattern.test(prompt));
}

function isLikelyConversationPrompt(prompt: string): boolean {
  const p = prompt.trim();

  if (isVagueGreeting(p)) {
    return true;
  }

  if (isObviousCodingIntent(p) || isProjectScaffoldingIntent(p)) {
    return false;
  }

  return /^(what|who|why|how|can you|could you|would you|tell me|explain)\b/i.test(p)
    && !/(file|project|app|workspace|repo|monorepo|component|api|bug|error|function|class|build|create|write|folder|structure|package\.json|tsconfig)/i.test(p);
}

/**
 * Classify intent: CHITCHAT vs WORKFLOW.
 */
async function classifyIntent(
  prompt: string,
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<'CHITCHAT' | 'WORKFLOW'> {
  if (isVagueGreeting(prompt)) return 'CHITCHAT';
  if (isObviousCodingIntent(prompt)) return 'WORKFLOW';

  try {
    const gateway = await getLLMGateway();
    const systemContent = `You are an intent classifier for the execution endpoint of an AI coding assistant. Classify the user's message as CHITCHAT or WORKFLOW.

CHITCHAT: greetings, gratitude, brief small talk, or questions purely about the AI itself.
WORKFLOW: Any request to create, build, modify, fix, scaffold, analyze, continue, or work on the current project, workspace, code, files, or app.
WORKFLOW also includes follow-up requests in an active build flow such as "do it in my project", "start from scratch", "continue", or "use this project".

Reply with exactly one word: CHITCHAT or WORKFLOW`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemContent },
    ];

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
    
    const resultText = response.outputText.trim().toUpperCase();
    return resultText.includes('WORKFLOW') ? 'WORKFLOW' : 'CHITCHAT';
  } catch (err: any) {
    console.warn(`[classifyIntent] LLM failed (${err.message}), defaulting to WORKFLOW`);
    return 'WORKFLOW';
  }
}

function hasExplicitWorkflowHint(body: CreateTaskBody): boolean {
  return (
    body.metadata?.intent === 'simple_edit' ||
    body.metadata?.intent === 'complex_build' ||
    Boolean(body.options?.mode) ||
    Boolean(body.workflowRunId) ||
    Boolean(body.agentName) ||
    isObviousCodingIntent(body.instruction) ||
    isProjectScaffoldingIntent(body.instruction)
  );
}

function shouldAllowChatFallback(body: CreateTaskBody): boolean {
  const hasWorkspaceSignal = Boolean(
    body.workspaceContext?.activeFile ||
    body.workspaceContext?.fileTree?.length ||
    body.workspaceContext?.openTabs?.length
  );

  if (hasExplicitWorkflowHint(body)) {
    return false;
  }

  if (hasWorkspaceSignal) {
    return isVagueGreeting(body.instruction);
  }

  if (body.metadata?.intent === 'conversation') {
    return isLikelyConversationPrompt(body.instruction);
  }

  return isLikelyConversationPrompt(body.instruction);
}

function inferWorkflowMode(body: CreateTaskBody): ExecutionTaskOptions['mode'] | undefined {
  if (body.options?.mode) {
    return body.options.mode;
  }

  const prompt = body.instruction;

  if (isProjectScaffoldingIntent(prompt) && !hasHeavyBuildSignals(prompt)) {
    return 'direct';
  }

  if (body.metadata?.intent === 'simple_edit') {
    return 'direct';
  }

  if (body.metadata?.intent === 'complex_build' || hasHeavyBuildSignals(prompt)) {
    return 'plan_execute';
  }

  return undefined;
}

/**
 * Handle CHITCHAT: stream response and support tool calls.
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
  },
  modelHint?: string
): Promise<void> {
  const taskId = `chat_${Date.now()}`;
  let fullContent = '';
  let chunkCount = 0;
  let errorDetail: string | null = null;
  let providerName: string | undefined;

  try {
    const gateway = await getLLMGateway();
    let workspaceBlock = '';
    
    if (workspaceContext) {
      const parts: string[] = [];
      if (workspaceContext.fileTree && workspaceContext.fileTree.length > 0) {
        const fileList = workspaceContext.fileTree.slice(0, 80).map(f => `  ${f}`).join('\n');
        parts.push(`PROJECT FILES:\n${fileList}`);
      }
      if (workspaceContext.activeFile) parts.push(`ACTIVE FILE: ${workspaceContext.activeFile}`);
      if (parts.length > 0) workspaceBlock = `\n\n## Workspace\n${parts.join('\n\n')}`;
    }

    const systemPrompt = `You are Bolt, a friendly AI coding assistant.${workspaceBlock}

## Tool Calling (INTERNAL)
If you need to edit files, use:
<tool_call>
<function=write_file>
<parameter=path>path</parameter>
<parameter=content>code</parameter>
</tool_call>`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (chatHistory && chatHistory.length > 0) {
      for (const entry of chatHistory.slice(-6)) {
        messages.push({ role: entry.role, content: entry.content });
      }
    }
    messages.push({ role: 'user', content: prompt });

    // Stream timeout: if no chunks are received for 15s, stop and fallback
    const STREAM_TIMEOUT_MS = 15000;
    let lastChunkTime = Date.now();

    const streamIterator = gateway.stream({
      workflowId: taskId,
      projectId,
      agentName: 'chat',
      stepName: 'respond',
      taskType: 'chat',
      modelHint: modelHint || undefined,
      messages,
      maxTokens: 1024,
      userId,
    });

    while (true) {
      const timeoutPromise = new Promise<{ done: boolean; value: null }>((resolve) => 
        setTimeout(() => resolve({ done: false, value: null }), 1000)
      );
      
      const nextPromise = streamIterator.next();
      const result = await Promise.race([nextPromise, timeoutPromise]);

      if (result.value === null) {
        // Timeout happened
        if (Date.now() - lastChunkTime > STREAM_TIMEOUT_MS) {
          console.warn(`[handleChitchat] Stream stalled for ${taskId}, aborting...`);
          errorDetail = 'Stream stalled';
          break;
        }
        continue;
      }

      const { value: chunk, done } = result as IteratorResult<LLMStreamChunkEvent>;
      if (done) break;

      chunkCount++;
      lastChunkTime = Date.now();
      
      if (chunk.type === 'meta') providerName = chunk.data.provider;
      if (chunk.type === 'chunk') fullContent += chunk.data.textDelta;
      if (chunk.type === 'error') { 
        console.error(`[handleChitchat] Stream error: ${chunk.data.message}`);
        errorDetail = chunk.data.message; 
        break; 
      }
    }

    // === FALLBACK LOGIC ===
    // If we have no content and encountered an error or stall, try a reliable provider (Groq)
    if (!fullContent.trim() && (errorDetail || chunkCount === 0)) {
      console.log(`[handleChitchat] Primary stream ${taskId} failed or empty. Attempting high-reliability fallback...`);
      try {
        const fallbackResponse = await gateway.complete({
          workflowId: `${taskId}_fallback`,
          projectId,
          agentName: 'chat-fallback',
          stepName: 'respond',
          taskType: 'chat',
          modelHint: 'groq/llama-3.3-70b-versatile', // Reliable fallback
          messages,
          maxTokens: 1024,
        });
        fullContent = fallbackResponse.outputText;
        providerName = `fallback:${fallbackResponse.provider}`;
        errorDetail = null; // Clear error since we recovered
      } catch (fallbackErr: any) {
        console.error(`[handleChitchat] Fallback also failed: ${fallbackErr.message}`);
      }
    }
  } catch (err: any) {
    console.error(`[handleChitchat] Exception: ${err.message}`);
    errorDetail = err?.message ?? 'Unknown error';
  }

  let responseMessage = fullContent.trim();
  let toolResults: any[] = [];

  if (responseMessage.includes('<tool_call>')) {
    try {
      const { createRemoteWorkspace } = await import('../coding/workspace/index.js');
      const { getToolRouter } = await import('../coding/agent/tool_router.js');
      const { executeParsedToolCalls } = await import('../coding/agent/index.js');
      
      const workspace = createRemoteWorkspace({ projectId, projectServiceUrl: config.projectServiceUrl, internalApiKey: config.internalApiKey, userId });
      const toolRouter = getToolRouter();
      toolRouter.setWorkspace(workspace as any);
      
      const result = await executeParsedToolCalls(responseMessage, userId, projectId);
      if (result.hasToolCalls) {
        toolResults = result.results;
        responseMessage = responseMessage.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
      }
    } catch (e) {
      console.error('[handleChitchat] Tool error:', e);
    }
  }

  if (!responseMessage && toolResults.length > 0) {
    const failedTools = toolResults.filter(r => !r.success);
    if (failedTools.length > 0) {
      responseMessage = `The AI attempted to run tools but encountered errors:\n${failedTools.map(t => `- ${t.name}(${JSON.stringify(t.parameters)}): ${t.error}`).join('\n')}`;
    } else if (toolResults.some(r => r.success)) {
      responseMessage = "Task completed successfully.";
    }
  } else if (!responseMessage && errorDetail) {
    responseMessage = `The AI service encountered a temporary problem: ${errorDetail}. Please try a different model or rephrase your request.`;
  } else if (!responseMessage) {
    responseMessage = "I received your message but the AI model returned an empty response. I've attempted to log this for the engineering team. Please try again in a few moments.";
  }

  // Persist
  try {
    const dbConvId = await getOrCreateConversation(projectId, userId, prompt);
    if (dbConvId) await saveMessage(dbConvId, 'assistant', responseMessage);
  } catch (e) {}

  reply.code(200).send({
    taskId,
    type: 'chat',
    status: errorDetail ? 'error' : 'completed',
    message: responseMessage,
    toolCalls: toolResults,
    _meta: { provider: providerName, chunkCount },
  });
}

/**
 * Rate limiting check
 */
async function checkRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const key = `ratelimit:execution:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  const ttl = await redis.ttl(key);
  const resetIn = ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS;
  
  if (count > RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetIn };
  }
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - count, resetIn };
}

/**
 * Handle Conversation Persistence
 */
async function getOrCreateConversation(projectId: string, userId: string, firstMessage: string): Promise<string | null> {
  const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!userExists) return null;

  const recent = await prisma.aiConversation.findFirst({
    where: { projectId, userId, status: { in: ['pending', 'running'] }, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) return recent.id;

  const conv = await prisma.aiConversation.create({
    data: { projectId, userId, title: firstMessage.slice(0, 100), initialPrompt: firstMessage, status: 'running' },
  });
  return conv.id;
}

async function saveMessage(conversationId: string, role: string, content: string): Promise<void> {
  if (!content.trim()) return;
  try {
    await prisma.aiMessage.create({
      data: { conversationId, role: role as any, content },
    });
  } catch (e) {}
}

// Request schemas
interface CreateTaskBody {
  projectId: string;
  workspaceId: string;
  instruction: string;
  modelHint?: string;
  model?: string;
  conversationId?: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  branch?: string;
  priority?: ExecutionTaskPriority;
  agentName?: string;
  workflowRunId?: string;
  options?: ExecutionTaskOptions;
  workspaceContext?: {
    fileTree?: string[];
    activeFile?: string | null;
    activeFileContent?: string | null;
    openTabs?: string[];
  };
  metadata?: {
    agent?: string;
    intent?: 'conversation' | 'simple_edit' | 'complex_build';
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

interface GetTaskParams { taskId: string; }
interface ListTasksQuery { status?: ExecutionTaskStatus; limit?: number; offset?: number; }
interface GetEventsParams { taskId: string; }
interface GetEventsQuery { limit?: number; offset?: number; sinceSequence?: number; }
interface CancelTaskParams { taskId: string; }

/**
 * Create execution task
 */
async function createTask(
  request: FastifyRequest<{ Body: CreateTaskBody }>,
  reply: FastifyReply
): Promise<void> {
  let userId = request.headers['x-user-id'] as string || ((request as any).user as { id: string } | undefined)?.id;

  if (!userId) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const rateLimit = await checkRateLimit(userId);
  reply.header('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  reply.header('X-RateLimit-Remaining', rateLimit.remaining);
  reply.header('X-RateLimit-Reset', rateLimit.resetIn);
  
  if (!rateLimit.allowed) {
    reply.code(429).send({ error: 'Rate limit exceeded' });
    return;
  }

  const { projectId, workspaceId, instruction, conversationId, chatHistory, workspaceContext, branch, priority, agentName, workflowRunId, options, metadata } = request.body;
  const modelHint = request.body.modelHint ?? request.body.model;

  if (!projectId || !workspaceId || !instruction) {
    reply.code(400).send({ error: 'Missing required fields' });
    return;
  }

  // Persist
  try {
    const dbConversationId = await getOrCreateConversation(projectId, userId, instruction);
    if (dbConversationId) await saveMessage(dbConversationId, 'user', instruction);
  } catch (err: any) {}

  // The execution endpoint is workflow-first. We only use chat fallback for
  // clearly conversational prompts with no project-scaffolding/workflow hints.
  if (shouldAllowChatFallback(request.body)) {
    try {
      const intent = await classifyIntent(instruction, chatHistory);
      if (intent === 'CHITCHAT') {
        await handleChitchat(instruction, userId, projectId, reply, chatHistory, workspaceContext, modelHint);
        return;
      }
    } catch (err: any) {}
  } else {
    console.log('[ExecutionController] Treating request as workflow-first', {
      projectId,
      workspaceId,
      intent: metadata?.intent,
      mode: options?.mode,
    });
  }

  const inferredMode = inferWorkflowMode(request.body);
  const normalizedOptions: ExecutionTaskOptions = {
    ...options,
    mode: inferredMode ?? options?.mode,
    modelHint,
    timeoutMs: normalizeWorkflowTimeout(options?.timeoutMs),
  };

  const taskService = getExecutionTaskService();
  const createRequest: CreateExecutionTaskRequest = {
    projectId, workspaceId, instruction, userId, conversationId, branch, priority, agentName, workflowRunId,
    options: normalizedOptions,
    metadata,
    workspaceContext,
  };

  const task = await taskService.createAndEnqueue(createRequest);
  reply.code(201).send({ taskId: task.id, status: task.status, message: 'Task created' });
}

async function getTask(request: FastifyRequest<{ Params: GetTaskParams }>, reply: FastifyReply): Promise<void> {
  const { taskId } = request.params;
  const task = await getExecutionTaskService().getTask(taskId);
  if (!task) { reply.code(404).send({ error: 'Task not found' }); return; }
  reply.send(task);
}

async function getTaskSummary(request: FastifyRequest<{ Params: GetTaskParams }>, reply: FastifyReply): Promise<void> {
  const { taskId } = request.params;
  const summary = await getExecutionTaskService().getTaskSummary(taskId);
  if (!summary) { reply.code(404).send({ error: 'Task not found' }); return; }
  reply.send(summary);
}

async function getTaskResult(request: FastifyRequest<{ Params: GetTaskParams }>, reply: FastifyReply): Promise<void> {
  const { taskId } = request.params;
  const result = await getExecutionTaskService().getTaskResult(taskId);
  if (!result) { reply.code(404).send({ error: 'Task not found' }); return; }
  reply.send(result);
}

async function getTaskEvents(request: FastifyRequest<{ Params: GetEventsParams; Querystring: GetEventsQuery }>, reply: FastifyReply): Promise<void> {
  const { taskId } = request.params;
  const { limit, offset, sinceSequence } = request.query;
  const taskService = getExecutionTaskService();
  
  if (sinceSequence !== undefined) {
    const events = await taskService.getTaskEventsSince(taskId, sinceSequence);
    reply.send({ taskId, events, count: events.length, replay: true });
    return;
  }
  const events = await taskService.getTaskEvents(taskId, { limit, offset });
  reply.send({ taskId, events, count: events.length });
}

async function streamTaskEvents(request: FastifyRequest<{ Params: GetEventsParams }>, reply: FastifyReply): Promise<void> {
  const { taskId } = request.params;
  const taskService = getExecutionTaskService();
  const task = await taskService.getTask(taskId);
  if (!task) { reply.code(404).send({ error: 'Task not found' }); return; }

  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  const sendEvent = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  sendEvent('task_status', task);

  let lastSequence = -1;
  const pollInterval = setInterval(async () => {
    try {
      const events = await taskService.getTaskEvents(taskId, { limit: 100, offset: lastSequence + 1 });
      for (const event of events) {
        if (event.sequence > lastSequence) {
          sendEvent(event.eventType, event);
          lastSequence = event.sequence;
          if (event.eventType === ExecutionEventType.task_completed || event.eventType === ExecutionEventType.task_failed || event.eventType === ExecutionEventType.task_cancelled) {
            clearInterval(pollInterval);
            reply.raw.end();
          }
        }
      }
    } catch (e) {}
  }, 1000);
  request.raw.on('close', () => clearInterval(pollInterval));
}

async function listProjectTasks(request: FastifyRequest<{ Params: { projectId: string }; Querystring: ListTasksQuery }>, reply: FastifyReply): Promise<void> {
  const { projectId } = request.params;
  const { status, limit, offset } = request.query;
  const tasks = await getExecutionTaskService().listTasksByProject(projectId, { status, limit, offset });
  reply.send({ projectId, tasks, count: tasks.length });
}

async function cancelTask(request: FastifyRequest<{ Params: CancelTaskParams }>, reply: FastifyReply): Promise<void> {
  const { taskId } = request.params;
  try {
    const task = await getExecutionTaskService().cancelTask(taskId);
    reply.send({ taskId: task.id, status: task.status, message: 'Cancelled' });
  } catch (e: any) { reply.code(400).send({ error: e.message }); }
}

async function retryTask(request: FastifyRequest<{ Params: CancelTaskParams }>, reply: FastifyReply): Promise<void> {
  const { taskId } = request.params;
  try {
    const task = await getExecutionTaskService().retryTask(taskId);
    reply.send({ taskId: task.id, status: task.status, message: 'Retrying' });
  } catch (e: any) { reply.code(400).send({ error: e.message }); }
}

async function getChatHistory(request: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply): Promise<void> {
  const { projectId } = request.params;
  const userId = (request.headers['x-user-id'] as string) || 'default-user';
  try {
    const conversations = await prisma.aiConversation.findMany({
      where: { projectId, userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 100 } },
    });
    reply.send({ conversations });
  } catch (e: any) { reply.code(500).send({ error: 'Failed' }); }
}

export async function registerExecutionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/ai/chat/history/:projectId', getChatHistory);
  fastify.post('/ai/execution/tasks', createTask);
  fastify.get('/ai/execution/tasks/:taskId', getTask);
  fastify.get('/ai/execution/tasks/:taskId/summary', getTaskSummary);
  fastify.get('/ai/execution/tasks/:taskId/result', getTaskResult);
  fastify.get('/ai/execution/tasks/:taskId/events', getTaskEvents);
  fastify.get('/ai/execution/tasks/:taskId/stream', streamTaskEvents);
  fastify.get('/ai/execution/projects/:projectId/tasks', listProjectTasks);
  fastify.post('/ai/execution/tasks/:taskId/cancel', cancelTask);
  fastify.post('/ai/execution/tasks/:taskId/retry', retryTask);
}
