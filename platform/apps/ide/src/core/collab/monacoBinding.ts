import type * as Monaco from 'monaco-editor';
import { MonacoBinding } from 'y-monaco';

import { yDocManager, type FileDoc } from './yDocManager';

export interface MonacoCollabBinding {
  binding: MonacoBinding;
  doc: FileDoc;
  disposable: Monaco.IDisposable;
}

/**
 * Bind a Monaco editor to a Y.Text for collaboration.
 * This enables real-time sync with other clients.
 */
export function bindMonacoToYjs(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  projectId: string,
  filePath: string
): MonacoCollabBinding {
  const model = editor.getModel();
  if (!model) {
    throw new Error('Editor has no model');
  }

  const fileDoc = yDocManager.getDoc(projectId, filePath);

  // Create Monaco binding - this syncs Monaco editor with Y.Text
  const binding = new MonacoBinding(
    fileDoc.text,
    model,
    new Set([editor]),
    fileDoc.awareness
  );

  // Return disposable for cleanup
  const disposable: Monaco.IDisposable = {
    dispose: () => {
      binding.destroy();
    },
  };

  return {
    binding,
    doc: fileDoc,
    disposable,
  };
}

/**
 * Set the local user for awareness (cursor display).
 */
export function setCollabUser(user: { id: string; name: string; color: string }): void {
  yDocManager.setLocalUser(user);
}

/**
 * Get awareness for a file (to display remote cursors).
 */
export function getFileAwareness(projectId: string, filePath: string): any {
  return yDocManager.getAwareness(projectId, filePath);
}

/**
 * Cleanup binding for a file.
 */
export function unbindMonacoFromYjs(projectId: string, filePath: string): void {
  yDocManager.disposeDoc(projectId, filePath);
}
