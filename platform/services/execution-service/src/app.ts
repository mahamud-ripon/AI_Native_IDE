import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/index.js';
import { authMiddleware } from './middleware/auth.js';
import { ExecutionController } from './controllers/execution_controller.js';
import { GatewayHandler } from './rpc/gateway_handler.js';
import { Prewarmer } from './vm_manager/prewarmer.js';

const app = express();
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/api/v1/exec/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session_id');

  if (sessionId) {
    GatewayHandler.handleConnection(ws, sessionId);
  }
});

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/v1/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'execution-service' });
});

app.get('/api/v1/health/circuit-breaker', (req: Request, res: Response) => {
  res.json({ status: 'closed', failures: 0 });
});

app.get('/api/v1/health/vm-pool', (req: Request, res: Response) => {
  const status = Prewarmer.getPoolStatus();
  res.json(status);
});

// Protected endpoints
app.post('/api/v1/exec/run', authMiddleware, ExecutionController.runCode);
app.post('/api/v1/exec/install', authMiddleware, ExecutionController.installPackages);
app.get('/api/v1/exec/history/:project_id', authMiddleware, ExecutionController.getHistory);
app.post('/api/v1/exec/terminate/:session_id', authMiddleware, ExecutionController.terminate);
app.post('/api/v1/exec/hibernate/:project_id', authMiddleware, ExecutionController.hibernate);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[App] Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app, server };
