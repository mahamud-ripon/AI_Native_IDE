/**
 * Workflow API Routes
 * 
 * REST endpoints for workflow management.
 * All operations publish Kafka events - no synchronous execution.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WebSocket as WsWebSocket } from 'ws';
import { prisma } from '@workspace/database';
import { getProducer } from '../kafka/ai_llm_events.js';
import { getWorkflowRegistry } from '../workflows/registry.js';
import type { WorkflowDefinition } from '../workflows/types.js';
import { executionEmitter } from '../lib/executionEmitter.js';
import { z } from 'zod';

const prismaClient = prisma;

// Request schemas
const StartWorkflowSchema = z.object({
  workflowName: z.string().min(1),
  projectId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  initialContext: z.record(z.unknown()).optional(),
  triggerType: z.enum(['manual', 'git_push', 'ai_agent_auto', 'scheduled']).optional(),
});

const ResumeWorkflowSchema = z.object({
  fromStep: z.number().int().min(0).optional(),
  skipCompleted: z.boolean().optional(),
  retryFailed: z.boolean().optional(),
});

// Types
interface StartWorkflowRequest {
  Body: z.infer<typeof StartWorkflowSchema>;
}

interface ResumeWorkflowRequest {
  Params: { workflowRunId: string };
  Body: z.infer<typeof ResumeWorkflowSchema>;
}

interface WorkflowParams {
  Params: { workflowRunId: string };
}

/**
 * Generate unique workflow run ID
 */
function generateWorkflowRunId(): string {
  // Use crypto for proper UUID v4
  return crypto.randomUUID();
}

/**
 * Register workflow routes
 */
