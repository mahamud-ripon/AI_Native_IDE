import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LLMCompletionRequestSchema, LLMCompletionRequest } from '../llm/types.js';
import { getLLMGateway } from '../llm/gateway.js';
import Redis from 'ioredis';
import { config } from '../config.js';
import { getProducer } from '../kafka/ai_llm_events.js';

const llmCompleteBodySchema = {
  type: 'object',
  required: ['workflowId', 'projectId', 'agentName', 'stepName', 'taskType', 'messages'],
  properties: {
    workflowId: { type: 'string' },
    projectId: { type: 'string' },
    agentName: { type: 'string' },
    stepName: { type: 'string' },
    taskType: { type: 'string', enum: ['plan', 'codegen', 'qa', 'security', 'chat'] },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
          content: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
    complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
    modelHint: { type: 'string' },
    temperature: { type: 'number' },
    maxTokens: { type: 'integer' },
    userId: { type: 'string' },
    orgId: { type: 'string' },
  },
};

interface LLMCompleteBody extends LLMCompletionRequest {}

export async function llmRoutes(fastify: FastifyInstance) {
  const gateway = await getLLMGateway();

  // GET /ai/llm/health - Health check for container startup debugging
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const health = {
      status: 'ok',
      providers: [] as string[],
      redis: 'unknown' as string,
      kafka: 'unknown' as string,
    };

    // Check available providers
    if (config.openaiApiKey) health.providers.push('openai');
    if (config.anthropicApiKey) health.providers.push('anthropic');
    if (config.groqApiKey) health.providers.push('groq');
    health.providers.push('mock'); // Mock provider always available for testing

    // Check Redis connection
    try {
      const redis = new Redis(config.redisUrl);
      await redis.ping();
      health.redis = 'connected';
      await redis.quit();
    } catch (error) {
      health.redis = 'disconnected';
      health.status = 'degraded';
    }

    // Check Kafka connection
    try {
      const producer = await getProducer();
      health.kafka = 'connected';
    } catch (error) {
      health.kafka = 'disconnected';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(health);
  });

  // POST /ai/llm/complete - Non-streaming completion
  fastify.post<{ Body: LLMCompleteBody }>('/complete', {
    schema: {
      body: llmCompleteBodySchema,
    },
  }, async (request: FastifyRequest<{ Body: LLMCompleteBody }>, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string | undefined;
    const orgId = request.headers['x-org-id'] as string | undefined;

    const body = request.body;
    const req: LLMCompletionRequest = {
      ...body,
      userId: userId ?? body.userId,
      orgId: orgId ?? body.orgId,
    };

    try {
      const response = await gateway.complete(req);
      return reply.send(response);
    } catch (error: any) {
      if (error.quotaExceeded) {
        return reply.status(429).send({
          error: 'Quota exceeded',
          reason: error.message,
          limit: error.limit,
          current: error.current,
        });
      }

      return reply.status(500).send({
        error: 'LLM completion failed',
        message: error.message,
      });
    }
  });

  // POST /ai/llm/stream - SSE streaming completion
  fastify.post<{ Body: LLMCompleteBody }>('/stream', {
    schema: {
      body: llmCompleteBodySchema,
    },
  }, async (request: FastifyRequest<{ Body: LLMCompleteBody }>, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string | undefined;
    const orgId = request.headers['x-org-id'] as string | undefined;

    const body = request.body;
    const req: LLMCompletionRequest = {
      ...body,
      userId: userId ?? body.userId,
      orgId: orgId ?? body.orgId,
    };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      for await (const event of gateway.stream(req)) {
        const sseData = JSON.stringify(event);
        reply.raw.write(`data: ${sseData}\n\n`);
      }

      reply.raw.end();
    } catch (error: any) {
      const errorEvent = {
        type: 'error',
        data: {
          message: error.message ?? 'Unknown streaming error',
          retryable: true,
        },
      };
      reply.raw.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      reply.raw.end();
    }
  });
}
