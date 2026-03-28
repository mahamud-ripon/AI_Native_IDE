/**
 * File System DB - High-level file operations with size limits
 * Enforces soft/hard limits for files and projects
 */

import indexedDBClient, { FileRecord, ProjectRecord } from './indexedDBClient';

// Size limits in bytes
export const SIZE_LIMITS = {
  FREE: {
    FILE_SOFT: 4 * 1024 * 1024,      // 4MB warning
    FILE_HARD: 5 * 1024 * 1024,      // 5MB block
    PROJECT_SOFT: 80 * 1024 * 1024,  // 80MB warning
    PROJECT_HARD: 100 * 1024 * 1024, // 100MB block
    MAX_PROJECTS: 10,
  },
  PRO: {
    FILE_SOFT: 45 * 1024 * 1024,     // 45MB warning
    FILE_HARD: 50 * 1024 * 1024,     // 50MB block
    PROJECT_SOFT: 900 * 1024 * 1024, // 900MB warning
    PROJECT_HARD: 1024 * 1024 * 1024, // 1GB block
    MAX_PROJECTS: Infinity,
  },
};

type Tier = 'FREE' | 'PRO';

interface FileSizeCheck {
  allowed: boolean;
  warning?: string;
  error?: string;
  currentSize?: number;
  limitSize?: number;
}

interface ProjectSizeInfo {
  totalSize: number;
  fileCount: number;
  warning?: string;
}

class FileSystemDB {
  private tier: Tier = 'FREE'; // TODO: Get from user subscription

  setTier(tier: Tier): void {
    this.tier = tier;
  }

  getTier(): Tier {
    return this.tier;
  }

