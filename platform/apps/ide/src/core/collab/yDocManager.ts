import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export interface FileDoc {
  doc: Y.Doc;
  text: Y.Text;
  provider: WebsocketProvider | null;
  awareness: any;
}

// Configurable WebSocket URL - use environment variable or default to local server
const COLLAB_WS_URL = import.meta.env.VITE_COLLAB_WS_URL || 'ws://localhost:8008';

class YDocManager {
  private docs = new Map<string, FileDoc>();
  private wsUrl: string;

  constructor(wsUrl: string = COLLAB_WS_URL) {
    this.wsUrl = wsUrl;
  }

  /**
   * Get or create a Y.Doc for a specific file.
   * Key format: projectId:filePath
   */
  getDoc(projectId: string, filePath: string): FileDoc {
    const key = `${projectId}:${filePath}`;

    const existing = this.docs.get(key);
    if (existing) {
      return existing;
    }

    const doc = new Y.Doc();
    const text = doc.getText('content');

    // Room name includes project and file for isolation
    const roomName = `ide-${projectId}-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;

    // Create WebSocket provider for sync
    // Note: Collaboration service is not fully implemented yet, disable connection
    let provider: WebsocketProvider | null = null;
    let awareness: any = null;

    try {
      provider = new WebsocketProvider(this.wsUrl, roomName, doc, {
        connect: false, // Disabled until collab service WebSocket is implemented
      });
      awareness = provider.awareness;
    } catch (e) {
      console.warn('[YDocManager] Failed to create WebSocket provider, using local-only Y.Doc');
    }

    const fileDoc: FileDoc = {
      doc,
      text,
      provider,
      awareness,
    };

    this.docs.set(key, fileDoc);
    return fileDoc;
  }

  /**
   * Set local user info in awareness for all docs.
   */
  setLocalUser(user: { id: string; name: string; color: string }): void {
    for (const fileDoc of this.docs.values()) {
      fileDoc.awareness.setLocalStateField('user', user);
    }
  }

  /**
   * Get awareness for a specific file.
   */
  getAwareness(projectId: string, filePath: string): any {
    const key = `${projectId}:${filePath}`;
    const fileDoc = this.docs.get(key);
    return fileDoc?.awareness;
  }

  /**
   * Disconnect and dispose a specific file's doc.
   * Properly cleans up awareness to avoid ghost users.
   */
  disposeDoc(projectId: string, filePath: string): void {
    const key = `${projectId}:${filePath}`;
    const fileDoc = this.docs.get(key);
    if (!fileDoc) return;

    try {
      // Clear awareness state to avoid ghost users
      if (fileDoc.awareness) {
        fileDoc.awareness.setLocalState(null);
      }
    } catch {
      // Awareness cleanup may fail if already disposed
    }

    try {
      // Disconnect and destroy provider
      if (fileDoc.provider) {
        fileDoc.provider.disconnect();
        fileDoc.provider.destroy();
      }
    } catch {
      // Provider cleanup may fail if already disconnected
    }

    try {
      // Destroy the Y.Doc
      fileDoc.doc.destroy();
    } catch {
      // Doc may already be destroyed
    }

    this.docs.delete(key);
  }

  /**
   * Dispose all docs on app shutdown.
   * Properly cleans up awareness for all files.
   */
  disposeAll(): void {
    for (const fileDoc of this.docs.values()) {
      // Clear awareness state
      if (fileDoc.awareness) {
        fileDoc.awareness.setLocalState(null);
      }
      // Disconnect and destroy provider
      if (fileDoc.provider) {
        fileDoc.provider.disconnect();
        fileDoc.provider.destroy();
      }
      fileDoc.doc.destroy();
    }
    this.docs.clear();
  }

  /**
   * Check if a doc exists for a file.
   */
  hasDoc(projectId: string, filePath: string): boolean {
    return this.docs.has(`${projectId}:${filePath}`);
  }
}

export const yDocManager = new YDocManager();
