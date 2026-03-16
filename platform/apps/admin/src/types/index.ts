/**
 * TypeScript type definitions for Admin Panel
 */

// User types
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  status: 'active' | 'suspended' | 'banned';
  plan: 'free' | 'pro' | 'enterprise';
  createdAt: string;
  lastActiveAt: string;
  projectsCount: number;
  tokensUsed: number;
  tokensLimit: number;
}

export interface UserListResponse {
  users: User[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Metrics types
export interface MetricPoint {
  timestamp: string;
  value: number;
}

export interface MetricSeries {
  name: string;
  data: MetricPoint[];
  unit: string;
}

export interface DashboardMetrics {
  users: {
    total: number;
    active: number;
    newToday: number;
    growth: number;
    activeChange?: number;
  };
  projects: {
    total: number;
    active: number;
    createdToday: number;
    change?: number;
  };
  tokens: {
    used: number;
    limit: number;
    cached: number;
    costUsd: number;
    usageChange?: number;
    costChange?: number;
  };
  vms: {
    total: number;
    running: number;
    coldStarts: number;
    avgLatencyMs: number;
    runningChange?: number;
    latencyChange?: number;
    coldStartsChange?: number;
  };
  errors: {
    count24h: number;
    rate: number;
    topErrors: ApiError[];
    rateChange?: number;
  };
}

// Infrastructure types
export interface VmInstance {
  id: string;
  status: 'running' | 'stopped' | 'starting' | 'error';
  userId: string;
  projectId: string;
  cpuPercent: number;
  memoryMb: number;
  diskMb: number;
  startedAt: string;
  lastHeartbeat: string;
}

export interface VmPoolStats {
  total: number;
  running: number;
  stopped: number;
  error: number;
  avgCpu: number;
  avgMemory: number;
  coldStartAvgMs: number;
}

// Analytics types
export interface TokenUsageNode {
  name: string;
  value: number;
  children?: TokenUsageNode[];
}

export interface UsageAnalytics {
  hourly: MetricSeries[];
  daily: MetricSeries[];
  byAgent: Record<string, number>;
  byModel: Record<string, number>;
  byUser: TokenUsageNode;
}

// API Error types
export interface ApiError {
  code: string;
  message: string;
  count: number;
  lastOccurrence: string;
  service: string;
}

// Audit log types
export interface AuditLog {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  targetType: 'user' | 'project' | 'vm' | 'system';
  targetId: string;
  details: Record<string, unknown>;
  ipAddress: string;
  timestamp: string;
}

export interface AuditLogListResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

// WebSocket message types
export interface WsMessage<T = unknown> {
  type: 'metrics' | 'vm_status' | 'alert' | 'token_usage';
  timestamp: string;
  payload: T;
}

export interface WsMetricsPayload {
  cpu: number;
  memory: number;
  requests: number;
  errors: number;
  latency: number;
}

export interface WsAlertPayload {
  level: 'info' | 'warning' | 'critical';
  message: string;
  source: string;
  data?: Record<string, unknown>;
}

// Chart types
export interface ChartDataPoint {
  x: number | string;
  y: number;
  label?: string;
}

export interface TreemapNode {
  name: string;
  value: number;
  children?: TreemapNode[];
}

export interface HeatmapCell {
  x: number;
  y: number;
  value: number;
  label?: string;
}

// Filter and pagination types
export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface UserFilters extends PaginationParams {
  status?: User['status'];
  plan?: User['plan'];
  search?: string;
}

export interface DateRange {
  start: string;
  end: string;
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// Feature Flag types
export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetUsers?: string[];
  targetPlans?: ('free' | 'pro' | 'enterprise')[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface FeatureFlagListResponse {
  flags: FeatureFlag[];
  total: number;
}

export interface FeatureFlagUpdate {
  enabled?: boolean;
  rolloutPercentage?: number;
  targetUsers?: string[];
  targetPlans?: ('free' | 'pro' | 'enterprise')[];
}

// Project types
export interface Project {
  id: string;
  name: string;
  userId: string;
  status: 'active' | 'archived' | 'deleted';
  createdAt: string;
  updatedAt: string;
  tokensUsed: number;
  agentCount: number;
  lastActivityAt: string;
}

export interface ProjectListResponse {
  projects: Project[];
  total: number;
}

// Bulk operation result
export interface BulkOperationResult {
  success: boolean;
  succeeded: string[];
  failed: { id: string; error: string }[];
}