  // Compute SHA-256 hash for content
  private async computeHash(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Check if file size is within limits
  checkFileSize(content: string): FileSizeCheck {
    const size = new Blob([content]).size;
    const limits = SIZE_LIMITS[this.tier];

    if (size > limits.FILE_HARD) {
      return {
        allowed: false,
        error: `File size (${this.formatSize(size)}) exceeds ${this.formatSize(limits.FILE_HARD)} limit. Please upgrade to Pro for larger files.`,
        currentSize: size,
        limitSize: limits.FILE_HARD,
      };
    }

    if (size > limits.FILE_SOFT) {
      return {
        allowed: true,
        warning: `File size (${this.formatSize(size)}) is approaching the ${this.formatSize(limits.FILE_HARD)} limit.`,
        currentSize: size,
        limitSize: limits.FILE_SOFT,
      };
    }

    return { allowed: true, currentSize: size };
  }

  // Check project size
  async checkProjectSize(projectId: string): Promise<ProjectSizeInfo> {
    const files = await indexedDBClient.getProjectFiles(projectId);
    const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const limits = SIZE_LIMITS[this.tier];

    const info: ProjectSizeInfo = {
      totalSize,
      fileCount: files.length,
    };

    if (totalSize > limits.PROJECT_HARD) {
      info.warning = `Project size (${this.formatSize(totalSize)}) exceeds ${this.formatSize(limits.PROJECT_HARD)} limit.`;
    } else if (totalSize > limits.PROJECT_SOFT) {
      info.warning = `Project size (${this.formatSize(totalSize)}) is approaching the ${this.formatSize(limits.PROJECT_HARD)} limit.`;
    }

    return info;
  }

  // Format bytes to human readable
  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Create or update file
  async writeFile(
    projectId: string,
    path: string,
    content: string
  ): Promise<{ success: boolean; error?: string; warning?: string }> {
    try {
      // Check file size
      const sizeCheck = this.checkFileSize(content);
      if (!sizeCheck.allowed) {
        return { success: false, error: sizeCheck.error };
      }

      // Check project size
      const projectSize = await this.checkProjectSize(projectId);
      const newSize = projectSize.totalSize + (sizeCheck.currentSize || 0);
      const limits = SIZE_LIMITS[this.tier];

      if (newSize > limits.PROJECT_HARD) {
        return {
          success: false,
          error: `Project size limit exceeded. Current: ${this.formatSize(projectSize.totalSize)}, would be: ${this.formatSize(newSize)}. Limit: ${this.formatSize(limits.PROJECT_HARD)}`,
        };
      }

      // Compute hash
      const hash = await this.computeHash(content);

      // Save file
      const file: FileRecord = {
        projectId,
        path,
        content,
        size: sizeCheck.currentSize || 0,
        modifiedAt: Date.now(),
        hash,
        syncStatus: 'modified',
      };

      await indexedDBClient.saveFile(file);

      // Update project timestamp
      const project = await indexedDBClient.getProject(projectId);
      if (project) {
        project.updatedAt = Date.now();
        await indexedDBClient.saveProject(project);
      }

      return {
        success: true,
        warning: sizeCheck.warning || projectSize.warning,
      };
    } catch (error) {
      console.error('Failed to write file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Read file
  async readFile(projectId: string, path: string): Promise<string | null> {
    const file = await indexedDBClient.getFile(projectId, path);
    return file?.content || null;
  }

  // Delete file
  async deleteFile(projectId: string, path: string): Promise<void> {
    await indexedDBClient.deleteFile(projectId, path);

    // Update project timestamp
    const project = await indexedDBClient.getProject(projectId);
    if (project) {
      project.updatedAt = Date.now();
      await indexedDBClient.saveProject(project);
    }
  }

  // Get all files in project
  async getAllFiles(projectId: string): Promise<FileRecord[]> {
    return indexedDBClient.getProjectFiles(projectId);
  }

  // Get project snapshot (for WebContainer)
  async getSnapshot(projectId: string): Promise<Record<string, string>> {
    const files = await this.getAllFiles(projectId);
    const snapshot: Record<string, string> = {};
    
    for (const file of files) {
      if (file.syncStatus !== 'deleted') {
        snapshot[file.path] = file.content;
      }
    }
    
    return snapshot;
  }

  // Create directory (just metadata, no actual content)
  async createDirectory(projectId: string, path: string): Promise<void> {
    const dirRecord: FileRecord = {
      projectId,
      path: path.endsWith('/') ? path : path + '/',
      content: '',
      size: 0,
      modifiedAt: Date.now(),
      hash: '',
      syncStatus: 'synced',
    };
    
    await indexedDBClient.saveFile(dirRecord);
  }

  // List directory contents
  async listDirectory(projectId: string, dirPath: string = ''): Promise<FileRecord[]> {
    const allFiles = await this.getAllFiles(projectId);
    const prefix = dirPath ? (dirPath.endsWith('/') ? dirPath : dirPath + '/') : '';
    
    return allFiles.filter(f => {
      if (prefix === '') {
        // Root level - no slashes in path (except at end for dirs)
        const slashIndex = f.path.indexOf('/');
        return slashIndex === -1 || slashIndex === f.path.length - 1;
      }
      return f.path.startsWith(prefix) && f.path !== prefix;
    });
  }

  // Check if path exists
  async exists(projectId: string, path: string): Promise<boolean> {
    const file = await indexedDBClient.getFile(projectId, path);
    return !!file;
  }

  // Get file stats
  async getFileStats(projectId: string, path: string): Promise<Partial<FileRecord> | null> {
    const file = await indexedDBClient.getFile(projectId, path);
    if (!file) return null;
    
    return {
      size: file.size,
      modifiedAt: file.modifiedAt,
      hash: file.hash,
      syncStatus: file.syncStatus,
    };
  }

  // Rename file
  async renameFile(
    projectId: string,
    oldPath: string,
    newPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const file = await indexedDBClient.getFile(projectId, oldPath);
      if (!file) {
        return { success: false, error: 'File not found' };
      }

      // Delete old
      await indexedDBClient.deleteFile(projectId, oldPath);

      // Create new with same content
      const newFile: FileRecord = {
        ...file,
        path: newPath,
        modifiedAt: Date.now(),
        syncStatus: 'modified',
      };

      await indexedDBClient.saveFile(newFile);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Singleton instance
export const fileSystemDB = new FileSystemDB();

export default fileSystemDB;
