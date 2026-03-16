import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';

export const HistoryController = {
  // GET /api/v1/deploy/history/:project_id
  async getHistory(req: Request, res: Response) {
    try {
      const { project_id } = req.params;
      const { limit = '20', cursor } = req.query;
      const userId = (req as any).user.id;

      // Verify access
      const collaborator = await prisma.projectCollaborator.findFirst({
        where: { projectId: project_id as string, userId: userId as string }
      });

      if (!collaborator) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const deployments = await prisma.deployment.findMany({
        where: { projectId: project_id as string },
        take: parseInt(limit as string, 10) + 1,
        cursor: cursor ? { id: cursor as string } : undefined,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          branchName: true,
          commitSha: true,
          provider: true,
          environment: true,
          status: true,
          url: true,
          deployDuration: true,
          createdAt: true,
          deployedAt: true
        }
      });

      let nextCursor: string | undefined;
      if (deployments.length > parseInt(limit as string, 10)) {
        const next = deployments.pop();
        nextCursor = next?.id;
      }

      return res.json({
        success: true,
        data: deployments,
        nextCursor
      });
    } catch (error: any) {
      console.error('[History] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
