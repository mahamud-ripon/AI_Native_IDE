# IDE API - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/api/`  
> **Tech Stack:** Axios + React Query + Zustand + Zod

---

## 1. Executive Summary

The API component provides centralized data fetching, caching, and state management for the IDE. It includes JWT token rotation, React Query integration, and Zustand stores.

---

## 2. Axios Client

### 2.1 API Client (src/api/client.ts)

```typescript
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://api-gateway:8000',
  timeout: 30000
});

// Request interceptor - add auth token
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = document.cookie
    .split('; ')
    .find(r => r.startsWith('session-token='))
    ?.split('=')[1];
  
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor - JWT rotation
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value: any) => void; reject: (reason?: any) => void }> = [];

const processQueue = (error: AxiosError | null, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }
      
      originalRequest._retry = true;
      isRefreshing = true;
      
      try {
        // Silent refresh
        const response = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/refresh`,
          {},
          { withCredentials: true }
        );
        
        const newToken = response.data.accessToken;
        processQueue(null, newToken);
        
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError as AxiosError, null);
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    
    return Promise.reject(error);
  }
);

export { api };
```

---

## 3. React Query Hooks

### 3.1 Project Hooks (src/api/hooks/useProject.ts)

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { z } from 'zod';

// DTO Schemas
export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Project = z.infer<typeof ProjectSchema>;

export const useProjects = () => {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/api/v1/projects').then(res => res.data),
    staleTime: 5 * 60 * 1000 // 5 minutes
  });
};

export const useProject = (id: string) => {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<Project>(`/api/v1/projects/${id}`).then(res => res.data),
    staleTime: 60 * 1000 // 1 minute
  });
};

export const useCreateProject = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      api.post<Project>('/api/v1/projects', data).then(res => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  });
};

export const useUpdateProject = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Project> }) =>
      api.patch<Project>(`/api/v1/projects/${id}`, data).then(res => res.data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
    }
  });
};
```

### 3.2 File Hooks (src/api/hooks/useFiles.ts)

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export const FileSchema = {
  id: z.string(),
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'directory']),
  content: z.string().optional()
};

export const useProjectFiles = (projectId: string) => {
  return useQuery({
    queryKey: ['project', projectId, 'files'],
    queryFn: () => api.get(`/api/v1/projects/${projectId}/files`).then(res => res.data),
    staleTime: 30 * 1000
  });
};

export const useFileContent = (projectId: string, fileId: string) => {
  return useQuery({
    queryKey: ['project', projectId, 'file', fileId],
    queryFn: () => api.get(`/api/v1/projects/${projectId}/files/${fileId}`).then(res => res.data),
    staleTime: 0 // Always fresh
  });
};

export const useSaveFile = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ projectId, fileId, content }: { projectId: string; fileId: string; content: string }) =>
      api.put(`/api/v1/projects/${projectId}/files/${fileId}`, { content }).then(res => res.data),
    onSuccess: (_, { projectId, fileId }) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'file', fileId] });
    }
  });
};
```

---

## 4. Zustand Stores

### 4.1 Editor Store (src/api/store/editorStore.ts)

```typescript
import { create } from 'zustand';

interface EditorTab {
  id: string;
  fileId: string;
  filePath: string;
  isDirty: boolean;
}

interface EditorState {
  activeTabId: string | null;
  tabs: EditorTab[];
  
  openTab: (fileId: string, filePath: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  markDirty: (tabId: string) => void;
  markClean: (tabId: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTabId: null,
  tabs: [],
  
  openTab: (fileId, filePath) => {
    const { tabs } = get();
    const existing = tabs.find(t => t.fileId === fileId);
    
    if (existing) {
      set({ activeTabId: existing.id });
    } else {
      const newTab: EditorTab = {
        id: `tab-${Date.now()}`,
        fileId,
        filePath,
        isDirty: false
      };
      set({ tabs: [...tabs, newTab], activeTabId: newTab.id });
    }
  },
  
  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const newTabs = tabs.filter(t => t.id !== tabId);
    set({
      tabs: newTabs,
      activeTabId: activeTabId === tabId ? newTabs[0]?.id || null : activeTabId
    });
  },
  
  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  
  markDirty: (tabId) => set(state => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, isDirty: true } : t)
  })),
  
  markClean: (tabId) => set(state => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, isDirty: false } : t)
  }))
}));
```

### 4.2 Terminal Store (src/api/store/terminalStore.ts)

```typescript
import { create } from 'zustand';

interface TerminalSession {
  id: string;
  projectId: string;
  isActive: boolean;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  
  addSession: (projectId: string) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  
  addSession: (projectId) => {
    const newSession: TerminalSession = {
      id: `term-${Date.now()}`,
      projectId,
      isActive: true
    };
    set(state => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: newSession.id
    }));
  },
  
  removeSession: (sessionId) => set(state => ({
    sessions: state.sessions.filter(s => s.id !== sessionId),
    activeSessionId: state.activeSessionId === sessionId 
      ? state.sessions[0]?.id || null 
      : state.activeSessionId
  })),
  
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId })
}));
```

---

## 5. Implementation Status

| Component | Status |
|-----------|--------|
| Axios Client | ✅ Complete |
| JWT Rotation | ✅ Complete |
| React Query Hooks | ✅ Complete |
| Zod Validation | ✅ Complete |
| Editor Store | ✅ Complete |
| Terminal Store | ✅ Complete |
| Failed Request Queue | ✅ Complete |
