/**
 * JWT Authentication for Admin Panel
 * 
 * Uses jose library for edge-compatible JWT verification.
 * Validates admin tokens and checks permissions.
 */

import { jwtVerify, JWTPayload } from 'jose';

function getJwtSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
      throw new Error('ADMIN_JWT_SECRET environment variable is required in production');
    }
    // Development fallback with warning
    console.warn('WARNING: Using development JWT secret. Set ADMIN_JWT_SECRET for production.');
    return new TextEncoder().encode('dev-secret-not-for-production-use');
  }
  
  return new TextEncoder().encode(secret);
}

// Lazy-load JWT secret to avoid build-time errors
let _jwtSecret: Uint8Array | null = null;

function getLazyJwtSecret() {
  if (!_jwtSecret) {
    _jwtSecret = getJwtSecret();
  }
  return _jwtSecret;
}

export interface AdminPayload extends JWTPayload {
  sub: string;
  email: string;
  role: 'admin' | 'superadmin';
  permissions: string[];
  iat: number;
  exp: number;
}

export interface Permission {
  resource: string;
  action: 'read' | 'write' | 'delete';
}

// Predefined permission sets for roles
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'users:read',
    'users:write',
    'analytics:read',
    'infrastructure:read',
  ],
  superadmin: [
    'users:read',
    'users:write',
    'users:delete',
    'analytics:read',
    'analytics:write',
    'infrastructure:read',
    'infrastructure:write',
    'maintenance:write',
    'audit:read',
  ],
};

/**
 * Verify and decode an admin JWT token
 */
export async function verifyAdminToken(token: string): Promise<AdminPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getLazyJwtSecret());
    
    // Validate required fields
    if (!payload.sub || !payload.role) {
      return null;
    }
    
    return payload as AdminPayload;
  } catch (error) {
    // Token expired, invalid signature, or malformed
    return null;
  }
}

/**
 * Check if admin has a specific permission
 */
export function hasPermission(payload: AdminPayload, permission: string): boolean {
  // Superadmin has all permissions
  if (payload.role === 'superadmin') {
    return true;
  }
  
  // Check explicit permissions
  return payload.permissions?.includes(permission) ?? false;
}

/**
 * Check if admin has any of the specified permissions
 */
export function hasAnyPermission(payload: AdminPayload, permissions: string[]): boolean {
  return permissions.some(p => hasPermission(payload, p));
}

/**
 * Check if admin has all of the specified permissions
 */
export function hasAllPermissions(payload: AdminPayload, permissions: string[]): boolean {
  return permissions.every(p => hasPermission(payload, p));
}

/**
 * Check if admin can access a specific route
 */
export function canAccessRoute(payload: AdminPayload, route: string): boolean {
  const routePermissions: Record<string, string[]> = {
    '/users': ['users:read'],
    '/users/ban': ['users:write'],
    '/users/delete': ['users:delete'],
    '/infrastructure': ['infrastructure:read'],
    '/infrastructure/maintenance': ['maintenance:write'],
    '/analytics': ['analytics:read'],
    '/audit': ['audit:read'],
  };
  
  const required = routePermissions[route];
  if (!required) {
    return true; // No specific permission required
  }
  
  return hasAnyPermission(payload, required);
}

/**
 * Generate a mock admin token for development
 * WARNING: Only use in development mode
 */
export async function generateDevToken(
  role: 'admin' | 'superadmin' = 'admin'
): Promise<string> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot generate dev tokens in production');
  }
  
  const { SignJWT } = await import('jose');
  
  const payload: Omit<AdminPayload, 'iat' | 'exp'> = {
    sub: `dev-${role}-${Date.now()}`,
    email: `dev-${role}@admin.platform.io`,
    role,
    permissions: ROLE_PERMISSIONS[role],
  };
  
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getLazyJwtSecret());
}
