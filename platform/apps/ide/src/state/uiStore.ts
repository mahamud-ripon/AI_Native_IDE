import { create } from 'zustand';

export type BottomPanelTab = 'terminal' | 'preview';

interface UiState {
  isSidebarOpen: boolean;
  isBottomPanelOpen: boolean;
  bottomPanelTab: BottomPanelTab;
  isCommandPaletteOpen: boolean;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  toggleBottomPanel: () => void;
  setBottomPanelOpen: (open: boolean) => void;

  setBottomPanelTab: (tab: BottomPanelTab) => void;

  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isSidebarOpen: true,
  isBottomPanelOpen: true,
  bottomPanelTab: 'terminal',
  isCommandPaletteOpen: false,

  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  toggleBottomPanel: () => set((s) => ({ isBottomPanelOpen: !s.isBottomPanelOpen })),
  setBottomPanelOpen: (open) => set({ isBottomPanelOpen: open }),

  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),

  toggleCommandPalette: () => set((s) => ({ isCommandPaletteOpen: !s.isCommandPaletteOpen })),
  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
}));
