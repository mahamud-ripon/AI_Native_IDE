# IDE State - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/state/`  
> **Tech Stack:** Zustand + Yjs

---

## 1. Executive Summary

The State component manages high-performance, memory-safe data using Zustand for UI state and Yjs for shared document state.

---

## 2. Zustand Store

### 2.1 UI Store (src/state/zustand-store.ts)

```typescript
import { create } from 'zustand';

interface Tab {
  id: string;
  fileId: string;
  filePath: string;
  isDirty: boolean;
}

interface UIState {
  activeTabId: string | null;
  tabs: Tab[];
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  panelWidth: number;
  terminalOpen: boolean;
  
  openTab: (fileId: string, filePath: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setPanelWidth: (width: number) => void;
  toggleTerminal: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeTabId: null,
  tabs: [],
  theme: 'dark',
  sidebarOpen: true,
  panelWidth: 300,
  terminalOpen: true,
  
  openTab: (fileId, filePath) => {
    const { tabs } = get();
    const existing = tabs.find(t => t.fileId === fileId);
    if (existing) {
      set({ activeTabId: existing.id });
    } else {
      const newTab: Tab = {
        id: `tab-${Date.now()}`,
        fileId,
        filePath,
        isDirty: false
      };
      set({ tabs: [...tabs, newTab], activeTabId: newTab.id });
    }
  },
  
  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const newTabs = tabs.filter(t => t.id !== tabId);
    set({
      tabs: newTabs,
      activeTabId: activeTabId === tabId ? newTabs[0]?.id || null : activeTabId
    });
  },
  
  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  toggleTheme: () => set(state => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  setPanelWidth: (width) => set({ panelWidth: width }),
  toggleTerminal: () => set(state => ({ terminalOpen: !state.terminalOpen }))
}));
```

---

## 3. Yjs Store

### 3.1 Yjs Store (src/state/yjs-store.ts)

```typescript
import { create } from 'zustand';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

interface YjsDocEntry {
  doc: Y.Doc;
  provider: WebsocketProvider;
  refCount: number;
}

interface YjsStore {
  docs: Map<string, YjsDocEntry>;
  
  getOrCreateDoc: (projectId: string, fileId: string) => Y.Doc;
  getOrCreateProvider: (projectId: string, fileId: string) => WebsocketProvider;
  acquireDoc: (projectId: string, fileId: string) => void;
  releaseDoc: (projectId: string, fileId: string) => void;
}

const MAX_CACHED_DOCS = 10;

export const useYjsStore = create<YjsStore>((set, get) => ({
  docs: new Map(),
  
  getOrCreateDoc: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    const { docs } = get();
    
    if (docs.has(key)) return docs.get(key)!.doc;
    
    const doc = new Y.Doc();
    set(state => ({ docs: new Map(state.docs).set(key, { doc, provider: null as any, refCount: 0 }) }));
    return doc;
  },
  
  getOrCreateProvider: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    const { docs, getOrCreateDoc } = get();
    
    const doc = getOrCreateDoc(projectId, fileId);
    const entry = docs.get(key);
    
    if (entry?.provider) return entry.provider;
    
    const provider = new WebsocketProvider(
      process.env.NEXT_PUBLIC_WS_URL || 'wss://ws.platform.io/gateway',
      `collab:${projectId}:${fileId}`,
      doc
    );
    
    set(state => {
      const newDocs = new Map(state.docs);
      const existing = newDocs.get(key);
      if (existing) newDocs.set(key, { ...existing, provider });
      return { docs: newDocs };
    });
    
    return provider;
  },
  
  acquireDoc: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    set(state => {
      const newDocs = new Map(state.docs);
      const entry = newDocs.get(key);
      if (entry) newDocs.set(key, { ...entry, refCount: entry.refCount + 1 });
      return { docs: newDocs };
    });
  },
  
  releaseDoc: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    set(state => {
      const newDocs = new Map(state.docs);
      const entry = newDocs.get(key);
      if (entry && entry.refCount > 0) {
        newDocs.set(key, { ...entry, refCount: entry.refCount - 1 });
      }
      return { docs: newDocs };
    });
  }
}));
```

---

## 4. Implementation Status

| Component | Status |
|-----------|--------|
| UI Store (Zustand) | ✅ Complete |
| Yjs Store | ✅ Complete |
| Doc Pooling | ✅ Complete |
| Reference Counting | ✅ Complete |
