import { FastifyInstance } from 'fastify';
import { executeTask, executeTaskSync, getTaskStatus } from '../controllers/ai_controller.js';

export async function aiRoutes(fastify: FastifyInstance) {
  fastify.post('/execute/stream', {
    schema: {
      body: {
        type: 'object',
        required: ['projectId', 'prompt'],
        properties: {
          projectId: { type: 'string' },
          prompt: { type: 'string' },
          mode: { type: 'string', enum: ['direct', 'plan_execute', 'multi_agent'] },
          taskComplexity: { type: 'string', enum: ['low', 'medium', 'high'] },
          toolIntent: {
            type: 'object',
            properties: {
              preferredTools: { type: 'array', items: { type: 'string' } },
              requiredTools: { type: 'array', items: { type: 'string' } },
              readOnly: { type: 'boolean' },
            },
          },
          context: {
            type: 'object',
            properties: {
              files: { type: 'array', items: { type: 'string' } },
              schema: { type: 'object' },
            },
          },
          workspaceContext: {
            type: 'object',
            properties: {
              fileTree: { type: 'array', items: { type: 'string' } },
              activeFile: { type: ['string', 'null'] },
              activeFileContent: { type: ['string', 'null'] },
              openTabs: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  }, executeTask);

  fastify.post('/execute', {
    schema: {
      body: {
        type: 'object',
        required: ['projectId', 'prompt'],
        properties: {
          projectId: { type: 'string' },
          prompt: { type: 'string' },
          mode: { type: 'string', enum: ['direct', 'plan_execute', 'multi_agent'] },
          taskComplexity: { type: 'string', enum: ['low', 'medium', 'high'] },
          toolIntent: {
            type: 'object',
            properties: {
              preferredTools: { type: 'array', items: { type: 'string' } },
              requiredTools: { type: 'array', items: { type: 'string' } },
              readOnly: { type: 'boolean' },
            },
          },
          context: {
            type: 'object',
            properties: {
              files: { type: 'array', items: { type: 'string' } },
              schema: { type: 'object' },
            },
          },
          workspaceContext: {
            type: 'object',
            properties: {
              fileTree: { type: 'array', items: { type: 'string' } },
              activeFile: { type: ['string', 'null'] },
              activeFileContent: { type: ['string', 'null'] },
              openTabs: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  }, executeTaskSync);

  fastify.get('/tasks/:taskId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
        },
      },
    },
  }, getTaskStatus);

  // Execute command endpoint - now just marks approval as approved
  // Actual execution happens in the IDE's WebContainer
  fastify.post('/commands/approve', {
    schema: {
      body: {
        type: 'object',
        required: ['commandId'],
        properties: {
          commandId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { commandId } = request.body as { commandId: string };
    const { approveApproval } = await import('../coding/execution/pending_approvals.js');
    const success = approveApproval(commandId);
    return reply.send({
      success,
      data: { commandId, status: success ? 'approved' : 'not_found' },
    });
  });

  // Receive command execution result from IDE
  fastify.post('/commands/result', {
    schema: {
      body: {
        type: 'object',
        required: ['commandId'],
        properties: {
          commandId: { type: 'string' },
          output: { type: 'string' },
          success: { type: 'boolean' },
          exitCode: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const { commandId, output, success, exitCode } = request.body as {
      commandId: string;
      output: string;
      success: boolean;
      exitCode?: number;
    };
    const { completeApproval } = await import('../coding/execution/pending_approvals.js');
    const result = completeApproval(commandId, output || '', success);
    return reply.send({
      success: result,
      data: { commandId, status: result ? (success ? 'completed' : 'failed') : 'not_found' },
    });
  });

  // Get pending command approvals
  fastify.get('/commands/pending', async (_request, reply) => {
    const { getPendingApprovals } = await import('../coding/execution/pending_approvals.js');
    const approvals = getPendingApprovals();
    return reply.send({
      success: true,
      data: { approvals },
    });
  });

  // Deny a command approval
  fastify.post('/commands/deny', {
    schema: {
      body: {
        type: 'object',
        required: ['approvalId'],
        properties: {
          approvalId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { approvalId } = request.body as { approvalId: string };
    const { denyApproval } = await import('../coding/execution/pending_approvals.js');
    const success = denyApproval(approvalId);
    return reply.send({
      success,
      data: { approvalId, status: success ? 'denied' : 'not_found' },
    });
  });

  /**
   * WebSocket endpoint for real-time execution stream events.
   * Frontend connects to ws://host/api/v1/ai/ws (proxied here as /ai/ws → /ws).
   * 
   * Clients can:
   *  - Send: { type: 'execution.subscribe', taskId }
   *  - Receive: { type: 'connected', connectionId } and execution event frames
   */
  fastify.get('/ws', { websocket: true }, (socket: any, req) => {
    const { projectId, userId } = req.query as { projectId?: string; userId?: string };
    const connectionId = `ai-ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    fastify.log.info({ connectionId, projectId, userId }, 'AI WebSocket connected');

    // Send connection established message — matches what ExecutionStreamClient expects
    try {
      socket.send(JSON.stringify({
        type: 'connected',
        connectionId,
        projectId,
        timestamp: Date.now(),
      }));
    } catch (e) {
      fastify.log.error({ err: e }, 'Failed to send AI WS connected message');
    }

    socket.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        fastify.log.debug({ connectionId, type: msg.type }, 'AI WS message received');

        // Echo subscriptions back — real execution events are pushed from the execution worker
        if (msg.type === 'execution.subscribe') {
          socket.send(JSON.stringify({
            type: 'execution.subscribed',
            taskId: msg.taskId,
            workspaceId: msg.workspaceId,
            channel: msg.taskId || msg.workspaceId,
          }));
        } else if (msg.type === 'execution.unsubscribe') {
          socket.send(JSON.stringify({
            type: 'execution.unsubscribed',
            taskId: msg.taskId,
            workspaceId: msg.workspaceId,
          }));
        } else if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        fastify.log.warn({ err: e, connectionId }, 'Failed to parse AI WS message');
      }
    });

    socket.on('close', () => {
      fastify.log.info({ connectionId }, 'AI WebSocket disconnected');
    });

    socket.on('error', (err: Error) => {
      fastify.log.error({ err, connectionId }, 'AI WebSocket error');
    });
  });
}
