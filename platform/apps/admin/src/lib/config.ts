/**
 * Shared Configuration
 * 
 * Centralized configuration for API endpoints and environment variables.
 */

/**
 * API Base URL
 * 
 * Priority:
 * 1. API_GATEWAY_URL - Server-side API gateway URL (for server actions)
 * 2. NEXT_PUBLIC_API_URL - Client-side API URL (for client components)
 * 3. Fallback to localhost for development
 */
export const API_BASE_URL = 
  process.env.API_GATEWAY_URL || 
  process.env.NEXT_PUBLIC_API_URL || 
  'http://localhost:8000';

/**
 * API Version for endpoints
 */
export const API_VERSION = 'v1';

/**
 * Build full API endpoint path
 */
export function apiEndpoint(path: string): string {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // Check if path already includes /api/v1
  if (normalizedPath.startsWith('/api/v1')) {
    return `${API_BASE_URL}${normalizedPath}`;
  }
  
  return `${API_BASE_URL}/api/${API_VERSION}${normalizedPath}`;
}

/**
 * Admin API endpoints
 */
export const ADMIN_ENDPOINTS = {
  // Users
  users: {
    list: '/admin/users',
    detail: (id: string) => `/admin/users/${id}`,
    ban: (id: string) => `/admin/users/${id}/ban`,
    unban: (id: string) => `/admin/users/${id}/unban`,
    plan: (id: string) => `/admin/users/${id}/plan`,
    bulkBan: '/admin/users/bulk/ban',
    bulkUnban: '/admin/users/bulk/unban',
    bulkDelete: '/admin/users/bulk/delete',
  },
  
  // Feature Flags
  featureFlags: {
    list: '/admin/feature-flags',
    toggle: (id: string) => `/admin/feature-flags/${id}/toggle`,
    bulkToggle: '/admin/feature-flags/bulk/toggle',
  },
  
  // Audit Logs
  auditLogs: {
    list: '/admin/audit',
    create: '/admin/audit',
  },
  
  // Infrastructure
  infrastructure: {
    vmStats: '/admin/infrastructure/vm-stats',
    vmInstances: '/admin/infrastructure/vms',
    vmRestart: (id: string) => `/admin/infrastructure/vms/${id}/restart`,
    vmStop: (id: string) => `/admin/infrastructure/vms/${id}/stop`,
    heatmap: '/admin/infrastructure/heatmap',
  },
  
  // Analytics
  analytics: {
    dashboard: '/admin/analytics/dashboard',
    usage: '/admin/analytics/usage',
    tokenTree: '/admin/analytics/token-tree',
    metrics: '/admin/analytics/metrics',
  },
} as const;

/**
 * Check if running in development mode
 */
export const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Check if running in production mode
 */
export const isProduction = process.env.NODE_ENV === 'production';

/**
 * App configuration
 */
export const APP_CONFIG = {
  // Session
  session: {
    cookieName: 'admin-token',
    maxAge: 60 * 60 * 24, // 24 hours
  },
  
  // Pagination defaults
  pagination: {
    defaultPageSize: 20,
    maxPageSize: 100,
  },
  
  // Refresh intervals (in milliseconds)
  refreshIntervals: {
    realTimeMetrics: 5000,
    dashboardMetrics: 30000,
    vmStats: 10000,
  },
} as const;
