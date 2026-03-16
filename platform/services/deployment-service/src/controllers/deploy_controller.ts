import { Request, Response } from 'express';
import { BuildOrchestrator } from '../services/build_orchestrator.js';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const PreviewSchema = z.object({
  projectId: z.string().uuid(),
  branch: z.string().min(1)
});

const ProductionSchema = z.object({
  projectId: z.string().uuid(),
  branch: z.string().min(1),
  provider: z.enum(['vercel', 'railway', 'aws', 'gcp', 'azure']).optional(),
  buildCommand: z.string().optional(),
  outputDir: z.string().optional(),
  nodeVersion: z.string().optional()
});

export const DeployController = {
  // POST /api/v1/deploy/preview
  async deployPreview(req: Request, res: Response) {
    try {
      const data = PreviewSchema.parse(req.body);
      const userId = (req as any).user.id;

      const result = await BuildOrchestrator.deployPreview(
        data.projectId,
        userId,
        data.branch
      );

      return res.status(202).json({
        deployment_id: result.deploymentId,
        ws_channel: result.wsChannel
      });
    } catch (error: any) {
      console.error('[Deploy] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/deploy/production
  async deployProduction(req: Request, res: Response) {
    try {
      const data = ProductionSchema.parse(req.body);
      const userId = (req as any).user.id;

      const result = await BuildOrchestrator.deployProduction(
        data.projectId,
        userId,
        data.branch,
        data.provider || 'vercel',
        data.buildCommand,
        data.outputDir,
        data.nodeVersion
      );

      return res.status(202).json({
        deployment_id: result.deploymentId,
        ws_channel: result.wsChannel
      });
    } catch (error: any) {
      console.error('[Deploy] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
