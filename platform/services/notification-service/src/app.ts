import express, { Request, Response, NextFunction, Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import { authMiddleware } from './middleware/auth.js';
import { NotificationController } from './controllers/notification_controller.js';

const app: Application = express();

app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://platform.io', /^https:\/\/.*\.platform\.io$/]
    : true,
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/api/v1/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'notification-service' });
});

app.get('/api/v1/health/circuit-breaker', (req: Request, res: Response) => {
  res.json({ status: 'closed', failures: 0 });
});

// Protected endpoints
app.get('/api/v1/notifications', authMiddleware, NotificationController.list);
app.put('/api/v1/notifications/:id/read', authMiddleware, NotificationController.markRead);
app.put('/api/v1/notifications/read-all', authMiddleware, NotificationController.markAllRead);
app.delete('/api/v1/notifications/:id', authMiddleware, NotificationController.delete);
app.get('/api/v1/notifications/unread-count', authMiddleware, NotificationController.unreadCount);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[App] Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app };
