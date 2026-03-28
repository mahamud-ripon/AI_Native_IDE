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
      // 404 = file does not exist; any other response (200 or 500 from S3 failure) = file exists in DB
      return res.status !== 404;
    } catch {
      // Network error — assume file might exist to avoid spurious create attempts
      return false;
    }
  }

  async readFile(filePath: string, _options?: ReadFileOptions): Promise<string> {
    const normalizedPath = filePath.replace(/^\.?\//, '');
    
    // Safety check: if AI tries to read root or a folder, guide it to list_files
    if (normalizedPath === '' || normalizedPath === '.' || filePath.endsWith('/')) {
      throw new Error(`Path '${filePath}' is a directory. To explore directory contents, please use the 'list_files' tool instead.`);
    }

    const performRead = async () => {
      const url = `${this.baseUrl}/files/content?path=${encodeURIComponent(normalizedPath)}`;
      return fetch(url, { headers: this.headers });
    };

    let res = await performRead();

    // If 404, retry once after a short delay (handles DB sync lag for newly created files)
    if (res.status === 404) {
      console.log(`[RemoteWorkspaceFS] File ${normalizedPath} not found in DB, retrying once...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      res = await performRead();
    }

    if (res.status === 404) {
      throw new FileNotFoundError(normalizedPath);
    }
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[RemoteWorkspaceFS] Read error: ${res.status} ${errorText}`);
      throw new Error(`Failed to read file ${normalizedPath}: ${res.status}. If you are looking for a directory, use list_files.`);
    }

    const data = await res.json() as { content?: string };
    return data.content ?? '';
  }

  async writeFile(filePath: string, content: string, _options?: WriteFileOptions): Promise<void> {
    const normalizedPath = filePath.replace(/^\.?\//, '');

    // Prefer updating existing files first. This avoids noisy POST failures in
    // project-service when the agent intentionally overwrites files like package.json.
    const existingFileId = await this.getFileId(normalizedPath);
    if (existingFileId) {
      const updateRes = await fetch(`${this.baseUrl}/files/${existingFileId}`, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({ content }),
      });
      if (!updateRes.ok) {
        throw new Error(`Failed to update file ${normalizedPath}: ${updateRes.status}`);
      }
      return;
    }

    await this.ensureDirectory(normalizedPath);

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

    if (createRes.ok) {
      return;
    }

    if (createRes.status === 409 || createRes.status === 400) {
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

  /**
   * Delete a file from the remote project via project-service API.
   * Looks up the file by path, then sends DELETE /files/{fileId}.
   * If the file is already gone, it returns success (idempotent).
   */
  async deleteFile(filePath: string): Promise<void> {
    const normalizedPath = filePath.replace(/^\.?\//, '');
    let fileId: string | null = null;
    
    try {
      fileId = await this.getFileId(normalizedPath);
    } catch (e) {
      // If we can't look it up, treat as already deleted
      console.warn(`[RemoteWorkspaceFS] Could not lookup fileId for ${normalizedPath}, assuming deleted:`, e);
      return;
    }

    if (!fileId) {
      // File already gone — success (idempotent)
      console.log(`[RemoteWorkspaceFS] File ${normalizedPath} not found during delete, returning success.`);
      return;
    }

    const res = await fetch(`${this.baseUrl}/files/${fileId}`, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to delete file ${normalizedPath}: ${res.status} ${body}`);
    }
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
      const res = await fetch(
        `${this.baseUrl}/files/content?path=${encodeURIComponent(normalizedPath)}`,
        { headers: this.headers }
      );
      if (res.ok) {
        const body = await res.json() as { data?: { fileId?: string } };
        return body.data?.fileId ?? null;
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
