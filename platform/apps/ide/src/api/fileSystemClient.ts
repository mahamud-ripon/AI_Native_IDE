/**
 * File System API Client
 *
 * Handles all file operations against the backend API.
 * Supports CRUD operations, directory listing, and file watching.
 *
 * bolt.new approach: Every project is a cloud project with UUID.
 * WebContainer is the execution environment, not storage.
 * Files are stored in PostgreSQL (primary source of truth).
 */

import { apiConfig } from '../lib/apiConfig';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: string;
  children?: FileEntry[];
}

export interface FileContent {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  lastModified: string;
}

export interface FileOperation {
  success: boolean;
  path: string;
  message?: string;
}

class FileSystemClient {
  private baseUrl: string;

  constructor(baseUrl: string = apiConfig.baseUrl) {
    this.baseUrl = baseUrl;
  }

  private getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  /**
   * List directory contents
   */
  async listDirectory(projectId: string, _dirPath: string = '/'): Promise<FileEntry[]> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/projects/${projectId}/tree`,
      { headers: this.getAuthHeaders() }
    );

    // 404 = project has no files yet (new project) — return empty tree silently
    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      console.error('[FileSystemClient] listDirectory error:', response.statusText);
      return [];
    }

    const body = await response.json();

    // The backend returns a root node in body.data
    const rootNode = body.data;
    if (!rootNode || !rootNode.children) {
      return [];
    }

    // Recursively map FileTreeNode to FileEntry
    const mapNode = (node: any, parentPath: string = ''): FileEntry => {
      const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
      return {
        name: node.name,
        path: currentPath,
        type: node.isDirectory ? 'directory' : 'file',
        children: node.children ? node.children.map((c: any) => mapNode(c, currentPath)) : undefined,
      };
    };

    return rootNode.children.map((c: any) => mapNode(c, ''));
  }

  /**
   * Read file content
   */
  async readFile(projectId: string, filePath: string): Promise<FileContent> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`,
      { headers: this.getAuthHeaders() }
    );

    if (response.status === 404) {
      // File doesn't exist yet — expected for empty/new projects
      throw new Error(`File not found: ${filePath}`);
    }

    if (!response.ok) {
      const msg = `Failed to read file: ${response.statusText}`;
      console.error('[FileSystemClient] readFile error:', msg);
      throw new Error(msg);
    }

    const body = await response.json();
    // Backend wraps response in { success, data, traceId }
    const data = body.data || body;
    return {
      path: data.path || filePath,
      content: data.content || '',
      encoding: 'utf-8',
      lastModified: data.lastEditedAt || new Date().toISOString(),
    };
  }

  /**
   * Write file content
   */
  async writeFile(
    projectId: string,
    filePath: string,
    content: string,
    options?: { branch?: string; commitMessage?: string; encoding?: 'utf-8' | 'base64' }
  ): Promise<FileOperation> {
    const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/files/sync`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        files: [{
          path: filePath,
          content,
          encoding: options?.encoding || 'utf-8',
          branch: options?.branch,
          commitMessage: options?.commitMessage,
        }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to write file: ${response.statusText}`);
    }

    const body = await response.json();
    const data = body.data || body;
    const result = Array.isArray(data.results) ? data.results[0] : null;

    return {
      success: result?.success ?? true,
      path: result?.path || filePath,
      message: result?.error,
    };
  }

  /**
   * Create a new file
   */
  async createFile(projectId: string, filePath: string, content: string = ''): Promise<FileOperation> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/projects/${projectId}/files`,
        {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ path: filePath, content, isDirectory: false }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to create file: ${response.statusText}`);
      }

      const body = await response.json();
      const data = body.data || body;
      return {
        success: body.success ?? true,
        path: data.path || filePath,
        message: body.error || data.message,
      };
    } catch (error) {
      console.error('[FileSystemClient] createFile error:', error);
      return {
        success: false,
        path: filePath,
        message: error instanceof Error ? error.message : 'Failed to create file',
      };
    }
  }

  /**
   * Create a new directory
   */
  async createDirectory(projectId: string, dirPath: string): Promise<FileOperation> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/projects/${projectId}/files`,
        {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ path: dirPath, isDirectory: true }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to create directory: ${response.statusText}`);
      }

      const body = await response.json();
      const data = body.data || body;
      return {
        success: body.success ?? true,
        path: data.path || dirPath,
        message: body.error || data.message,
      };
    } catch (error) {
      console.error('[FileSystemClient] createDirectory error:', error);
      return {
        success: false,
        path: dirPath,
        message: error instanceof Error ? error.message : 'Failed to create directory',
      };
    }
  }

  /**
   * Delete a file or directory
   */
  async deleteFile(projectId: string, filePath: string): Promise<FileOperation> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/projects/${projectId}/files?path=${encodeURIComponent(filePath)}`,
        {
          method: 'DELETE',
          headers: this.getAuthHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to delete file: ${response.statusText}`);
      }

      const body = await response.json();
      const data = body.data || body;
      return {
        success: body.success ?? true,
        path: data.path || filePath,
        message: body.error || data.message,
      };
    } catch (error) {
      console.error('[FileSystemClient] deleteFile error:', error);
      return {
        success: false,
        path: filePath,
        message: error instanceof Error ? error.message : 'Failed to delete file',
      };
    }
  }

  /**
   * Rename/move a file
   */
  async renameFile(projectId: string, oldPath: string, newPath: string): Promise<FileOperation> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/projects/${projectId}/files/rename`,
        {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ oldPath, newPath }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to rename file: ${response.statusText}`);
      }

      const body = await response.json();
      const data = body.data || body;
      return {
        success: body.success ?? true,
        path: data.path || newPath,
        message: body.error || data.message,
      };
    } catch (error) {
      console.error('[FileSystemClient] renameFile error:', error);
      return {
        success: false,
        path: newPath,
        message: error instanceof Error ? error.message : 'Failed to rename file',
      };
    }
  }

  /**
   * Apply AI patches to multiple files
   * bolt.new approach: Always use backend API
   */
  async applyAiPatches(projectId: string, patches: Array<{ path: string; content: string }>): Promise<{ applied: string[]; failed: string[]; error?: string }> {
    try {
      // Use /sync endpoint which is the actual batch endpoint in project-service
      const response = await fetch(`${this.baseUrl}/api/v1/projects/${projectId}/files/sync`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ files: patches }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Failed to apply AI patches: ${errorData.message || response.statusText}`);
      }

      const body = await response.json();
      const data = body.data || body;
      const results: Array<{ path: string; success: boolean }> = data.results || [];
      const applied = results.filter(r => r.success).map(r => r.path);
      const failed = results.filter(r => !r.success).map(r => r.path);
      return { applied, failed };
    } catch (error) {
      console.error('[FileSystemClient] applyAiPatches error:', error);
      return { applied: [], failed: patches.map(p => p.path), error: (error as Error).message };
    }
  }

  /**
   * Search files by content
   */
  async searchFiles(projectId: string, query: string): Promise<{ path: string; matches: string[] }[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/projects/${projectId}/files/search?q=${encodeURIComponent(query)}`,
        { headers: this.getAuthHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Failed to search files: ${response.statusText}`);
      }

      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error('[FileSystemClient] searchFiles error:', error);
      return [];
    }
  }

  /**
   * Get snapshot of all files for WebContainer mounting
   */
  async getSnapshot(projectId: string): Promise<Record<string, string>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/projects/${projectId}/snapshot`,
        { headers: this.getAuthHeaders() }
      );

      if (response.status === 404) {
        return {};
      }

      if (!response.ok) {
        throw new Error(`Failed to get snapshot: ${response.statusText}`);
      }

      const body = await response.json();
      const data = body.data || body;
      return data.files || {};
    } catch (error) {
      console.error('[FileSystemClient] getSnapshot error:', error);
      return {};
    }
  }

  // ============================================================================
  // MOCK DATA (for offline/development mode)
  // ============================================================================

  private getMockFileTree(): FileEntry[] {
    return [
      {
        name: '.bolt',
        path: '.bolt',
        type: 'directory',
        children: [],
      },
      {
        name: 'src',
        path: 'src',
        type: 'directory',
        children: [
          {
            name: 'components',
            path: 'src/components',
            type: 'directory',
            children: [
              { name: 'AddTodo.tsx', path: 'src/components/AddTodo.tsx', type: 'file' },
              { name: 'TodoList.tsx', path: 'src/components/TodoList.tsx', type: 'file' },
            ],
          },
          {
            name: 'lib',
            path: 'src/lib',
            type: 'directory',
            children: [
              { name: 'supabase.ts', path: 'src/lib/supabase.ts', type: 'file' },
            ],
          },
          { name: 'App.tsx', path: 'src/App.tsx', type: 'file' },
          { name: 'index.css', path: 'src/index.css', type: 'file' },
          { name: 'main.tsx', path: 'src/main.tsx', type: 'file' },
          { name: 'vite-env.d.ts', path: 'src/vite-env.d.ts', type: 'file' },
        ],
      },
      {
        name: 'supabase',
        path: 'supabase',
        type: 'directory',
        children: [],
      },
      { name: '.env', path: '.env', type: 'file' },
      { name: '.gitignore', path: '.gitignore', type: 'file' },
      { name: 'eslint.config.js', path: 'eslint.config.js', type: 'file' },
      { name: 'index.html', path: 'index.html', type: 'file' },
      { name: 'package.json', path: 'package.json', type: 'file' },
      { name: 'postcss.config.js', path: 'postcss.config.js', type: 'file' },
      { name: 'tailwind.config.js', path: 'tailwind.config.js', type: 'file' },
      { name: 'tsconfig.app.json', path: 'tsconfig.app.json', type: 'file' },
      { name: 'tsconfig.json', path: 'tsconfig.json', type: 'file' },
      { name: 'tsconfig.node.json', path: 'tsconfig.node.json', type: 'file' },
      { name: 'vite.config.ts', path: 'vite.config.ts', type: 'file' },
    ];
  }

  private getMockFileContent(filePath: string): string {
    const mockContents: Record<string, string> = {
      'src/App.tsx': `import { useEffect, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { supabase, type Todo } from './lib/supabase';
import { AddTodo } from './components/AddTodo';
import { TodoList } from './components/TodoList';

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTodos();
  }, []);

  const fetchTodos = async () => {
    try {
      const { data, error } = await supabase
        .from('todos')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTodos(data || []);
    } catch (error) {
      console.error('Error fetching todos:', error);
    } finally {
      setLoading(false);
    }
  };

  const addTodo = async (title: string) => {
    try {
      const { data, error } = await supabase
        .from('todos')
        .insert([{ title, completed: false }])
        .select()
        .single();

      if (error) throw error;
      setTodos(prev => [data, ...prev]);
    } catch (error) {
      console.error('Error adding todo:', error);
    }
  };

  const toggleTodo = async (id: string, completed: boolean) => {
    try {
      const { error } = await supabase
        .from('todos')
        .update({ completed })
        .eq('id', id);

      if (error) throw error;
      setTodos(prev => prev.map(t => t.id === id ? { ...t, completed } : t));
    } catch (error) {
      console.error('Error updating todo:', error);
    }
  };

  const deleteTodo = async (id: string) => {
    try {
      const { error } = await supabase
        .from('todos')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setTodos(prev => prev.filter(t => t.id !== id));
    } catch (error) {
      console.error('Error deleting todo:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <CheckSquare className="h-8 w-8 text-emerald-400" />
          <h1 className="text-3xl font-bold text-white">Todo App</h1>
        </div>
        <AddTodo onAdd={addTodo} />
        {loading ? (
          <div className="text-slate-400 text-center py-8">Loading...</div>
        ) : (
          <TodoList todos={todos} onToggle={toggleTodo} onDelete={deleteTodo} />
        )}
      </div>
    </div>
  );
}

export default App;`,
      'src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}`,
      'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`,
      'package.json': `{
  "name": "todo-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "preview": "vite preview"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "lucide-react": "^0.344.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.56",
    "@types/react-dom": "^18.2.19",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "eslint": "^8.56.0",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.2.2",
    "vite": "^5.1.4"
  }
}`,
    };

    return mockContents[filePath] || `// ${filePath}\n// File content not available in offline mode\n`;
  }
}

export const fileSystemClient = new FileSystemClient();
export default fileSystemClient;
