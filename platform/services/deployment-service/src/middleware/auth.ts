import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Authentication middleware
 *
 * Supports multiple auth methods:
 * 1. Internal API key (service-to-service via x-internal-api-key)
 * 2. X-User-Id header (from API Gateway after JWT validation)
 * 3. Bearer token (direct JWT verification)
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check for internal API key (service-to-service)
  const internalApiKey = req.headers['x-internal-api-key'] as string | undefined;
  if (internalApiKey && internalApiKey === config.internalApiKey) {
    req.user = { id: 'internal', role: 'service' };
    return next();
  }

  // Check for user ID from API Gateway (already validated JWT)
  const userId = req.headers['x-user-id'] as string | undefined;
  if (userId) {
    req.user = { id: userId };
    return next();
  }

  // Check for Bearer token (direct JWT verification)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    const tokenUserId = decoded.sub;

    if (!tokenUserId) {
      return res.status(401).json({ error: 'Token missing subject claim' });
    }

    req.user = {
      id: tokenUserId,
      email: decoded.email as string | undefined,
      role: decoded.role as string | undefined,
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function internalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== config.internalApiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
}
