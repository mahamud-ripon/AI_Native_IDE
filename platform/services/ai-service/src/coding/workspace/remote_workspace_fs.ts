/**
 * Remote Workspace File System
 *
 * Stores all files in S3/MinIO via the project-service API.
 * No local filesystem is used — files go directly to cloud storage.
 */

import { DiffEngine } from '../patch/index.js';
import {
  FileEntry,
  PatchResult,
  WorkspaceConfig,
  ReadFileOptions,
  WriteFileOptions,
  FileNotFoundError,
  WorkspaceSafetyError,
} from './workspace_types.js';

interface RemoteWorkspaceConfig {
  projectId: string;
  projectServiceUrl: string;
  internalApiKey: string;
  userId: string;
}

/**
 * Remote WorkspaceFS — all file operations go through project-service API → S3
 */
export class RemoteWorkspaceFS {
  private config: RemoteWorkspaceConfig;
  private diffEngine: DiffEngine | null = null;
  private rootPath: string;

  constructor(config: RemoteWorkspaceConfig) {
    this.config = config;
    this.rootPath = `/projects/${config.projectId}`;
  }

  setDiffEngine(engine: DiffEngine): void {
    this.diffEngine = engine;
  }

  getConfig(): { rootPath: string } {
    return { rootPath: this.rootPath };
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-internal-api-key': this.config.internalApiKey,
      'x-user-id': this.config.userId,
    };
  }

  private get baseUrl(): string {
    return `${this.config.projectServiceUrl}/api/v1/projects/${this.config.projectId}`;
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  async exists(filePath: string): Promise<boolean> {
    const normalizedPath = filePath.replace(/^\.?\//, '');
    try {
      const res = await fetch(
        `${this.baseUrl}/files/content?path=${encodeURIComponent(normalizedPath)}`,
        { headers: this.headers }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string, _options?: ReadFileOptions): Promise<string> {
    const normalizedPath = filePath.replace(/^\.?\//, '');
    const res = await fetch(
      `${this.baseUrl}/files/content?path=${encodeURIComponent(normalizedPath)}`,
      { headers: this.headers }
    );

    if (res.status === 404) {
      throw new FileNotFoundError(normalizedPath);
    }
    if (!res.ok) {
      throw new Error(`Failed to read file ${normalizedPath}: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as { content?: string };
    return data.content ?? '';
  }

  async writeFile(filePath: string, content: string, _options?: WriteFileOptions): Promise<void> {
    const normalizedPath = filePath.replace(/^\.?\//, '');

    // Try to create the file first; if it exists, update it
    const createRes = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        path: normalizedPath,
        content,
        language: this.detectLanguage(normalizedPath),
        isDirectory: false,
      }),
    });

    if (createRes.ok) return; // Created successfully

    if (createRes.status === 409 || createRes.status === 400) {
      // File already exists — get fileId then update
      const fileId = await this.getFileId(normalizedPath);
      if (fileId) {
        const updateRes = await fetch(`${this.baseUrl}/files/${fileId}`, {
          method: 'PUT',
          headers: this.headers,
          body: JSON.stringify({ content }),
        });
        if (!updateRes.ok) {
          throw new Error(`Failed to update file ${normalizedPath}: ${updateRes.status}`);
        }
        return;
      }
    }

    // If 404 for parent directory, create it first and retry
    if (createRes.status === 404) {
      await this.ensureDirectory(normalizedPath);
      // Retry create
      const retryRes = await fetch(`${this.baseUrl}/files`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          path: normalizedPath,
          content,
          language: this.detectLanguage(normalizedPath),
          isDirectory: false,
        }),
      });
      if (!retryRes.ok && retryRes.status !== 409) {
        throw new Error(`Failed to create file ${normalizedPath}: ${retryRes.status} ${await retryRes.text()}`);
      }
      return;
    }

    throw new Error(`Failed to write file ${normalizedPath}: ${createRes.status} ${await createRes.text()}`);
  }

  async listFiles(): Promise<FileEntry[]> {
    const res = await fetch(`${this.baseUrl}/tree`, {
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(`Failed to list files: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as { files?: Array<{ path: string; isDirectory: boolean; language?: string }> };
    return (data.files ?? []).map(f => ({
      path: f.path,
      type: f.isDirectory ? 'directory' as const : 'file' as const,
      size: 0,
      extension: f.path.split('.').pop() ?? '',
      lastModified: new Date(),
    }));
  }

  async applyPatch(patchContent: string): Promise<PatchResult> {
    if (!this.diffEngine) {
      throw new Error('Diff engine not configured');
    }

    // Parse the diff (stateless — no disk access)
    const parsed = this.diffEngine.parse(patchContent);
    const filesChanged: string[] = [];
    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;
    const errors: Array<{ file: string; line?: number; message: string; type: string }> = [];
    const warnings: string[] = [];

    for (const file of parsed.files) {
      const filePath = file.newPath || file.oldPath;
      if (!filePath) continue;

      try {
        switch (file.operation) {
          case 'create': {
            const content = (this.diffEngine as any).buildNewFileContent(file);
            await this.writeFile(filePath, content);
            filesChanged.push(filePath);
            totalLinesAdded += content.split('\n').length;
            break;
          }

          case 'modify': {
            let originalContent: string;
            try {
              originalContent = await this.readFile(filePath);
            } catch {
              throw new FileNotFoundError(filePath);
            }
            const newContent = (this.diffEngine as any).applyToFile(originalContent, file);
            await this.writeFile(filePath, newContent);
            filesChanged.push(filePath);
            totalLinesAdded += (this.diffEngine as any).countAddedLines(file);
            totalLinesRemoved += (this.diffEngine as any).countRemovedLines(file);
            break;
          }

          case 'delete': {
            const fileId = await this.getFileId(filePath);
            if (fileId) {
              await fetch(`${this.baseUrl}/files/${fileId}`, {
                method: 'DELETE',
                headers: this.headers,
              });
            }
            filesChanged.push(filePath);
            totalLinesRemoved += (this.diffEngine as any).countRemovedLines(file);
            break;
          }

          case 'rename': {
            if (!file.oldPath || !file.newPath) {
              throw new Error('Rename requires both old and new paths');
            }
            const content = await this.readFile(file.oldPath);
            await this.writeFile(file.newPath, content);
            const oldFileId = await this.getFileId(file.oldPath);
            if (oldFileId) {
              await fetch(`${this.baseUrl}/files/${oldFileId}`, {
                method: 'DELETE',
                headers: this.headers,
              });
            }
            filesChanged.push(file.newPath);
            break;
          }
        }
      } catch (error: any) {
        errors.push({
          file: filePath,
          message: error.message ?? 'Unknown error',
          type: 'apply_error',
        });
      }
    }

    return {
      success: errors.length === 0,
      filesChanged,
      linesAdded: totalLinesAdded,
      linesRemoved: totalLinesRemoved,
      linesModified: 0,
      errors: errors.map(e => ({ ...e, type: e.type as any })),
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getFileId(filePath: string): Promise<string | null> {
    const normalizedPath = filePath.replace(/^\.?\//, '');
    try {
      const files = await this.listFiles();
      const match = files.find(f => f.path === normalizedPath);
      // Need to get fileId from tree — fall back to content endpoint
      const res = await fetch(
        `${this.baseUrl}/files/content?path=${encodeURIComponent(normalizedPath)}`,
        { headers: this.headers }
      );
      if (res.ok) {
        const data = await res.json() as { fileId?: string };
        return data.fileId ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async ensureDirectory(filePath: string): Promise<void> {
    const parts = filePath.split('/');
    // Create each parent directory
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/');
      if (!dirPath) continue;
      try {
        await fetch(`${this.baseUrl}/files`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({
            path: dirPath,
            isDirectory: true,
          }),
        });
      } catch {
        // Directory may already exist — ignore
      }
    }
  }

  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
      html: 'html', css: 'css', scss: 'scss', json: 'json',
      md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'toml',
      sh: 'bash', bash: 'bash', sql: 'sql', graphql: 'graphql',
    };
    return langMap[ext] ?? 'plaintext';
  }
}

/**
 * Factory
 */
export function createRemoteWorkspace(config: RemoteWorkspaceConfig): RemoteWorkspaceFS {
  return new RemoteWorkspaceFS(config);
}
