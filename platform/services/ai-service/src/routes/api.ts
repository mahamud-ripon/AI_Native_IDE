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
}
