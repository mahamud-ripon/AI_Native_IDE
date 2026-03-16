import { create } from 'zustand';

import { editorKey, normalizeFilePath } from '../core/editor/editorKey';

export interface EditorTab {
  projectId: string;
  filePath: string;
  key: string;
  openedAtMs: number;
  lastAccessedAtMs: number;
}

interface TabsState {
  openTabs: EditorTab[];
  activeTabKey: string | null;

  openTab: (projectId: string, filePath: string) => void;
  closeTab: (tabKey: string) => void;
  setActiveTab: (tabKey: string) => void;
}

function tabKey(projectId: string, filePath: string) {
  return editorKey(projectId, filePath);
}

export const useTabsStore = create<TabsState>((set, get) => ({
  openTabs: [],
  activeTabKey: null,

  openTab: (projectId, filePath) => {
    const key = tabKey(projectId, filePath);
    const now = Date.now();

    const { openTabs } = get();
    const existing = openTabs.find((t) => t.key === key);

    if (existing) {
      set({
        openTabs: openTabs.map((t) =>
          t.key === key ? { ...t, lastAccessedAtMs: now } : t
        ),
        activeTabKey: key
      });
      return;
    }

    const next: EditorTab = {
      projectId,
      filePath: normalizeFilePath(filePath),
      key,
      openedAtMs: now,
      lastAccessedAtMs: now
    };

    set({ openTabs: [...openTabs, next], activeTabKey: key });
  },

  closeTab: (tabKeyToClose) => {
    const { openTabs, activeTabKey } = get();
    const nextTabs = openTabs.filter((t) => t.key !== tabKeyToClose);

    let nextActive = activeTabKey;
    if (activeTabKey === tabKeyToClose) {
      nextActive = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].key : null;
    }

    set({ openTabs: nextTabs, activeTabKey: nextActive });
  },

  setActiveTab: (tabKeyToActivate) => {
    const { openTabs } = get();
    const now = Date.now();
    set({
      activeTabKey: tabKeyToActivate,
      openTabs: openTabs.map((t) =>
        t.key === tabKeyToActivate ? { ...t, lastAccessedAtMs: now } : t
      )
    });
  }
}));
