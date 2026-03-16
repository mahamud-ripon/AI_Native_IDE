/**
 * API Client for Admin Panel
 * 
 * Centralized fetch wrapper with auth headers,
 * error handling, and type safety.
 */

import type { ApiResponse, UserListResponse, UserFilters, DashboardMetrics, VmPoolStats, UsageAnalytics, AuditLogListResponse, FeatureFlagListResponse, FeatureFlagUpdate, MetricSeries, HeatmapCell } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface FetchOptions extends RequestInit {
  token?: string;
}

/**
 * Base fetch wrapper with error handling
 */
async function apiFetch<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<ApiResponse<T>> {
  const { token, ...fetchOptions } = options;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  
  // Add admin API key for server-side requests
  if (typeof window === 'undefined' && process.env.ADMIN_API_KEY) {
    headers['X-Admin-API-Key'] = process.env.ADMIN_API_KEY;
  }
  
  // Add bearer token if provided
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...fetchOptions,
      headers,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: response.status.toString(),
          message: errorData.message || response.statusText,
        },
      };
    }
    
    const data = await response.json();
    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
      },
    };
  }
}

// ============================================
// Dashboard Metrics API
// ============================================

export async function getDashboardMetrics(): Promise<ApiResponse<DashboardMetrics>> {
  return apiFetch<DashboardMetrics>('/api/v1/admin/metrics/dashboard');
}

export async function getMetricsHistory(
  metric: string,
  period: 'hour' | 'day' | 'week' = 'day'
): Promise<ApiResponse<{ metric: string; data: { timestamp: string; value: number }[] }>> {
  return apiFetch(`/api/v1/admin/metrics/${metric}?period=${period}`);
}

export async function getMetricSeries(): Promise<ApiResponse<{ series: MetricSeries[] }>> {
  return apiFetch('/api/v1/admin/metrics/series');
}

export async function getVmHeatmap(): Promise<ApiResponse<{ heatmap: HeatmapCell[][] }>> {
  return apiFetch('/api/v1/admin/infrastructure/vms/heatmap');
}

// ============================================
// User Management API
// ============================================

export async function getUsers(
  filters: UserFilters,
  token?: string
): Promise<ApiResponse<UserListResponse>> {
  const params = new URLSearchParams({
    page: filters.page.toString(),
    pageSize: filters.pageSize.toString(),
  });
  
  if (filters.status) params.append('status', filters.status);
  if (filters.plan) params.append('plan', filters.plan);
  if (filters.search) params.append('search', filters.search);
  if (filters.sortBy) params.append('sortBy', filters.sortBy);
  if (filters.sortOrder) params.append('sortOrder', filters.sortOrder);
  
  return apiFetch<UserListResponse>(`/api/v1/admin/users?${params}`, { token });
}

export async function getUser(userId: string, token?: string) {
  return apiFetch<{ user: import('@/types').User }>(`/api/v1/admin/users/${userId}`, { token });
}

export async function getUserProjects(userId: string, token?: string) {
  return apiFetch<import('@/types').ProjectListResponse>(`/api/v1/admin/users/${userId}/projects`, { token });
}

export async function banUser(
  userId: string,
  reason: string,
  token?: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch(`/api/v1/admin/users/${userId}/ban`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    token,
  });
}

export async function unbanUser(
  userId: string,
  token?: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch(`/api/v1/admin/users/${userId}/unban`, {
    method: 'POST',
    token,
  });
}

export async function updateUserPlan(
  userId: string,
  plan: 'free' | 'pro' | 'enterprise',
  token?: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch(`/api/v1/admin/users/${userId}/plan`, {
    method: 'PATCH',
    body: JSON.stringify({ plan }),
    token,
  });
}

// ============================================
// Infrastructure API
// ============================================

export async function getVmPoolStats(): Promise<ApiResponse<VmPoolStats>> {
  return apiFetch<VmPoolStats>('/api/v1/admin/infrastructure/vms');
}

export async function getVmInstances(
  status?: 'running' | 'stopped' | 'error'
): Promise<ApiResponse<{ vms: import('@/types').VmInstance[] }>> {
  const params = status ? `?status=${status}` : '';
  return apiFetch(`/api/v1/admin/infrastructure/vms/instances${params}`);
}

export async function restartVm(vmId: string, token?: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch(`/api/v1/admin/infrastructure/vms/${vmId}/restart`, {
    method: 'POST',
    token,
  });
}

export async function stopVm(vmId: string, token?: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch(`/api/v1/admin/infrastructure/vms/${vmId}/stop`, {
    method: 'POST',
    token,
  });
}

// ============================================
// Analytics API
// ============================================

export async function getUsageAnalytics(
  period: '7d' | '30d' | '90d' = '7d'
): Promise<ApiResponse<UsageAnalytics>> {
  return apiFetch(`/api/v1/admin/analytics/usage?period=${period}`);
}

