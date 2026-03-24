/**
 * Layout Store
 *
 * Manages the IDE layout state including panel sizes, visibility, and positions.
 * Persists layout preferences to localStorage.
 *
 * Features:
 * - Panel size management (sidebar, bottom panel, etc.)
 * - Panel visibility toggles
 * - Layout persistence to localStorage
 * - Responsive breakpoint handling
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect } from 'react';

/**
 * Panel identifiers
 */
export type PanelId =
  | 'sidebar'
  | 'activityBar'
  | 'bottomPanel'
  | 'aiPanel'
  | 'fileExplorer'
  | 'search'
  | 'sourceControl'
  | 'extensions';

/**
 * Panel size configuration
 */
export interface PanelSize {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Individual panel state
 */
export interface PanelState {
  visible: boolean;
  collapsed: boolean;
  size: PanelSize;
  activeTab?: string;
}

/**
 * Layout state interface
 */
export interface LayoutState {
  // Panel states
  panels: Record<PanelId, PanelState>;

  // Global layout settings
  sidebarPosition: 'left' | 'right';
  bottomPanelPosition: 'bottom' | 'right';
  activityBarVisible: boolean;
  statusBarVisible: boolean;

  // Active sidebar view
  activeSidebarView: 'files' | 'search' | 'git' | 'ai' | 'extensions' | null;

  // Bottom panel tab
  bottomPanelTab: 'terminal' | 'preview' | 'problems' | 'output';

  // Actions
  togglePanel: (panelId: PanelId) => void;
  setPanelVisible: (panelId: PanelId, visible: boolean) => void;
  setPanelCollapsed: (panelId: PanelId, collapsed: boolean) => void;
  setPanelSize: (panelId: PanelId, size: Partial<PanelSize>) => void;
  setSidebarPosition: (position: 'left' | 'right') => void;
  setBottomPanelPosition: (position: 'bottom' | 'right') => void;
  toggleActivityBar: () => void;
  toggleStatusBar: () => void;
  setActiveSidebarView: (view: LayoutState['activeSidebarView']) => void;
  setBottomPanelTab: (tab: LayoutState['bottomPanelTab']) => void;
  resetLayout: () => void;
}

/**
 * Default panel sizes
 */
const defaultPanelSizes: Record<PanelId, PanelSize> = {
  sidebar: { width: 260, minWidth: 150, maxWidth: 500 },
  activityBar: { width: 48, minWidth: 48, maxWidth: 48 },
  bottomPanel: { height: 240, minHeight: 100, maxHeight: 600 },
  aiPanel: { width: 360, minWidth: 280, maxWidth: 600 },
  fileExplorer: { width: 260, minWidth: 150, maxWidth: 500 },
  search: { width: 260, minWidth: 150, maxWidth: 500 },
  sourceControl: { width: 260, minWidth: 150, maxWidth: 500 },
  extensions: { width: 260, minWidth: 150, maxWidth: 500 },
};

/**
 * Default panel states
 */
const defaultPanelStates: Record<PanelId, PanelState> = {
  sidebar: {
    visible: true,
    collapsed: false,
    size: defaultPanelSizes.sidebar,
    activeTab: 'files',
  },
  activityBar: {
    visible: true,
    collapsed: false,
    size: defaultPanelSizes.activityBar,
  },
  bottomPanel: {
    visible: true,
    collapsed: false,
    size: defaultPanelSizes.bottomPanel,
    activeTab: 'terminal',
  },
  aiPanel: {
    visible: false,
    collapsed: false,
    size: defaultPanelSizes.aiPanel,
  },
  fileExplorer: {
    visible: true,
    collapsed: false,
    size: defaultPanelSizes.fileExplorer,
  },
  search: {
    visible: false,
    collapsed: false,
    size: defaultPanelSizes.search,
  },
  sourceControl: {
    visible: false,
    collapsed: false,
    size: defaultPanelSizes.sourceControl,
  },
  extensions: {
    visible: false,
    collapsed: false,
    size: defaultPanelSizes.extensions,
  },
};

/**
 * Initial layout state
 */
const initialState = {
  panels: defaultPanelStates,
  sidebarPosition: 'left' as const,
  bottomPanelPosition: 'bottom' as const,
  activityBarVisible: true,
  statusBarVisible: true,
  activeSidebarView: 'files' as const,
  bottomPanelTab: 'terminal' as const,
};

/**
 * Layout store with persistence
 */
export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      ...initialState,

      togglePanel: (panelId) => {
        const { panels } = get();
        set({
          panels: {
            ...panels,
            [panelId]: {
              ...panels[panelId],
              visible: !panels[panelId].visible,
            },
          },
        });
      },

      setPanelVisible: (panelId, visible) => {
        const { panels } = get();
        set({
          panels: {
            ...panels,
            [panelId]: {
              ...panels[panelId],
              visible,
            },
          },
        });
      },

      setPanelCollapsed: (panelId, collapsed) => {
        const { panels } = get();
        set({
          panels: {
            ...panels,
            [panelId]: {
              ...panels[panelId],
              collapsed,
            },
          },
        });
      },

