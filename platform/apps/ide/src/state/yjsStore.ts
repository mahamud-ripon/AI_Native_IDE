/**
 * Yjs CRDT Store for Real-Time Collaboration
 * 
 * Manages Y.Doc instances per file with proper cleanup and awareness.
 * Each file gets its own Y.Doc to prevent conflicts and enable file-level isolation.
 * 
 * Architecture:
 * - One Y.Doc per file (identified by `${projectId}:${fileId}`)
 * - Max 10 docs in pool to prevent memory leaks
 * - Awareness protocol for live cursors and user presence
 * - Auto-cleanup of unused docs
 * 
 * WebSocket Integration:
 * - Uses y-websocket provider with platform websocket-gateway
 * - Channel format: `collab:{projectId}:${fileId}`
 */

import { create } from 'zustand';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { channels } from '../websocket/multiplexer';

// Awareness type from y-protocols
type Awareness = any;

interface UserState {
  name: string;
  color: string;
  id: string;
  cursor?: { line: number; column: number };
}

interface YjsDocEntry {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
  lastAccessed: number;
  fileKey: string; // `${projectId}:${fileId}`
}

interface YjsStoreState {
  // Pool of Y.Doc instances (max 10)
  docPool: Map<string, YjsDocEntry>;
  
  // Currently active file
  activeFileKey: string | null;
  
  // Local user info
  localUser: UserState | null;
  
  // Remote users in current file
  remoteUsers: Map<string, UserState>;
  
  // Actions
  getOrCreateDoc: (projectId: string, fileId: string, wsUrl: string) => YjsDocEntry;
  switchFile: (fileKey: string | null) => void;
  setLocalUser: (user: UserState) => void;
  updateLocalCursor: (line: number, column: number) => void;
  cleanup: (fileKey?: string) => void;
  destroyDoc: (fileKey: string) => void;
}

const MAX_DOCS_IN_POOL = 10;

const USER_COLORS = [
  '#f783ac', // Pink
  '#818cf8', // Indigo
  '#34d399', // Emerald
  '#fbbf24', // Amber
  '#f87171', // Red
  '#60a5fa', // Blue
  '#a78bfa', // Violet
  '#38bdf8', // Sky
];

function getRandomColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

function generateUserId(): string {
  return `user-${Math.random().toString(36).substring(2, 9)}`;
}

export const useYjsStore = create<YjsStoreState>((set, get) => ({
  docPool: new Map(),
  activeFileKey: null,
  localUser: null,
  remoteUsers: new Map(),

  getOrCreateDoc: (projectId, fileId, wsUrl) => {
    const fileKey = `${projectId}:${fileId}`;
    const { docPool, localUser } = get();

    // Return existing doc if in pool
    if (docPool.has(fileKey)) {
      const entry = docPool.get(fileKey)!;
      // Update last accessed
      entry.lastAccessed = Date.now();
      set({ activeFileKey: fileKey });
      return entry;
    }

    // Create new Y.Doc
    const doc = new Y.Doc();
    
    // Create WebSocket provider - connect to websocket-gateway
    const channel = channels.collab(projectId, fileId);
    const provider = new WebsocketProvider(wsUrl, channel, doc, {
      connect: true,
    });

    // Setup awareness
    const awareness = provider.awareness;
    
    // Set local user state if available
    if (localUser) {
      awareness.setLocalStateField('user', localUser);
    }

    // Listen for remote awareness changes
    awareness.on('change', () => {
      const states = awareness.getStates();
      const remoteUsers = new Map<string, UserState>();
      
      states.forEach((state, clientId) => {
        if (clientId !== awareness.clientID && state.user) {
          remoteUsers.set(clientId.toString(), state.user as UserState);
        }
      });
      
      set({ remoteUsers });
    });

    // Create entry
    const entry: YjsDocEntry = {
      doc,
      provider,
      awareness,
      lastAccessed: Date.now(),
      fileKey,
    };

    // Add to pool
    const newPool = new Map(docPool).set(fileKey, entry);
    
    // Cleanup if pool exceeds max size
    if (newPool.size > MAX_DOCS_IN_POOL) {
      // Find oldest unused doc
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      
      newPool.forEach((e, key) => {
        if (key !== fileKey && e.lastAccessed < oldestTime) {
          oldestTime = e.lastAccessed;
          oldestKey = key;
        }
      });
      
      if (oldestKey) {
        get().destroyDoc(oldestKey);
        newPool.delete(oldestKey);
      }
    }

    set({ 
      docPool: newPool,
      activeFileKey: fileKey,
    });

    return entry;
  },

  switchFile: (fileKey) => {
    set({ activeFileKey: fileKey });
  },

  setLocalUser: (user) => {
    const { docPool, activeFileKey } = get();
    
    set({ localUser: user });
    
    // Update awareness if active file exists
    if (activeFileKey && docPool.has(activeFileKey)) {
      const entry = docPool.get(activeFileKey)!;
      entry.awareness.setLocalStateField('user', user);
    }
  },

  updateLocalCursor: (line, column) => {
    const { docPool, activeFileKey, localUser } = get();
    
    if (!activeFileKey || !localUser) return;
    
    const entry = docPool.get(activeFileKey);
    if (!entry) return;
    
    const updatedUser = { ...localUser, cursor: { line, column } };
    entry.awareness.setLocalStateField('user', updatedUser);
    set({ localUser: updatedUser });
  },

  cleanup: (fileKey) => {
    const { docPool } = get();
    
    if (fileKey && docPool.has(fileKey)) {
      // Update last accessed to now (keep it warm)
      const entry = docPool.get(fileKey)!;
      entry.lastAccessed = Date.now();
    }
  },

  destroyDoc: (fileKey) => {
    const { docPool } = get();
    const entry = docPool.get(fileKey);
    
    if (!entry) return;
    
    // Destroy provider (closes WebSocket)
    entry.provider.destroy();
    
    // Destroy doc
    entry.doc.destroy();
    
    // Remove from pool
    const newPool = new Map(docPool);
    newPool.delete(fileKey);
    set({ docPool: newPool });
    
    console.log(`[Yjs] Destroyed doc for ${fileKey}`);
  },
}));

// Helper hook for getting Yjs setup for a file
export function useYjsFile(projectId: string, fileId: string, wsUrl: string) {
  const fileKey = `${projectId}:${fileId}`;
  
  const getOrCreateDoc = useYjsStore((s) => s.getOrCreateDoc);
  const switchFile = useYjsStore((s) => s.switchFile);
  const destroyDoc = useYjsStore((s) => s.destroyDoc);
  
  // Get or create doc on mount
  const entry = getOrCreateDoc(projectId, fileId, wsUrl);
  
  // Switch to this file
  switchFile(fileKey);
  
  // Cleanup on unmount
  return {
    doc: entry.doc,
    provider: entry.provider,
    awareness: entry.awareness,
    destroy: () => destroyDoc(fileKey),
  };
}
