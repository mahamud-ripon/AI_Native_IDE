import { create } from 'zustand';

interface RuntimeLogState {
  log: string;
  append: (chunk: string) => void;
  clear: () => void;
}

export const useRuntimeLogStore = create<RuntimeLogState>((set) => ({
  log: '',
  append: (chunk) =>
    set((s) => {
      const next = (s.log + chunk).slice(-8000);
      return { log: next };
    }),
  clear: () => set({ log: '' })
}));