export async function registerWorkflowRoutes(app: FastifyInstance): Promise<void> {
  // List available workflows
  app.get('/workflows', async (request: FastifyRequest, reply: FastifyReply) => {
    const registry = getWorkflowRegistry();
    const workflows = registry.list().map((w: WorkflowDefinition) => ({
      name: w.name,
      version: w.version,
      description: w.description,
      totalSteps: w.steps.length,
    }));

    return reply.send({
      workflows,
      count: workflows.length,
    });
  });

  // Get workflow definition
  app.get('/workflows/:name/definition', async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const { name } = request.params;
    const registry = getWorkflowRegistry();
    const definition = registry.get(name);

    if (!definition) {
      return reply.status(404).send({ error: `Workflow "${name}" not found` });
    }

    return reply.send({ definition });
  });

  // Start a new workflow
  app.post('/workflows/start', async (request: FastifyRequest<StartWorkflowRequest>, reply: FastifyReply) => {
    const body = StartWorkflowSchema.parse(request.body);
    
    const registry = getWorkflowRegistry();
    const definition = registry.get(body.workflowName);

    if (!definition) {
      return reply.status(404).send({ error: `Workflow "${body.workflowName}" not found` });
    }

    // Create workflow run in database
    const workflowRunId = generateWorkflowRunId();

    const workflowRun = await prismaClient.workflowRun.create({
      data: {
        id: workflowRunId,
        projectId: body.projectId,
        workflowName: body.workflowName,
        workflowVersion: definition.version,
        workflowDefinitionJson: JSON.parse(JSON.stringify(definition)),
        status: 'running',  // Fix: Start as 'running' so worker can execute
        currentStep: 0,
        totalSteps: definition.steps.length,
        contextJson: JSON.parse(JSON.stringify({
          stateVersion: 1,
          timestamp: new Date().toISOString(),
          agentMemory: {},
          context: {
            projectId: body.projectId,
            userId: body.userId,
            variables: body.initialContext ?? {},
          },
          progress: {
            completedSteps: [],
            failedSteps: [],
            skippedSteps: [],
            currentStep: -1,
          },
        })),
        triggeredBy: body.userId,
        triggerType: body.triggerType ?? 'manual',
        startedAt: new Date(),  // Fix: Set started timestamp
      },
    });

    console.log(`[Workflows] Created workflow run ${workflowRunId} with status: running`);

    // Publish workflow.start event
    const producer = await getProducer();
    await producer.send({
      topic: 'workflow.start',
      messages: [{
        key: workflowRun.id,
        value: JSON.stringify({
          workflowRunId: workflowRun.id,
          workflowName: body.workflowName,
          projectId: body.projectId,
          userId: body.userId,
          initialContext: body.initialContext,
        }),
      }],
    });

    return reply.status(202).send({
      workflowRunId: workflowRun.id,
      status: 'running',  // Fix: Return 'running' status
      message: 'Workflow started',
    });
  });

  // Get workflow run status
  app.get('/workflows/:workflowRunId', async (request: FastifyRequest<WorkflowParams>, reply: FastifyReply) => {
    const { workflowRunId } = request.params;

    const workflowRun = await prismaClient.workflowRun.findUnique({
      where: { id: workflowRunId },
      include: {
        steps: {
          orderBy: { stepIndex: 'asc' },
        },
      },
    });

    if (!workflowRun) {
      return reply.status(404).send({ error: `Workflow run ${workflowRunId} not found` });
    }

    const state = workflowRun.contextJson as {
      progress?: {
        completedSteps: number[];
        failedSteps: number[];
        skippedSteps: number[];
      };
    };

    return reply.send({
      workflowRunId: workflowRun.id,
      workflowName: workflowRun.workflowName,
      workflowVersion: workflowRun.workflowVersion,
      status: workflowRun.status,
      currentStep: workflowRun.currentStep,
      totalSteps: workflowRun.totalSteps,
      completedSteps: state?.progress?.completedSteps ?? [],
      failedSteps: state?.progress?.failedSteps ?? [],
      skippedSteps: state?.progress?.skippedSteps ?? [],
      startedAt: workflowRun.startedAt,
      completedAt: workflowRun.completedAt,
      createdAt: workflowRun.createdAt,
      totalTokensIn: workflowRun.totalTokensIn,
      totalTokensOut: workflowRun.totalTokensOut,
      totalCostUsd: workflowRun.totalCostUsd ? Number(workflowRun.totalCostUsd) : null,
      errorMessage: workflowRun.errorMessage,
      errorStep: workflowRun.errorStep,
      steps: workflowRun.steps.map((s: any) => ({
        stepRunId: s.id,
        stepIndex: s.stepIndex,
        stepName: s.stepName,
        agentName: s.agentName,
        status: s.status,
        attemptNumber: s.attemptNumber,
        retryCount: s.retryCount,
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
        costUsd: s.costUsd ? Number(s.costUsd) : null,
        provider: s.provider,
        model: s.model,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationMs: s.durationMs,
        errorMessage: s.errorMessage,
      })),
    });
  });

  // Get workflow run steps
  app.get('/workflows/:workflowRunId/steps', async (request: FastifyRequest<WorkflowParams>, reply: FastifyReply) => {
    const { workflowRunId } = request.params;

    const steps = await prismaClient.stepRun.findMany({
      where: { workflowRunId },
      orderBy: { stepIndex: 'asc' },
    });

    return reply.send({
      workflowRunId,
      steps: steps.map((s: { id: string; stepIndex: number; stepName: string; agentName: string; status: string; attemptNumber: number; retryCount: number; tokensIn: number; tokensOut: number; costUsd: { toNumber: () => number } | null; provider: string | null; model: string | null; startedAt: Date | null; completedAt: Date | null; durationMs: number | null; errorMessage: string | null }) => ({
        stepRunId: s.id,
        stepIndex: s.stepIndex,
        stepName: s.stepName,
        agentName: s.agentName,
        status: s.status,
        attemptNumber: s.attemptNumber,
        retryCount: s.retryCount,
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
        costUsd: s.costUsd ? Number(s.costUsd) : null,
        provider: s.provider,
        model: s.model,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationMs: s.durationMs,
        errorMessage: s.errorMessage,
      })),
      count: steps.length,
    });
  });

  // Resume a workflow
  app.post('/workflows/:workflowRunId/resume', async (request: FastifyRequest<ResumeWorkflowRequest>, reply: FastifyReply) => {
    const { workflowRunId } = request.params;
    const body = ResumeWorkflowSchema.parse(request.body);

    const workflowRun = await prismaClient.workflowRun.findUnique({
      where: { id: workflowRunId },
    });

    if (!workflowRun) {
      return reply.status(404).send({ error: `Workflow run ${workflowRunId} not found` });
    }

    if (workflowRun.status === 'completed') {
      return reply.status(400).send({ error: 'Cannot resume completed workflow' });
    }

    // Publish workflow.resume event
    const producer = await getProducer();
    await producer.send({
      topic: 'workflow.resume',
      messages: [{
        key: workflowRunId,
        value: JSON.stringify({
          workflowRunId,
          fromStep: body.fromStep,
          skipCompleted: body.skipCompleted,
          retryFailed: body.retryFailed,
        }),
      }],
    });

    return reply.status(202).send({
      workflowRunId,
      status: 'pending',
      message: 'Workflow resume request published',
    });
  });

  // Cancel a workflow
  app.post('/workflows/:workflowRunId/cancel', async (request: FastifyRequest<WorkflowParams & { Body: { reason?: string } }>, reply: FastifyReply) => {
    const { workflowRunId } = request.params;
    const { reason } = request.body || {};

    const workflowRun = await prismaClient.workflowRun.findUnique({
      where: { id: workflowRunId },
    });

    if (!workflowRun) {
      return reply.status(404).send({ error: `Workflow run ${workflowRunId} not found` });
    }

    if (workflowRun.status === 'completed' || workflowRun.status === 'cancelled') {
      return reply.status(400).send({ error: `Cannot cancel workflow in ${workflowRun.status} state` });
    }

    // Publish workflow.cancel event
    const producer = await getProducer();
    await producer.send({
      topic: 'workflow.cancel',
      messages: [{
        key: workflowRunId,
        value: JSON.stringify({
          workflowRunId,
          reason: reason ?? 'Cancelled by user',
        }),
      }],
    });

    return reply.status(202).send({
      workflowRunId,
      status: 'cancelling',
      message: 'Workflow cancel request published',
    });
  });

  // List workflow runs for a project
  app.get('/projects/:projectId/workflows', async (request: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
    const { projectId } = request.params;

    const workflowRuns = await prismaClient.workflowRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return reply.send({
      projectId,
      workflowRuns: workflowRuns.map((wr: { id: string; workflowName: string; status: string; currentStep: number; totalSteps: number; startedAt: Date | null; completedAt: Date | null; createdAt: Date; errorMessage: string | null }) => ({
        workflowRunId: wr.id,
        workflowName: wr.workflowName,
        status: wr.status,
        currentStep: wr.currentStep,
        totalSteps: wr.totalSteps,
        startedAt: wr.startedAt,
        completedAt: wr.completedAt,
        createdAt: wr.createdAt,
        errorMessage: wr.errorMessage,
      })),
      count: workflowRuns.length,
    });
  });

  // WebSocket endpoint for real-time execution events
  app.get('/ws', { websocket: true }, (connection: unknown, _req: FastifyRequest) => {
    const socket = (connection as { socket: unknown }).socket as unknown as WsWebSocket;
    
    socket.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'execution.subscribe' && msg.workspaceId) {
          executionEmitter.subscribe(msg.workspaceId, socket);
          socket.send(JSON.stringify({ type: 'execution.subscribed', workspaceId: msg.workspaceId }));
        }
      } catch {
        // ignore malformed messages
      }
    });
    
    socket.send(JSON.stringify({ type: 'connection.established', connectionId: `conn-${Date.now()}` }));
  });
}
