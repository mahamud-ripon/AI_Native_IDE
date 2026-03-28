/**
 * Browser Workspace Service - IndexedDB-based workspace for browser projects
 * Same interface as RemoteWorkspaceService but uses local storage
 */

import { fs, indexedDBClient, type FileRecord } from '@/storage';
import type { FileNode } from '@/stores/ideStore';

export interface WorkspaceFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  content?: string;
  size?: number;
  modifiedAt?: number;
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors: string[];
}

class BrowserWorkspaceService {
  // Get complete file tree for a project
  async getFileTree(projectId: string): Promise<FileNode[]> {
    const files = await fs.getAllFiles(projectId);
    return this.buildFileTree(files);
  }

  // Build hierarchical tree from flat file list
  private buildFileTree(files: FileRecord[]): FileNode[] {
    const root: FileNode[] = [];
    const map = new Map<string, FileNode>();

    // First pass: create all nodes
    for (const file of files) {
      if (file.syncStatus === 'deleted') continue;

      const parts = file.path.split('/').filter(Boolean);
      const name = parts[parts.length - 1] || file.path;
      const isDirectory = file.path.endsWith('/');

      const node: FileNode = {
        id: `${file.projectId}:${file.path}`,
        name,
        path: file.path,
        type: isDirectory ? 'directory' : 'file',
        children: isDirectory ? [] : undefined,
        isExpanded: false,
      };

      map.set(file.path, node);
    }

    // Second pass: build hierarchy
    for (const [path, node] of map) {
      const parentPath = path.substring(0, path.lastIndexOf('/') + 1);
      
      if (parentPath && parentPath !== '/') {
        const parent = map.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(node);
        }
      } else {
        root.push(node);
      }
    }

    return this.sortFileTree(root);
  }

  // Sort tree: directories first, then alphabetically
  private sortFileTree(nodes: FileNode[]): FileNode[] {
    nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    for (const node of nodes) {
      if (node.children) {
        this.sortFileTree(node.children);
      }
    }

    return nodes;
  }

  // Get file content
  async readFile(projectId: string, path: string): Promise<string | null> {
    return fs.readFile(projectId, path);
  }

  // Write file
  async writeFile(
    projectId: string,
    path: string,
    content: string
  ): Promise<{ success: boolean; error?: string; warning?: string }> {
    return fs.writeFile(projectId, path, content);
  }

  // Delete file
  async deleteFile(projectId: string, path: string): Promise<void> {
    await fs.deleteFile(projectId, path);
  }

  // Create directory
  async createDirectory(projectId: string, path: string): Promise<void> {
    await fs.createDirectory(projectId, path);
  }

  // Rename/move file
  async renameFile(
    projectId: string,
    oldPath: string,
    newPath: string
  ): Promise<{ success: boolean; error?: string }> {
    return fs.renameFile(projectId, oldPath, newPath);
  }

  // Get snapshot for WebContainer
  async getSnapshot(projectId: string): Promise<Record<string, string>> {
    return fs.getSnapshot(projectId);
  }

  // List directory contents
  async listDirectory(projectId: string, dirPath: string = ''): Promise<WorkspaceFile[]> {
    const records = await fs.listDirectory(projectId, dirPath);
    return records.map(r => ({
      name: r.path.split('/').pop() || r.path,
      path: r.path,
      type: r.path.endsWith('/') ? 'directory' : 'file',
      size: r.size,
      modifiedAt: r.modifiedAt,
    }));
  }

  // Check if file exists
  async exists(projectId: string, path: string): Promise<boolean> {
    return fs.exists(projectId, path);
  }

  // Get file stats
  async getFileStats(projectId: string, path: string): Promise<Partial<FileRecord> | null> {
    return fs.getFileStats(projectId, path);
  }

  // Get project metadata
  async getProject(projectId: string): Promise<{
    id: string;
    name: string;
    type: 'browser' | 'cloud';
    cloudProjectId?: string;
    lastSyncedAt?: number;
  } | null> {
    const project = await indexedDBClient.getProject(projectId);
    if (!project) return null;

    return {
      id: project.id,
      name: project.name,
      type: project.type,
      cloudProjectId: project.cloudProjectId,
      lastSyncedAt: project.lastSyncedAt,
    };
  }

  // Create new browser project
  async createProject(
    name: string,
    id?: string
  ): Promise<{ id: string; name: string; type: 'browser' }> {
    const projectId = id || `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    await indexedDBClient.saveProject({
      id: projectId,
      name,
      type: 'browser',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncStatus: 'synced',
    });

    return { id: projectId, name, type: 'browser' };
  }

  // Delete project and all its files
  async deleteProject(projectId: string): Promise<void> {
    await indexedDBClient.deleteProject(projectId);
  }

  // Export project to cloud
  async exportToCloud(
    projectId: string,
    cloudProjectId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const project = await indexedDBClient.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Update project to reference cloud
      await indexedDBClient.saveProject({
        ...project,
        cloudProjectId,
        type: 'cloud',
        syncStatus: 'synced',
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      };
    }
  }

  // Get all browser projects
  async getAllProjects(): Promise<{
    id: string;
    name: string;
    type: 'browser';
    updatedAt: number;
  }[]> {
    const projects = await indexedDBClient.getAll<{
      id: string;
      name: string;
      type: 'browser' | 'cloud';
      updatedAt: number;
    }>('projects', 'byType', 'browser');

    return projects.map(p => ({
      id: p.id,
      name: p.name,
      type: 'browser',
      updatedAt: p.updatedAt,
    }));
  }

  // Get storage stats
  async getStorageStats(projectId: string): Promise<{
    fileCount: number;
    totalSize: number;
    warning?: string;
  }> {
    const info = await fs.checkProjectSize(projectId);
    return {
      fileCount: info.fileCount,
      totalSize: info.totalSize,
      warning: info.warning,
    };
  }

  // Required by WorkspaceService interface
  async listFiles(projectId: string): Promise<WorkspaceFile[]> {
    const files = await fs.getAllFiles(projectId);
    return files
      .filter(f => f.syncStatus !== 'deleted')
      .map(f => ({
        name: f.path.split('/').pop() || f.path,
        path: f.path,
        type: f.path.endsWith('/') ? 'directory' : 'file',
        size: f.size,
        modifiedAt: f.modifiedAt,
      }));
  }

  async getFileContent(
    projectId: string,
    path: string
  ): Promise<{ content: string; language?: string }> {
    const content = await fs.readFile(projectId, path);
    if (content === null) {
      return { content: '' };
    }

    // Detect language from extension
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      html: 'html',
      css: 'css',
      json: 'json',
      md: 'markdown',
      mjs: 'javascript',
      cjs: 'javascript',
    };

    return {
      content,
      language: languageMap[ext || ''] || 'plaintext',
    };
  }
}

// Singleton instance
export const browserWorkspaceService = new BrowserWorkspaceService();

export default browserWorkspaceService;
