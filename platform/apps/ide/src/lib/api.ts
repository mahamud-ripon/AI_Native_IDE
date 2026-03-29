/**
 * API Client for Backend Services
 * 
 * Handles all HTTP communication with backend services.
 * Includes automatic JWT refresh, error handling, and request tracing.
 * 
 * Base URLs (configured via environment):
 * - VITE_API_GATEWAY_URL — Main API gateway
 * - VITE_WS_URL — WebSocket gateway
 * - VITE_PROJECT_SERVICE_URL — Project service
 * - VITE_AI_SERVICE_URL — AI service
 */

interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string>;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  trace_id?: string;
}

interface RequestConfig extends RequestInit {
  skipAuth?: boolean;
  traceId?: string;
}

import { apiConfig } from './apiConfig';
import { getAccessToken as getStoredToken, clearTokens as clearStoredTokens } from './auth';
import { toast } from 'sonner';

// ========================================
// Token Management
// ========================================

let accessToken: string | null = null;
let refreshTokenPromise: Promise<string> | null = null;

function getTokenFromStorage(): string | null {
  return getStoredToken();
}

function setTokenInStorage(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('access_token', token);
  } else {
    localStorage.removeItem('access_token');
  }
}

async function getAccessToken(): Promise<string | null> {
  if (accessToken) return accessToken;
  
  const stored = getTokenFromStorage();
  if (stored) {
    accessToken = stored;
    return stored;
  }
  
  return null;
}

