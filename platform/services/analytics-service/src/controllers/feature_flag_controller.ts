import { FastifyRequest, FastifyReply } from 'fastify';
import { FeatureFlagEngine } from '../services/feature_flag_engine.js';
import { z } from 'zod';

const CreateFlagSchema = z.object({
  flagKey: z.string(),
  description: z.string().optional(),
  isEnabledDefault: z.boolean(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
  enabledForPlans: z.array(z.string())
});

const UpdateFlagSchema = z.object({
  isEnabledDefault: z.boolean().optional(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
  enabledForPlans: z.array(z.string()).optional()
});

export async function listFlags(request: FastifyRequest, reply: FastifyReply) {
  try {
    const flags = await FeatureFlagEngine.getAllFlags();
    return reply.send({ success: true, data: flags });
  } catch (error: any) {
    return reply.status(500).send({ error: error.message });
  }
}

export async function createFlag(request: FastifyRequest, reply: FastifyReply) {
  try {
    const data = CreateFlagSchema.parse(request.body);
    const flag = await FeatureFlagEngine.createFlag(data);
    return reply.status(201).send({ success: true, data: flag });
  } catch (error: any) {
    return reply.status(400).send({ error: error.message });
  }
}

export async function updateFlag(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  try {
    const { id } = request.params;
    const data = UpdateFlagSchema.parse(request.body);
    const flag = await FeatureFlagEngine.updateFlag(id, data);
    return reply.send({ success: true, data: flag });
  } catch (error: any) {
    return reply.status(400).send({ error: error.message });
  }
}

export async function evaluateFlag(request: FastifyRequest<{ Querystring: { user_id?: string; flag?: string } }>, reply: FastifyReply) {
  try {
    const userId = request.query?.user_id;
    const flag = request.query?.flag;
    
    if (!userId || !flag) {
      return reply.status(400).send({ error: 'Missing user_id or flag' });
    }

    const enabled = await FeatureFlagEngine.evaluate(userId, flag);
    return reply.send({ enabled });
  } catch (error: any) {
    return reply.status(500).send({ error: error.message });
  }
}