export async function getTokenUsageTree(): Promise<ApiResponse<{ tree: import('@/types').TokenUsageNode }>> {
  return apiFetch('/api/v1/admin/analytics/tokens/tree');
}

export async function getModelUsage(): Promise<ApiResponse<{ models: Record<string, number> }>> {
  return apiFetch('/api/v1/admin/analytics/models');
}

export async function getAgentUsage(): Promise<ApiResponse<{ agents: Record<string, number> }>> {
  return apiFetch('/api/v1/admin/analytics/agents');
}

// ============================================
// Audit Logs API
// ============================================

export async function getAuditLogs(
  page: number = 1,
  pageSize: number = 50,
  targetType?: string
): Promise<ApiResponse<AuditLogListResponse>> {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
  });
  
  if (targetType) params.append('targetType', targetType);
  
  return apiFetch(`/api/v1/admin/audit?${params}`);
}

export async function getAuditLog(logId: string): Promise<ApiResponse<{ log: import('@/types').AuditLog }>> {
  return apiFetch(`/api/v1/admin/audit/${logId}`);
}

// ============================================
// Feature Flags API
// ============================================

export async function getFeatureFlags(): Promise<ApiResponse<FeatureFlagListResponse>> {
  return apiFetch('/api/v1/admin/feature-flags');
}

export async function getFeatureFlag(flagId: string): Promise<ApiResponse<{ flag: import('@/types').FeatureFlag }>> {
  return apiFetch(`/api/v1/admin/feature-flags/${flagId}`);
}

export async function updateFeatureFlag(
  flagId: string,
  data: FeatureFlagUpdate,
  token?: string
): Promise<ApiResponse<{ flag: import('@/types').FeatureFlag }>> {
  return apiFetch(`/api/v1/admin/feature-flags/${flagId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    token,
  });
}

export async function toggleFeatureFlag(
  flagId: string,
  enabled: boolean,
  token?: string
): Promise<ApiResponse<{ flag: import('@/types').FeatureFlag }>> {
  return apiFetch(`/api/v1/admin/feature-flags/${flagId}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
    token,
  });
}

/**
 * Toggle multiple feature flags at once
 */
export async function bulkToggleFeatureFlags(
  flagIds: string[],
  enabled: boolean,
  token?: string
): Promise<ApiResponse<BulkOperationResult>> {
  return apiFetch('/api/v1/admin/feature-flags/bulk/toggle', {
    method: 'POST',
    body: JSON.stringify({ flagIds, enabled }),
    token,
  });
}

// ============================================
// Bulk Operations API
// ============================================

export interface BulkOperationResult {
  success: boolean;
  succeeded: string[];
  failed: { id: string; error: string }[];
}

/**
 * Ban multiple users at once
 */
export async function bulkBanUsers(
  userIds: string[],
  reason: string,
  token?: string
): Promise<ApiResponse<BulkOperationResult>> {
  return apiFetch('/api/v1/admin/users/bulk/ban', {
    method: 'POST',
    body: JSON.stringify({ userIds, reason }),
    token,
  });
}

/**
 * Unban multiple users at once
 */
export async function bulkUnbanUsers(
  userIds: string[],
  token?: string
): Promise<ApiResponse<BulkOperationResult>> {
  return apiFetch('/api/v1/admin/users/bulk/unban', {
    method: 'POST',
    body: JSON.stringify({ userIds }),
    token,
  });
}

/**
 * Delete multiple users at once
 */
export async function bulkDeleteUsers(
  userIds: string[],
  token?: string
): Promise<ApiResponse<BulkOperationResult>> {
  return apiFetch('/api/v1/admin/users/bulk/delete', {
    method: 'POST',
    body: JSON.stringify({ userIds }),
    token,
  });
}

/**
 * Stop multiple VMs at once
 */
export async function bulkStopVms(
  vmIds: string[],
  token?: string
): Promise<ApiResponse<BulkOperationResult>> {
  return apiFetch('/api/v1/admin/infrastructure/vms/bulk/stop', {
    method: 'POST',
    body: JSON.stringify({ vmIds }),
    token,
  });
}

/**
 * Restart multiple VMs at once
 */
export async function bulkRestartVms(
  vmIds: string[],
  token?: string
): Promise<ApiResponse<BulkOperationResult>> {
  return apiFetch('/api/v1/admin/infrastructure/vms/bulk/restart', {
    method: 'POST',
    body: JSON.stringify({ vmIds }),
    token,
  });
}

/**
 * Archive multiple projects at once
 */
export async function bulkArchiveProjects(
  projectIds: string[],
  token?: string
): Promise<ApiResponse<BulkOperationResult>> {
  return apiFetch('/api/v1/admin/projects/bulk/archive', {
    method: 'POST',
    body: JSON.stringify({ projectIds }),
    token,
  });
}
