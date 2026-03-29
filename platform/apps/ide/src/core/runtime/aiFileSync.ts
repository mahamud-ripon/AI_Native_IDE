import { fileSystemClient } from '@/api/fileSystemClient';
import { ideEventBus, useIDEStore } from '@/stores/ideStore';

import { getRuntimeStatus, writeMountedFile } from './webcontainerManager';

export type AiFileEventKind = 'created' | 'changed';

function isRuntimeActiveForProject(projectId: string): boolean {
  const runtime = getRuntimeStatus();
  return (
    runtime.projectId === projectId &&
    runtime.status !== 'idle' &&
    runtime.status !== 'booting' &&
    runtime.status !== 'unsupported' &&
    runtime.status !== 'error'
  );
}

function emitFileRefresh(path: string, content: string, event: AiFileEventKind): void {
  if (event === 'created') {
    ideEventBus.emit('file:created', { path });
  }

  ideEventBus.emit('file:changed', { path, content });
  ideEventBus.emit('tree:refresh', { path });
}

export async function syncAiFileContent(
  projectId: string,
  path: string,
  content: string,
  options: { event?: AiFileEventKind; updateStore?: boolean } = {},
): Promise<void> {
  const event = options.event ?? 'changed';

  if (options.updateStore !== false) {
    useIDEStore.getState().setFileContent(path, content);
  }

  if (isRuntimeActiveForProject(projectId)) {
    try {
      await writeMountedFile(projectId, path, content);
    } catch (error) {
      console.warn('[AiFileSync] Failed to write mounted file:', { projectId, path, error });
    }
  }

  emitFileRefresh(path, content, event);
}

export async function syncAiFilesFromBackend(
  projectId: string,
  paths: string[],
  options: { event?: AiFileEventKind; openTabs?: boolean; updateStore?: boolean } = {},
): Promise<void> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const event = options.event ?? 'changed';

  await Promise.allSettled(
    uniquePaths.map(async (path) => {
      try {
        const file = await fileSystemClient.readFile(projectId, path);

        if (options.openTabs) {
          useIDEStore.getState().openTab(path, file.content);
        }

        await syncAiFileContent(projectId, path, file.content, {
          event,
          updateStore: options.updateStore,
        });
      } catch (error) {
        console.warn('[AiFileSync] Failed to hydrate AI file from backend:', { projectId, path, error });
        ideEventBus.emit('tree:refresh', { path });
      }
    }),
  );
}
