/**
 * File System Client - Smart client that switches between IndexedDB (browser) and API (cloud)
 * Uses browserWorkspaceService for browser projects, HTTP API for cloud projects
 */

import { fileSystemClient as apiClient } from './fileSystemClient';
import { browserWorkspaceService } from '@/workspace/browserWorkspaceService';
import { syncQueue } from '@/storage/syncQueue';
import { useIDEStore } from '@/stores/ideStore';

export type ProjectType = 'browser' | 'cloud';

export interface FileSystemOptions {
  projectType?: ProjectType;
  projectId: string;
}

class SmartFileSystemClient {
  /**
   * Get the appropriate service based on project type
   */
  private getService(projectType: ProjectType) {
    return projectType === 'browser' ? browserWorkspaceService : apiClient;
  }

  /**
   * List directory contents
   */
  async listDirectory(
    projectId: string,
    dirPath: string = '/',
    projectType: ProjectType = 'cloud'
  ): Promise<any[]> {
    if (projectType === 'browser') {
      return browserWorkspaceService.listDirectory(projectId, dirPath);
    }
    return apiClient.listDirectory(projectId, dirPath);
  }

  /**
   * Read file content
   */
  async readFile(
    projectId: string,
    filePath: string,
    projectType: ProjectType = 'cloud'
  ): Promise<{ content: string; language?: string }> {
    if (projectType === 'browser') {
      const content = await browserWorkspaceService.readFile(projectId, filePath);
      if (content === null) {
        return { content: '' };
      }

      // Detect language from extension
      const ext = filePath.split('.').pop()?.toLowerCase();
      const languageMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        html: 'html',
        css: 'css',
        json: 'json',
        md: 'markdown',
      };

      return {
        content,
        language: languageMap[ext || ''] || 'plaintext',
      };
    }
    return apiClient.readFile(projectId, filePath);
  }

  /**
   * Write file content - auto-queues for sync on browser projects
   */
  async writeFile(
    projectId: string,
    filePath: string,
    content: string,
    projectType: ProjectType = 'cloud'
  ): Promise<{ success: boolean; error?: string; warning?: string }> {
    if (projectType === 'browser') {
      // Write to IndexedDB
      const result = await browserWorkspaceService.writeFile(projectId, filePath, content);
      
      if (result.success) {
        // Queue for cloud sync
        await syncQueue.queueOperation(projectId, 'update', filePath, content);
      }
      
      return result;
    }
    
    // Cloud project - use API
    const result = await apiClient.writeFile(projectId, filePath, content);
    return { success: result.success, error: result.message };
  }

  /**
   * Create a new file
   */
  async createFile(
    projectId: string,
    filePath: string,
    content: string = '',
    projectType: ProjectType = 'cloud'
  ): Promise<{ success: boolean; error?: string }> {
    if (projectType === 'browser') {
      const result = await browserWorkspaceService.writeFile(projectId, filePath, content);
      
      if (result.success) {
        await syncQueue.queueOperation(projectId, 'create', filePath, content);
      }
      
      return { success: result.success, error: result.error };
    }
    
    const result = await apiClient.createFile(projectId, filePath, content);
    return { success: result.success, error: result.message };
  }

  /**
   * Create a new directory
   */
  async createDirectory(
    projectId: string,
    dirPath: string,
    projectType: ProjectType = 'cloud'
  ): Promise<{ success: boolean; error?: string }> {
    if (projectType === 'browser') {
      try {
        await browserWorkspaceService.createDirectory(projectId, dirPath);
        await syncQueue.queueOperation(projectId, 'create', dirPath);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
    
    const result = await apiClient.createDirectory(projectId, dirPath);
    return { success: result.success, error: result.message };
  }

  /**
   * Delete a file or directory
   */
  async deleteFile(
    projectId: string,
    filePath: string,
    projectType: ProjectType = 'cloud'
  ): Promise<{ success: boolean; error?: string }> {
    if (projectType === 'browser') {
      try {
        await browserWorkspaceService.deleteFile(projectId, filePath);
        await syncQueue.queueOperation(projectId, 'delete', filePath);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
    
    const result = await apiClient.deleteFile(projectId, filePath);
    return { success: result.success, error: result.message };
  }

  /**
   * Rename/move a file
   */
  async renameFile(
    projectId: string,
    oldPath: string,
    newPath: string,
    projectType: ProjectType = 'cloud'
  ): Promise<{ success: boolean; error?: string }> {
    if (projectType === 'browser') {
      const result = await browserWorkspaceService.renameFile(projectId, oldPath, newPath);
      
      if (result.success) {
        // Queue delete for old path, create for new path
        await syncQueue.queueOperation(projectId, 'delete', oldPath);
        const content = await browserWorkspaceService.readFile(projectId, newPath);
        await syncQueue.queueOperation(projectId, 'create', newPath, content || '');
      }
      
      return result;
    }
    
    const result = await apiClient.renameFile(projectId, oldPath, newPath);
    return { success: result.success, error: result.message };
  }

  /**
   * Get project snapshot for WebContainer
   */
  async getSnapshot(
    projectId: string,
    projectType: ProjectType = 'cloud'
  ): Promise<Record<string, string>> {
    if (projectType === 'browser') {
      return browserWorkspaceService.getSnapshot(projectId);
    }
    
    // For cloud projects, fetch from API
    return apiClient.getSnapshot(projectId);
  }

  /**
   * Get project type from current IDE state
   */
  getProjectType(): ProjectType {
    return useIDEStore.getState().projectType;
  }

  /**
   * Create a new browser project
   */
  async createBrowserProject(name: string): Promise<{ id: string; name: string }> {
    const project = await browserWorkspaceService.createProject(name);
    return { id: project.id, name: project.name };
  }

  /**
   * Export browser project to cloud
   */
  async exportToCloud(
    projectId: string,
    cloudProjectId: string
  ): Promise<{ success: boolean; error?: string }> {
    return browserWorkspaceService.exportToCloud(projectId, cloudProjectId);
  }
}

// Singleton instance
export const smartFileSystemClient = new SmartFileSystemClient();

export default smartFileSystemClient;
