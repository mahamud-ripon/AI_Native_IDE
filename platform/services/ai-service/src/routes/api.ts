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
          context: {
            type: 'object',
            properties: {
              files: { type: 'array', items: { type: 'string' } },
              schema: { type: 'object' },
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
          context: {
            type: 'object',
            properties: {
              files: { type: 'array', items: { type: 'string' } },
              schema: { type: 'object' },
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
