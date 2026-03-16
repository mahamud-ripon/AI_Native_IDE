import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// JWT Public Key for RS256 signature verification
// In production, this should be loaded from HashiCorp Vault or a secure secrets manager
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || '';

const DEV_BYPASS_AUTH = process.env.DEV_BYPASS_AUTH === 'true';

// Paths that bypass authentication (public endpoints)
const PUBLIC_PATHS = [
  '/health',
  '/docs',
  '/docs/',
  '/favicon.ico',
  '/gateway/circuit-breakers',  // Admin/monitoring endpoint
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/oauth',  // OAuth callbacks
  '/workflows',  // AI workflows (for development)
  '/api/v1/ai',  // AI service routes (for development)
];

/**
 * Edge Authentication Middleware
 * Stateless JWT verification - no database queries
 * Injects X-User-Id and X-User-Role headers for downstream services
 */
export async function edgeAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url;
  
  // Check if path is public (bypass auth)
  if (PUBLIC_PATHS.some(publicPath => path.startsWith(publicPath))) {
    return;
  }

  // Local dev bypass when auth service/JWT keys are not configured.
  // IMPORTANT: Must never be enabled in production.
  if (DEV_BYPASS_AUTH && process.env.NODE_ENV !== 'production') {
    delete request.headers['x-user-id'];
    delete request.headers['x-user-role'];
    delete request.headers['x-user-email'];

    request.headers['x-user-id'] = '00000000-0000-0000-0000-000000000001';
    request.headers['x-user-role'] = 'admin';
    request.headers['x-user-email'] = 'test@test.com';

    (request as any).user = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'test@test.com',
      role: 'admin',
    };

    return;
  }

  // Extract Authorization header
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return reply.status(401).send({ 
      success: false, 
      error: 'Unauthorized: Missing Authorization header' 
    });
  }

  // Extract Bearer token
  const tokenParts = authHeader.split(' ');
  if (tokenParts.length !== 2 || tokenParts[0] !== 'Bearer') {
    return reply.status(401).send({ 
      success: false, 
      error: 'Unauthorized: Invalid Authorization format. Use "Bearer <token>"' 
    });
  }

  const token = tokenParts[1];

  try {
    // Verify JWT signature locally using RS256 (stateless - no DB query)
    let decoded: any;
    
    if (JWT_PUBLIC_KEY) {
      decoded = jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
    } else {
      // Fallback: In development, if no public key is set, we decode without verification
      // This should NEVER be used in production
      console.warn('JWT_PUBLIC_KEY not set - skipping signature verification (DEV ONLY)');
      decoded = jwt.decode(token);
      if (!decoded) {
        throw new Error('Invalid token');
      }
    }

    // Validate required claims
    if (!decoded.sub || !decoded.email) {
      return reply.status(401).send({ 
        success: false, 
        error: 'Unauthorized: Invalid token claims' 
      });
    }

    // Inject user context into headers for downstream services
    // CRITICAL: Remove any spoofed headers from client first
    delete request.headers['x-user-id'];
    delete request.headers['x-user-role'];
    delete request.headers['x-user-email'];

    // Set internal headers that downstream services will trust
    request.headers['x-user-id'] = decoded.sub;
    request.headers['x-user-role'] = decoded.role || 'user';
    request.headers['x-user-email'] = decoded.email;
    
    // Store user context in request for other middleware
    (request as any).user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role || 'user',
    };

  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return reply.status(401).send({ 
        success: false, 
        error: 'Unauthorized: Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return reply.status(401).send({ 
        success: false, 
        error: 'Unauthorized: Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    console.error('JWT Verification Error:', error);
    return reply.status(401).send({ 
      success: false, 
      error: 'Unauthorized: Token verification failed' 
    });
  }
}

/**
 * Helper function to check if a path requires authentication
 * Used by other middleware to determine auth status
 */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some(publicPath => path.startsWith(publicPath));
}

/**
 * Helper to extract user from request (for other middleware)
 */
export function getRequestUser(request: FastifyRequest): { id: string; email: string; role: string } | null {
  return (request as any).user || null;
}
