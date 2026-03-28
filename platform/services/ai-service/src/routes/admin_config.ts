/**
 * Admin AI Configuration Routes
 *
 * Endpoints for managing platform config from the admin panel.
 * All routes require admin authentication.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getConfigService } from '../config/config_service.js';

export async function adminConfigRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /admin/ai/config — get all AI config
  fastify.get('/admin/ai/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const configService = getConfigService();
      const config = await configService.getAllConfig('ai');
      return reply.send({ success: true, data: config });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // PUT /admin/ai/config/:key — update a config value
  fastify.put<{ Params: { key: string } }>(
    '/admin/ai/config/:key',
    async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
      try {
        const { key } = request.params;
        const body = request.body as { value: unknown };
        const userId = (request as any).user?.sub;

        if (!key.startsWith('ai.')) {
          return reply.status(400).send({ success: false, error: 'Only ai.* config keys are allowed' });
        }

        const configService = getConfigService();
        await configService.setConfig(key, body.value, userId);

        // Refresh router capabilities if models were updated
        if (key === 'ai.models') {
          try {
            const { refreshRouterCapabilities } = await import('../llm/gateway.js');
            await refreshRouterCapabilities();
          } catch {}
        }

        return reply.send({ success: true, data: { key, value: body.value } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /admin/ai/models — list available models (includes custom models from DB)
  fastify.get('/admin/ai/models', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const configService = getConfigService();
      const models = await configService.getAvailableModelsAsync();
      return reply.send({ success: true, data: models });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // POST /admin/ai/config/refresh — force refresh cache from DB
  fastify.post('/admin/ai/config/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const configService = getConfigService();
      await configService.refreshCache();
      return reply.send({ success: true, data: { message: 'Config cache refreshed' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // GET /admin/ai/health — check LLM provider connectivity
  fastify.get('/admin/ai/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = await import('../config.js');
      const providers = {
        groq: !!config.config.groqApiKey,
        openai: !!config.config.openaiApiKey,
        anthropic: !!config.config.anthropicApiKey,
      };
      return reply.send({ success: true, data: { providers } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ success: false, error: message });
    }
  });
}
