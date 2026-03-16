import type * as Monaco from 'monaco-editor';

import { languageFromPath } from './language';
import { editorKey, normalizeFilePath } from './editorKey';
import { workspaceService } from '../../workspace/workspaceService';

export interface EditorFileModel {
  uri: Monaco.Uri;
  model: Monaco.editor.ITextModel;
  language: string;
}

export interface EditorModelMetadata {
  projectId: string;
  filePath: string;
  language: string;
  createdAtMs: number;
  lastAccessedAtMs: number;
}

export class EditorModelManager {
  private models = new Map<string, EditorFileModel>();
  private metadata = new Map<string, EditorModelMetadata>();

  key(projectId: string, filePath: string): string {
    return editorKey(projectId, filePath);
  }

  getOrCreate(monaco: typeof Monaco, projectId: string, filePath: string): EditorFileModel {
    const normalizedPath = normalizeFilePath(filePath);
    const key = this.key(projectId, normalizedPath);

    const existing = this.models.get(key);
    if (existing) {
      this.touch(key);
      return existing;
    }

    const language = languageFromPath(normalizedPath);
    const uri = monaco.Uri.parse(`file:///${encodeURIComponent(projectId)}${normalizedPath}`);

    // Load content from backend or use initial value
    let initialValue = this.getInitialValueForPath(normalizedPath);
    
    // Try to load from backend for real cloud IDE
    workspaceService.getFileContent(projectId, normalizedPath).then((fileResult) => {
      if (fileResult.content && !this.models.get(key)?.model.getValue()) {
        const model = this.models.get(key)?.model;
        if (model) {
          model.setValue(fileResult.content);
        }
      }
    }).catch(() => {
      // Fall back to initial value on error
    });
    
    const model = monaco.editor.createModel(initialValue, language, uri);

    const fileModel: EditorFileModel = { uri, model, language };
    this.models.set(key, fileModel);
    const now = Date.now();
    this.metadata.set(key, {
      projectId,
      filePath: normalizedPath,
      language,
      createdAtMs: now,
      lastAccessedAtMs: now
    });
    return fileModel;
  }

  getMetadata(key: string): EditorModelMetadata | undefined {
    return this.metadata.get(key);
  }

  get(key: string): EditorFileModel | undefined {
    return this.models.get(key);
  }

  touch(key: string): void {
    const meta = this.metadata.get(key);
    if (!meta) return;
    meta.lastAccessedAtMs = Date.now();
  }

  dispose(key: string): void {
    const existing = this.models.get(key);
    if (!existing) return;
    existing.model.dispose();
    this.models.delete(key);
    this.metadata.delete(key);
  }

  /**
   * Reload model content from backend (for live updates)
   */
  async reloadModel(projectId: string, filePath: string): Promise<void> {
    const normalizedPath = normalizeFilePath(filePath);
    const key = this.key(projectId, normalizedPath);
    const fileModel = this.models.get(key);

    if (!fileModel) {
      return;
    }

    try {
      const fileResult = await workspaceService.getFileContent(projectId, normalizedPath);
      if (fileResult.content) {
        fileModel.model.setValue(fileResult.content);
      }
    } catch (error) {
      console.error('Failed to reload model:', error);
    }
  }

  private getInitialValueForPath(path: string): string {
    if (path.endsWith('/src/index.ts')) {
      return `export function hello() {\n  return 'hello';\n}\n`;
    }

    if (path.endsWith('.md')) {
      return `# ${path}\n\nPlaceholder content.\n`;
    }

    return `// ${path}\n`;
  }
}

export const editorModelManager = new EditorModelManager();
