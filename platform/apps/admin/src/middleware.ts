/**
 * Next.js Edge Middleware for Admin Panel
 * 
 * Validates JWT tokens before any page loads.
 * Implements zero-trust security model.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAdminToken, canAccessRoute } from '@/lib/auth';

// Routes that require authentication
const PROTECTED_ROUTES = ['/users', '/infrastructure', '/analytics', '/audit'];

// Routes accessible without authentication
const PUBLIC_ROUTES = ['/login', '/403', '/500', '/'];

// API routes that should be handled separately
const API_ROUTES = ['/api/'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.') // Static files
  ) {
    return NextResponse.next();
  }

  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))) {
    return NextResponse.next();
  }

  // Allow API routes (they handle their own auth)
  if (API_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Get token from cookie
  const token = request.cookies.get('admin-token')?.value;

  // No token - redirect to login
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verify token
  const payload = await verifyAdminToken(token);

  // Invalid or expired token - redirect to login
  if (!payload) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'session_expired');
    loginUrl.searchParams.set('redirect', pathname);
    
    // Clear invalid cookie
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete('admin-token');
    return response;
  }

  // Check route access permissions
  const isProtectedRoute = PROTECTED_ROUTES.some(route => pathname.startsWith(route));
  
  if (isProtectedRoute) {
    // Check if user has access to this specific route
    if (!canAccessRoute(payload, pathname)) {
      return NextResponse.redirect(new URL('/403', request.url));
    }
  }

  // Add user info to headers for server components
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', payload.sub);
  requestHeaders.set('x-user-email', payload.email);
  requestHeaders.set('x-user-role', payload.role);
  requestHeaders.set('x-user-permissions', payload.permissions.join(','));

  // Continue with authenticated request
  return NextResponse.next({
    request: { headers: requestHeaders }
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
