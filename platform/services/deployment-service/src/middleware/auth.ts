import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);

  try {
    // Verify JWT token
    // For now, just decode and check if user exists in request context
    // In production, use proper JWT verification
    (req as any).user = { id: 'user-id-from-token' };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function internalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== config.internalApiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
}