async function refreshAccessToken(): Promise<string> {
  if (refreshTokenPromise) {
    return refreshTokenPromise;
  }

  refreshTokenPromise = (async () => {
    try {
      const response = await fetch(`${apiConfig.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const data = await response.json() as ApiResponse<{ access_token: string }>;
      
      if (!data.success || !data.data) {
        throw new Error('Invalid refresh response');
      }

      accessToken = data.data.access_token;
      setTokenInStorage(accessToken);
      
      return accessToken;
    } finally {
      refreshTokenPromise = null;
    }
  })();

  return refreshTokenPromise;
}

function clearTokens(): void {
  accessToken = null;
  clearStoredTokens();
}

// ========================================
// API Client
// ========================================

async function request<T>(
  endpoint: string,
  config: RequestConfig = {}
): Promise<ApiResponse<T>> {
  const { skipAuth = false, traceId, headers = {}, ...restConfig } = config;

  // Generate trace ID if not provided
  const requestTraceId = traceId || `req-${Math.random().toString(36).substring(2, 15)}`;

  // Build headers
  const requestHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    'X-Trace-ID': requestTraceId,
    ...headers,
  };

  // Add auth token if not skipped
  if (!skipAuth) {
    let token = await getAccessToken();
    
    // If no token and not skipped, try to refresh
    if (!token && typeof window !== 'undefined') {
      try {
        token = await refreshAccessToken();
      } catch (error) {
        // Refresh failed, user needs to login
        clearTokens();
        window.location.href = '/login';
        throw new Error('Authentication required');
      }
    }
    
    if (token) {
      (requestHeaders as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    const response = await fetch(`${apiConfig.baseUrl}${endpoint}`, {
      ...restConfig,
      headers: requestHeaders,
      credentials: 'include',
    });

    const data = await response.json() as ApiResponse<T>;

    if (!response.ok) {
      // Handle 401 - attempt refresh before giving up
      if (response.status === 401 && !skipAuth) {
        const errorCode = data.error?.code;
        const errorMessage = data.error?.message || '';
        const isTokenExpired = errorCode === 'TOKEN_EXPIRED' ||
                               errorMessage.includes('expired') ||
                               errorMessage.includes('Token expired');

        if (isTokenExpired) {
          // Try to refresh the token and retry the request once
          try {
            const newToken = await refreshAccessToken();
            // Retry the original request with the new token
            const retryHeaders = {
              ...requestHeaders,
              Authorization: `Bearer ${newToken}`,
            } as Record<string, string>;

            const retryResponse = await fetch(`${apiConfig.baseUrl}${endpoint}`, {
              ...restConfig,
              headers: retryHeaders,
              credentials: 'include',
            });

            const retryData = await retryResponse.json() as ApiResponse<T>;

            if (!retryResponse.ok) {
              // Refresh succeeded but retry still failed — force logout
              clearTokens();
              toast.error('Session expired. Please log in again.');
              window.location.href = '/login';
              throw new ApiRequestError(
                retryData.error?.message || 'Session expired',
                'TOKEN_EXPIRED',
                401
              );
            }

            return retryData;
          } catch (refreshError) {
            // Refresh itself failed — force logout
            if (refreshError instanceof ApiRequestError) throw refreshError;
            clearTokens();
            toast.error('Session expired. Please log in again.');
            window.location.href = '/login';
            throw new ApiRequestError('Session expired', 'TOKEN_EXPIRED', 401);
          }
        }

        // Non-expiry 401 (invalid token, missing claims, etc.) — force logout
        clearTokens();
        toast.error('Authentication failed. Please log in again.');
        window.location.href = '/login';
        throw new ApiRequestError('Authentication failed', 'AUTH_FAILED', 401);
      }

      throw new ApiRequestError(
        data.error?.message || 'Request failed',
        data.error?.code || 'UNKNOWN_ERROR',
        response.status,
        data.trace_id
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw error;
    }
    
    // Network error or other exception
    throw new ApiRequestError(
      error instanceof Error ? error.message : 'Network error',
      'NETWORK_ERROR',
      0
    );
  }
}

// ========================================
// Error Class
// ========================================

class ApiRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public traceId?: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

// ========================================
// API Methods
// ========================================

export const api = {
  // Auth
  auth: {
    login: (emailOrUsername: string, password: string) =>
      request<{ accessToken: string; user: any }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email_or_username: emailOrUsername, password }),
        skipAuth: true,
      }),
    
    register: (email: string, password: string, username: string) =>
      request<{ accessToken: string; user: any }>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, username }),
        skipAuth: true,
      }),
    
    logout: () => request('/api/v1/auth/logout', { method: 'POST' }),
    
    me: () => request<any>('/api/v1/auth/me'),
    
    refreshToken: () => refreshAccessToken(),
  },

  // Projects
  projects: {
    list: () => request<any[]>('/api/v1/projects'),
    
    get: (projectId: string) =>
      request<any>(`/api/v1/projects/${projectId}`),
    
    create: (data: { name: string; description?: string; template?: string }) =>
      request<any>('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    
    update: (projectId: string, data: Partial<{ name: string; description: string }>) =>
      request<any>(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    
    delete: (projectId: string) =>
      request(`/api/v1/projects/${projectId}`, { method: 'DELETE' }),
    
    // Files
    getFiles: (projectId: string) =>
      request<any[]>(`/api/v1/projects/${projectId}/files`),
    
    getFile: (projectId: string, fileId: string) =>
      request<any>(`/api/v1/projects/${projectId}/files/${fileId}`),
    
    createFile: (projectId: string, data: { path: string; content?: string }) =>
      request<any>(`/api/v1/projects/${projectId}/files`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    
    updateFile: (projectId: string, fileId: string, data: { content: string }) =>
      request<any>(`/api/v1/projects/${projectId}/files/${fileId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    
    deleteFile: (projectId: string, fileId: string) =>
      request(`/api/v1/projects/${projectId}/files/${fileId}`, { method: 'DELETE' }),
    
    // Git
    getGitStatus: (projectId: string) =>
      request<any>(`/api/v1/projects/${projectId}/git/status`),
    
    commit: (projectId: string, message: string) =>
      request<any>(`/api/v1/projects/${projectId}/git/commit`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    
    push: (projectId: string) =>
      request<any>(`/api/v1/projects/${projectId}/git/push`, {
        method: 'POST',
      }),
    
    pull: (projectId: string) =>
      request<any>(`/api/v1/projects/${projectId}/git/pull`, {
        method: 'POST',
      }),
  },

  // AI
  ai: {
    chat: (projectId: string, message: string, conversationId?: string) =>
      request<any>('/api/v1/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, message, conversation_id: conversationId }),
      }),
    
    generate: (projectId: string, prompt: string) =>
      request<any>('/api/v1/ai/generate', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, prompt }),
      }),
    
    getConversation: (conversationId: string) =>
      request<any>(`/api/v1/ai/conversations/${conversationId}`),
    
    listConversations: (projectId: string) =>
      request<any[]>(`/api/v1/projects/${projectId}/ai/conversations`),
  },

  // Execution
  execution: {
    run: (projectId: string, command: string) =>
      request<any>('/api/v1/execution/run', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, command }),
      }),
    
    getLogs: (sessionId: string) =>
      request<any>(`/api/v1/execution/sessions/${sessionId}/logs`),
  },

  // Storage
  storage: {
    upload: (file: File, projectId: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('project_id', projectId);
      
      return request<any>('/api/v1/storage/upload', {
        method: 'POST',
        body: formData,
        skipAuth: false,
      });
    },
    
    download: (fileId: string) =>
      request<any>(`/api/v1/storage/files/${fileId}/download`),
    
    delete: (fileId: string) =>
      request(`/api/v1/storage/files/${fileId}`, { method: 'DELETE' }),
  },

  // Utility
  health: () => request<{ status: string }>('/health'),
};

// ========================================
// Exports
// ========================================

export { apiConfig, ApiRequestError, clearTokens, getAccessToken };
export default api;