      setPanelSize: (panelId, size) => {
        const { panels } = get();
        set({
          panels: {
            ...panels,
            [panelId]: {
              ...panels[panelId],
              size: {
                ...panels[panelId].size,
                ...size,
              },
            },
          },
        });
      },

      setSidebarPosition: (position) => {
        set({ sidebarPosition: position });
      },

      setBottomPanelPosition: (position) => {
        set({ bottomPanelPosition: position });
      },

      toggleActivityBar: () => {
        set((state) => ({
          activityBarVisible: !state.activityBarVisible,
        }));
      },

      toggleStatusBar: () => {
        set((state) => ({
          statusBarVisible: !state.statusBarVisible,
        }));
      },

      setActiveSidebarView: (view) => {
        set({ activeSidebarView: view });
      },

      setBottomPanelTab: (tab) => {
        set({ bottomPanelTab: tab });
      },

      resetLayout: () => {
        set(initialState);
      },
    }),
    {
      name: 'ide-layout-storage',
      partialize: (state) => ({
        panels: state.panels,
        sidebarPosition: state.sidebarPosition,
        bottomPanelPosition: state.bottomPanelPosition,
        activityBarVisible: state.activityBarVisible,
        statusBarVisible: state.statusBarVisible,
        bottomPanelTab: state.bottomPanelTab,
      }),
    }
  )
);

/**
 * Hook to get a specific panel's state
 */
export function usePanelState(panelId: PanelId) {
  return useLayoutStore((state) => state.panels[panelId]);
}

/**
 * Hook to check if a panel is visible
 */
export function useIsPanelVisible(panelId: PanelId): boolean {
  return useLayoutStore((state) => state.panels[panelId]?.visible ?? false);
}

/**
 * Hook to get panel size
 */
export function usePanelSize(panelId: PanelId): PanelSize {
  return useLayoutStore((state) => state.panels[panelId]?.size ?? {});
}

// ============================================================================
// URL Param Synchronization
// ============================================================================

/**
 * Serialize layout state to URL params
 */
export function layoutToUrlParams(state: Partial<LayoutState>): URLSearchParams {
  const params = new URLSearchParams();
  
  if (state.activeSidebarView) {
    params.set('view', state.activeSidebarView);
  }
  if (state.bottomPanelTab) {
    params.set('panel', state.bottomPanelTab);
  }
  if (state.panels?.sidebar?.visible === false) {
    params.set('sidebar', '0');
  }
  if (state.panels?.bottomPanel?.visible === false) {
    params.set('bottom', '0');
  }
  if (state.panels?.aiPanel?.visible) {
    params.set('ai', '1');
  }
  
  return params;
}

/**
 * Parse layout state from URL params
 */
export function urlParamsToLayout(params: URLSearchParams): Partial<LayoutState> {
  const updates: Partial<LayoutState> = {};
  
  const view = params.get('view');
  if (view && ['files', 'search', 'git', 'ai', 'extensions'].includes(view)) {
    updates.activeSidebarView = view as LayoutState['activeSidebarView'];
  }
  
  const panel = params.get('panel');
  if (panel && ['terminal', 'preview', 'problems', 'output'].includes(panel)) {
    updates.bottomPanelTab = panel as LayoutState['bottomPanelTab'];
  }
  
  const panels: Partial<Record<PanelId, Partial<PanelState>>> = {};
  
  if (params.has('sidebar')) {
    panels.sidebar = { visible: params.get('sidebar') !== '0' };
  }
  if (params.has('bottom')) {
    panels.bottomPanel = { visible: params.get('bottom') !== '0' };
  }
  if (params.has('ai')) {
    panels.aiPanel = { visible: params.get('ai') === '1' };
  }
  
  if (Object.keys(panels).length > 0) {
    updates.panels = panels as Record<PanelId, PanelState>;
  }
  
  return updates;
}

/**
 * Hook to sync layout state with URL params
 * Usage: useLayoutUrlSync() in your main layout component
 */
export function useLayoutUrlSync() {
  useEffect(() => {
    // Apply URL params on mount
    const params = new URLSearchParams(window.location.search);
    const updates = urlParamsToLayout(params);
    
    if (Object.keys(updates).length > 0) {
      const store = useLayoutStore.getState();
      
      if (updates.activeSidebarView) {
        store.setActiveSidebarView(updates.activeSidebarView);
      }
      if (updates.bottomPanelTab) {
        store.setBottomPanelTab(updates.bottomPanelTab);
      }
      if (updates.panels) {
        Object.entries(updates.panels).forEach(([panelId, panelState]) => {
          if (panelState.visible !== undefined) {
            store.setPanelVisible(panelId as PanelId, panelState.visible);
          }
        });
      }
    }
    
    // Subscribe to store changes and update URL
    const unsubscribe = useLayoutStore.subscribe((state, prevState) => {
      const params = layoutToUrlParams({
        activeSidebarView: state.activeSidebarView,
        bottomPanelTab: state.bottomPanelTab,
        panels: state.panels,
      });
      
      const newUrl = params.toString() 
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      
      // Only update if params changed
      if (newUrl !== window.location.pathname + window.location.search) {
        window.history.replaceState(null, '', newUrl);
      }
    });
    
    return unsubscribe;
  }, []);
}
