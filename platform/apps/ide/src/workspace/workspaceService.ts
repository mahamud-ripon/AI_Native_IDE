import type { WorkspaceFileEntry } from './fileRegistry';
import { editorModelManager } from '../core/editor/modelManager';
import { ensureContainer } from '../core/runtime/webcontainerManager';

import { apiConfig } from '../lib/apiConfig';

const API_BASE = '/api/v1'; // Still useful for relative proxying
const FULL_API_BASE = apiConfig.baseUrl + '/api/v1';

export interface WorkspaceService {
  listFiles: (projectId: string) => Promise<WorkspaceFileEntry[]>;
  getSnapshot: (projectId: string) => Promise<Record<string, string>>;
  getFileContent: (projectId: string, path: string) => Promise<{ content: string; language?: string }>;
}

export function demoViteReactProjectFiles(): Record<string, string> {
  return {
    'package.json': JSON.stringify(
      {
        name: 'webcontainer-demo',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'vite --host 0.0.0.0 --port 3000',
          build: 'vite build',
          preview: 'vite preview --host 0.0.0.0 --port 3000'
        },
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0'
        },
        devDependencies: {
          '@vitejs/plugin-react': '^4.2.0',
          typescript: '^5.3.0',
          vite: '^5.1.0'
        }
      },
      null,
      2
    ),
    'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WebContainer Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()]
});
`,
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          useDefineForClassFields: true,
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'Bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true
        },
        include: ['src']
      },
      null,
      2
    ),
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>WebContainer Preview Running</h1>
      <p>Edit code in the IDE, then later we will sync changes into the container.</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`
  };
}

class LocalWorkspaceService implements WorkspaceService {
  async listFiles(_projectId: string): Promise<WorkspaceFileEntry[]> {
    try {
      // Read files from WebContainer filesystem
      const container = await ensureContainer();
      const files: WorkspaceFileEntry[] = [];
      
      // Get the base working directory from WebContainer
      const baseDir = await container.fs.readdir('.').then(() => '.').catch(() => '');
      
      // Recursively scan directory
      const scanDir = async (dir: string, basePath: string = '') => {
        try {
          const entries = await container.fs.readdir(dir || '.', { withFileTypes: true });
          
          for (const entry of entries) {
            const name = entry.name;
            const fullPath = basePath ? `${basePath}/${name}` : name;
            
            // Skip node_modules, hidden files, and common non-source directories
            if (name === 'node_modules' || name.startsWith('.') || name === 'dist' || name === 'build') {
              continue;
            }
            
            if (entry.isDirectory()) {
              await scanDir(dir ? `${dir}/${name}` : name, fullPath);
            } else if (entry.isFile()) {
              // Only include source code files
              const ext = name.split('.').pop()?.toLowerCase();
              if (ext && ['tsx', 'ts', 'jsx', 'js', 'html', 'css', 'json', 'md', 'mjs', 'cjs'].includes(ext)) {
                files.push({ path: fullPath });
              }
            }
          }
        } catch (e) {
          // Directory might not exist yet - that's ok
        }
      };
      
      // Scan root directory
      await scanDir('');
      
      return files;
    } catch (e) {
      console.warn('Failed to read WebContainer files:', e);
      return [];
    }
  }

  async getSnapshot(_projectId: string): Promise<Record<string, string>> {
    try {
      // Read all files from WebContainer
      const container = await ensureContainer();
      const files: Record<string, string> = {};
      
      const readDir = async (dir: string, basePath: string = '') => {
        try {
          const entries = await container.fs.readdir(dir, { withFileTypes: true });
          
          for (const entry of entries) {
            const name = entry.name;
            const fullPath = basePath ? `${basePath}/${name}` : name;
            
            // Skip node_modules, hidden files, and build directories
            if (name === 'node_modules' || name.startsWith('.') || name === 'dist' || name === 'build') {
              continue;
            }
            
            if (entry.isDirectory()) {
              await readDir(`${dir}/${name}`, fullPath);
            } else if (entry.isFile()) {
              const ext = name.split('.').pop()?.toLowerCase();
              if (ext && ['tsx', 'ts', 'jsx', 'js', 'html', 'css', 'json', 'md', 'mjs', 'cjs'].includes(ext)) {
                try {
                  const filePath = dir ? `${dir}/${name}` : name;
                  const content = await container.fs.readFile(filePath, 'utf-8');
                  files[fullPath] = content;
                } catch (e) {
                  // File might be binary or unreadable
                }
              }
            }
          }
        } catch (e) {
          // Directory might not exist
        }
      };
      
      await readDir('');
      
      return files;
    } catch (e) {
      console.warn('Failed to read WebContainer snapshot:', e);
      return {};
    }
  }

