import type * as Monaco from 'monaco-editor';

import { editorModelManager } from './modelManager';

interface OpenedModel {
  key: string;
  openedAtMs: number;
  lastAccessedAtMs: number;
  refCount: number;
}

export class EditorService {
  private opened = new Map<string, OpenedModel>();
  private maxModels = 25;

  openFileModel(monaco: typeof Monaco, projectId: string, filePath: string) {
    const fileModel = editorModelManager.getOrCreate(monaco, projectId, filePath);
    const key = editorModelManager.key(projectId, filePath);

    const now = Date.now();
    const existing = this.opened.get(key);
    if (existing) {
      existing.refCount += 1;
      existing.lastAccessedAtMs = now;
      editorModelManager.touch(key);
      return fileModel;
    }

    this.opened.set(key, {
      key,
      openedAtMs: now,
      lastAccessedAtMs: now,
      refCount: 1
    });

    this.pruneIfNeeded();

    return fileModel;
  }

  touch(projectId: string, filePath: string) {
    const key = editorModelManager.key(projectId, filePath);
    const existing = this.opened.get(key);
    if (!existing) return;
    existing.lastAccessedAtMs = Date.now();
    editorModelManager.touch(key);
  }

  closeFileModel(projectId: string, filePath: string) {
    const key = editorModelManager.key(projectId, filePath);
    const existing = this.opened.get(key);
    if (!existing) return;

    existing.refCount -= 1;
    if (existing.refCount > 0) return;

    this.opened.delete(key);
    editorModelManager.dispose(key);
  }

  disposeAll() {
    for (const entry of this.opened.values()) {
      editorModelManager.dispose(entry.key);
    }
    this.opened.clear();
  }

  private pruneIfNeeded() {
    if (this.opened.size <= this.maxModels) return;

    const candidates = [...this.opened.values()]
      .filter((x) => x.refCount === 0)
      .sort((a, b) => a.lastAccessedAtMs - b.lastAccessedAtMs);

    while (this.opened.size > this.maxModels && candidates.length > 0) {
      const victim = candidates.shift();
      if (!victim) break;
      this.opened.delete(victim.key);
      editorModelManager.dispose(victim.key);
    }
  }
}

export const editorService = new EditorService();
