const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface ProjectTemplate {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  language: string;
  framework: string | null;
  thumbnailUrl: string | null;
  useCount: number;
}

export interface CreateProjectPayload {
  name: string;
  template?: string;
  visibility: 'private' | 'public';
  description?: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: string;
  template: string | null;
  language: string | null;
  framework: string | null;
}

export const projectClient = {
  async listTemplates(): Promise<ProjectTemplate[]> {
    const res = await fetch(`${API_BASE}/templates`);
    if (!res.ok) throw new Error('Failed to load templates');
    const data = await res.json();
    return data.data?.templates ?? data.data ?? [];
  },

  async createProject(payload: CreateProjectPayload): Promise<Project> {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? 'Failed to create project');
    }
    const data = await res.json();
    return data.data;
  },
};