  async getFileContent(_projectId: string, path: string): Promise<{ content: string; language?: string }> {
    try {
      // First, try to get from Monaco Editor models (fastest, always available)
      const key = editorModelManager.key('', path);
      const fileModel = editorModelManager.get(key);
      
      if (!fileModel?.model) {
        // Model doesn't exist, try WebContainer
        throw new Error('Model not found');
      }
      
      const content = fileModel.model.getValue();
      const ext = path.split('.').pop()?.toLowerCase();
      const languageMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescript',
        'js': 'javascript',
        'jsx': 'javascript',
        'html': 'html',
        'css': 'css',
        'json': 'json',
        'md': 'markdown',
        'mjs': 'javascript',
        'cjs': 'javascript',
      };
      
      return {
        content,
        language: languageMap[ext || ''] || 'plaintext'
      };
    } catch (e) {
      // Model not found or error, try WebContainer
      console.debug('Model not available, trying WebContainer:', e);
    }
    
    // If not in editor, try WebContainer
    try {
      const container = await ensureContainer();
      
      // WebContainer paths don't have leading slash
      const wcPath = path.startsWith('/') ? path.substring(1) : path;
      
      const content = await container.fs.readFile(wcPath, 'utf-8');
      
      // Simple language detection based on extension
      const ext = path.split('.').pop()?.toLowerCase();
      const languageMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescript',
        'js': 'javascript',
        'jsx': 'javascript',
        'html': 'html',
        'css': 'css',
        'json': 'json',
        'md': 'markdown',
        'mjs': 'javascript',
        'cjs': 'javascript',
      };
      
      return {
        content,
        language: languageMap[ext || ''] || 'plaintext'
      };
    } catch (e) {
      console.warn('Failed to read from WebContainer:', e);
      return {
        content: '',
        language: 'plaintext'
      };
    }
  }
}

/**
 * RemoteWorkspaceService - connects to backend project-service
 * Replaces mock data with real cloud workspace
 */
class RemoteWorkspaceService implements WorkspaceService {
  private getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async listFiles(projectId: string): Promise<WorkspaceFileEntry[]> {
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/tree`, {
        headers: this.getAuthHeaders()
      });
      
      if (!response.ok) {
        console.warn('Failed to fetch file tree');
        return [];
      }
      
      const result = await response.json();
      
      // Convert tree format to flat list for now
      // TODO: Convert to tree structure with expand/collapse
      const files: WorkspaceFileEntry[] = [];
      
      const flattenTree = (node: { name: string; isDirectory: boolean; children?: any[] }, path: string = '') => {
        const fullPath = path ? `${path}/${node.name}` : node.name;
        if (node.isDirectory) {
          if (node.children) {
            node.children.forEach(child => flattenTree(child, fullPath));
          }
        } else {
          files.push({ path: fullPath });
        }
      };
      
      if (result.data?.children) {
        result.data.children.forEach((child: any) => flattenTree(child));
      }
      
      return files;
    } catch (error) {
      console.error('Error fetching file tree:', error);
      return [];
    }
  }

  async getSnapshot(projectId: string): Promise<Record<string, string>> {
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/snapshot`, {
        headers: this.getAuthHeaders(),
      });

      if (response.status === 404) {
        return {};
      }

      if (!response.ok) {
        throw new Error(`Failed to load snapshot: ${response.statusText}`);
      }

      const result = await response.json();
      return result.data?.files || {};
    } catch (error) {
      console.error('Error loading project snapshot:', error);
      return {};
    }
  }

  async getFileContent(projectId: string, path: string): Promise<{ content: string; language?: string }> {
    try {
      const encodedPath = encodeURIComponent(path);
      const response = await fetch(
        `${API_BASE}/projects/${projectId}/files/content?path=${encodedPath}`,
        { headers: this.getAuthHeaders() }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`);
      }
      
      const result = await response.json();
      return {
        content: result.data?.content || '',
        language: result.data?.language
      };
    } catch (error) {
      console.error('Error loading file content:', error);
      return { content: '' };
    }
  }
}

// Factory to get appropriate workspace service
// Returns BrowserWorkspaceService for browser projects
// Returns RemoteWorkspaceService for cloud projects
export async function getWorkspaceService(projectType: 'browser' | 'cloud'): Promise<WorkspaceService> {
  if (projectType === 'browser') {
    // Dynamic import to avoid circular dependencies
    const { browserWorkspaceService } = await import('./browserWorkspaceService');
    return browserWorkspaceService;
  }
  return remoteWorkspaceService;
}

// Export remote service for direct access
export const remoteWorkspaceService = new RemoteWorkspaceService();

// Default export for backwards compatibility
export const workspaceService: WorkspaceService = remoteWorkspaceService;
