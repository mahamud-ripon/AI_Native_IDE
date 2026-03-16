import type * as Monaco from 'monaco-editor';

import { ensureContainer, isContainerBooted } from '../runtime/webcontainerManager';
import { editorModelManager } from './modelManager';

type DebounceTimers = Map<string, ReturnType<typeof setTimeout>>;

const pendingWrites: DebounceTimers = new Map();
const DEBOUNCE_MS = 300;

// Track if WebContainer is available
let webContainerAvailable: boolean | null = null;

/**
 * Check if WebContainer is available and functional
 */
async function checkWebContainerAvailable(): Promise<boolean> {
  if (webContainerAvailable !== null) {
    return webContainerAvailable;
  }

  try {
    // Check if WebContainer API is available in browser
    if (typeof window !== 'undefined' && 'WebContainer' in window) {
      await ensureContainer();
      webContainerAvailable = true;
      return true;
    }
  } catch {
    // WebContainer not available
    console.log('[fsSync] WebContainer not available - file sync disabled');
  }

  webContainerAvailable = false;
  return false;
}

/**
 * Extract filesystem path from Monaco model URI.
 * Monaco URIs look like: file:///projectId/src/App.tsx
 * WebContainer expects: src/App.tsx (no leading slash, no project prefix)
 */
function modelPathToFsPath(model: Monaco.editor.ITextModel, projectId: string): string {
  const uriPath = model.uri.path;
  // URI path includes projectId: /projectId/src/App.tsx
  // Remove leading slash and projectId prefix
  const prefix = `/${projectId}`;
  if (uriPath.startsWith(prefix)) {
    return uriPath.slice(prefix.length + 1); // +1 for remaining slash
  }
  // Fallback: just strip leading slash
  return uriPath.startsWith('/') ? uriPath.slice(1) : uriPath;
}

export async function syncModelToFs(
  model: Monaco.editor.ITextModel,
  projectId: string,
  filePath: string
): Promise<void> {
  // Check if WebContainer is available
  const available = await checkWebContainerAvailable();
  if (!available) {
    // WebContainer not available - skip sync silently
    return;
  }

  const container = await ensureContainer();
  const content = model.getValue();

  // Use model URI for accurate path mapping
  const fsPath = modelPathToFsPath(model, projectId);

  // Avoid unnecessary writes by checking existing content
  let existingContent: string | null = null;
  try {
    const existing = await container.fs.readFile(fsPath, 'utf-8');
    existingContent = existing;
  } catch {
    // File doesn't exist yet, proceed with write
  }

  if (existingContent === content) {
    // No change, skip write
    return;
  }

  await container.fs.writeFile(fsPath, content);
}

export function setupModelSync(
  model: Monaco.editor.ITextModel,
  projectId: string,
  filePath: string
): Monaco.IDisposable {
  const key = editorModelManager.key(projectId, filePath);

  const disposable = model.onDidChangeContent(() => {
    // Clear any pending write
    const existing = pendingWrites.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule debounced write
    const timer = setTimeout(() => {
      pendingWrites.delete(key);
      syncModelToFs(model, projectId, filePath).catch((err) => {
        console.error(`[fsSync] Failed to write ${filePath}:`, err);
      });
    }, DEBOUNCE_MS);

    pendingWrites.set(key, timer);
  });

  return disposable;
}

export function flushPendingWrites(): Promise<void[]> {
  const promises: Promise<void>[] = [];

  for (const [key, timer] of pendingWrites.entries()) {
    clearTimeout(timer);
    pendingWrites.delete(key);

    const meta = editorModelManager.getMetadata(key);
    if (!meta) continue;

    const fileModel = editorModelManager.getOrCreate(
      // We need monaco instance, but for flush we can skip actual sync
      // since the model might already be disposed
      null as any,
      meta.projectId,
      meta.filePath
    );

    if (fileModel?.model) {
      promises.push(syncModelToFs(fileModel.model, meta.projectId, meta.filePath));
    }
  }

  return Promise.all(promises);
}

export function clearPendingWrites(): void {
  for (const timer of pendingWrites.values()) {
    clearTimeout(timer);
  }
  pendingWrites.clear();
}
