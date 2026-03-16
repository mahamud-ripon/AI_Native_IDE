import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authMiddleware } from './middleware/auth.js';
import { DeployController } from './controllers/deploy_controller.js';
import { HistoryController } from './controllers/history_controller.js';
import { RollbackController } from './controllers/rollback_controller.js';
import { DomainController } from './controllers/domain_controller.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/v1/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'deployment-service' });
});

app.get('/api/v1/health/circuit-breaker', (req: Request, res: Response) => {
  res.json({ status: 'closed', failures: 0 });
});

// Protected endpoints
app.post('/api/v1/deploy/preview', authMiddleware, DeployController.deployPreview);
app.post('/api/v1/deploy/production', authMiddleware, DeployController.deployProduction);
app.get('/api/v1/deploy/history/:project_id', authMiddleware, HistoryController.getHistory);
app.post('/api/v1/deploy/rollback/:deployment_id', authMiddleware, RollbackController.rollback);
app.post('/api/v1/deploy/domains', authMiddleware, DomainController.addDomain);
app.get('/api/v1/deploy/domains/:project_id', authMiddleware, DomainController.listDomains);
app.delete('/api/v1/deploy/domains/:domain_id', authMiddleware, DomainController.deleteDomain);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[App] Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app };
