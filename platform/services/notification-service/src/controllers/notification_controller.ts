import { Request, Response } from 'express';
import { PushService } from '../services/push_service.js';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const ListQuerySchema = z.object({
  page: z.string().default('1'),
  limit: z.string().default('20'),
  unreadOnly: z.string().default('false')
});

export const NotificationController = {
  async list(req: Request, res: Response) {
    try {
      const query = ListQuerySchema.parse(req.query);
      const userId = (req as any).user.id;
      const page = parseInt(query.page, 10);
      const limit = parseInt(query.limit, 10);
      const unreadOnly = query.unreadOnly === 'true';

      const where: any = { userId };
      if (unreadOnly) {
        where.isRead = false;
      }

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.notification.count({ where })
      ]);

      return res.json({
        success: true,
        data: notifications,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  async markRead(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      await prisma.notification.updateMany({
        where: { id: id as string, userId },
        data: { isRead: true, readAt: new Date() }
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  async markAllRead(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;

      const result = await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: new Date() }
      });

      return res.json({ success: true, updatedCount: result.count });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      await prisma.notification.deleteMany({
        where: { id: id as string, userId }
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  async unreadCount(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;

      const count = await prisma.notification.count({
        where: { userId, isRead: false }
      });

      return res.json({ success: true, count });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
