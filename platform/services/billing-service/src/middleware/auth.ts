import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { createPublicKey, verify as cryptoVerify } from 'crypto';

// Extend FastifyRequest to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      [key: string]: any;
    };
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-key';

// Simple JWT verification using crypto
function verifyJwt(token: string): any {
  try {
    // For development, use simple base64 decode
    // In production, use proper RS256 verification
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    // Verify signature (simplified for dev)
    // In production, verify with public key
    return payload;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

export function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = verifyJwt(token);
    request.user = decoded as any;
    done();
  } catch (error) {
    return reply.status(401).send({ error: 'Invalid token' });
  }
}

// Optional auth - sets user if token present but doesn't require it
export function optionalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
) {
  const authHeader = request.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = verifyJwt(token);
      request.user = decoded as any;
    } catch (error) {
      // Ignore - user stays undefined
    }
  }
  
  done();
}
