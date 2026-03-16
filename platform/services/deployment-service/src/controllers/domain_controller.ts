import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const DomainSchema = z.object({
  projectId: z.string().uuid(),
  domainName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?(\.[a-zA-Z]{2,})+$/)
});

export const DomainController = {
  // POST /api/v1/deploy/domains
  async addDomain(req: Request, res: Response) {
    try {
      const data = DomainSchema.parse(req.body);
      const userId = (req as any).user.id;

      // Verify ownership
      const collaborator = await prisma.projectCollaborator.findFirst({
        where: { projectId: data.projectId, userId, role: 'owner' }
      });

      if (!collaborator) {
        return res.status(403).json({ error: 'Only owner can add domains' });
      }

      const cnameTarget = `${data.domainName.split('.')[0]}.platform-deploy.io`;

      const domain = await prisma.projectDomain.create({
        data: {
          projectId: data.projectId,
          domainName: data.domainName,
          sslStatus: 'pending'
        }
      });

      return res.status(201).json({
        domain_id: domain.id,
        cname_target: cnameTarget,
        verification_status: 'pending'
      });
    } catch (error: any) {
      console.error('[Domain] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /api/v1/deploy/domains/:project_id
  async listDomains(req: Request, res: Response) {
    try {
      const { project_id } = req.params;

      const domains = await prisma.projectDomain.findMany({
        where: { projectId: project_id as string }
      });

      return res.json({
        success: true,
        data: domains
      });
    } catch (error: any) {
      console.error('[Domain] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // DELETE /api/v1/deploy/domains/:domain_id
  async deleteDomain(req: Request, res: Response) {
    try {
      const { domain_id } = req.params;
      const userId = (req as any).user.id;

      const domain = await prisma.projectDomain.findUnique({
        where: { id: domain_id as string },
        include: { project: true }
      });

      if (!domain) {
        return res.status(404).json({ error: 'Domain not found' });
      }

      // Verify ownership
      const collaborator = await prisma.projectCollaborator.findFirst({
        where: { projectId: domain.projectId, userId, role: 'owner' }
      });

      if (!collaborator) {
        return res.status(403).json({ error: 'Only owner can delete domains' });
      }

      await prisma.projectDomain.delete({ where: { id: domain_id as string } });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Domain] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
