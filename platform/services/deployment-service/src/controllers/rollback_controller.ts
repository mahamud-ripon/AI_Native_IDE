import { Request, Response } from 'express';
import { BuildOrchestrator } from '../services/build_orchestrator.js';

export const RollbackController = {
  // POST /api/v1/deploy/rollback/:deployment_id
  async rollback(req: Request, res: Response) {
    try {
      const { deployment_id } = req.params;
      const userId = (req as any).user.id;

      const result = await BuildOrchestrator.rollback(deployment_id as string, userId as string);

      return res.status(202).json({
        new_deployment_id: result.newDeploymentId
      });
    } catch (error: any) {
      console.error('[Rollback] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
