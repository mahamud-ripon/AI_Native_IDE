import { FastifyRequest, FastifyReply } from 'fastify';
import { redisClient } from '../lib/redis';
import { getRequestUser, isPublicPath } from './edge_auth';

/**
 * Global Rate Limiter - Auth-Aware (not IP-based)
 * 
 * CRITICAL: This middleware MUST rate limit by X-User-Id (from JWT) for authenticated routes.
 * Standard IP rate limiting will permanently block 1,000 developers behind a single NAT.
 * It falls back to IP ONLY for anonymous endpoints (e.g., /login or /api/v1/public).
 */

// Rate limits per window
const AUTHENTICATED_RATE_LIMIT = 1000; // 1000 requests per window per user
const ANONYMOUS_RATE_LIMIT = 50;       // 50 requests per window per IP
const RATE_LIMIT_WINDOW_SECONDS = 60;  // 1 minute window

// High-cost endpoint limits (stricter)
const HIGH_COST_ENDPOINTS = [
  '/api/v1/ai/generate',
  '/api/v1/exec/',
  '/api/v1/deploy/',
];

const HIGH_COST_LIMIT = 30; // 30 requests per minute for expensive ops

export async function globalRateLimiterMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url;
  const method = request.method;
  
  // Skip rate limiting for GET requests to health and public endpoints
  if (method === 'GET' && isPublicPath(path)) {
    return;
  }

  // Determine rate limit key
  const user = getRequestUser(request);
  const clientIp = request.ip;
  
  let rateLimitKey: string;
  let limit: number;

  if (user) {
    // Authenticated: Rate limit by User ID (prevents NAT blocking)
    rateLimitKey = `ratelimit:user:${user.id}`;
    limit = AUTHENTICATED_RATE_LIMIT;
  } else {
    // Anonymous: Fall back to IP-based limiting
    rateLimitKey = `ratelimit:ip:${clientIp}`;
    limit = ANONYMOUS_RATE_LIMIT;
  }

  // Check if this is a high-cost endpoint (stricter limits)
  const isHighCost = HIGH_COST_ENDPOINTS.some(endpoint => path.includes(endpoint));
  if (isHighCost) {
    limit = HIGH_COST_LIMIT;
    // Use separate key for high-cost endpoints
    rateLimitKey = `${rateLimitKey}:highcost`;
  }

  try {
    // Use Redis INCR for atomic counter
    const currentCount = await redisClient.incr(rateLimitKey);
    
    // Set expiry on first request
    if (currentCount === 1) {
      await redisClient.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
    }

    // Check if limit exceeded
    if (currentCount > limit) {
      const ttl = await redisClient.ttl(rateLimitKey);
      
      return reply.status(429).send({
        success: false,
        error: 'Rate limit exceeded',
        message: user 
          ? `You have exceeded ${limit} requests per minute. Please slow down.`
          : `Anonymous rate limit exceeded. Please authenticate for higher limits.`,
        retry_after_seconds: ttl,
        limit: limit,
        window: '1 minute',
      });
    }

    // Add rate limit headers to response (will be set in onSend hook)
    (request as any).rateLimitInfo = {
      limit,
      remaining: Math.max(0, limit - currentCount),
      reset: Math.floor(Date.now() / 1000) + RATE_LIMIT_WINDOW_SECONDS,
    };

  } catch (err) {
    // Fail open - log error but allow request
    console.error('Rate Limiter Redis Error:', err);
  }
}

/**
 * Add rate limit headers to response
 * Should be called in onSend hook
 */
export function addRateLimitHeaders(request: FastifyRequest, reply: FastifyReply) {
  const rateLimitInfo = (request as any).rateLimitInfo;
  if (rateLimitInfo) {
    reply.header('X-RateLimit-Limit', rateLimitInfo.limit);
    reply.header('X-RateLimit-Remaining', rateLimitInfo.remaining);
    reply.header('X-RateLimit-Reset', rateLimitInfo.reset);
  }
}
