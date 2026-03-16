import { create } from 'zustand';

import { gitService } from '../core/git/gitService';

export type FileStatus = 'unmodified' | 'modified' | 'added' | 'deleted' | 'untracked';

export interface GitFileChange {
  path: string;
  status: FileStatus;
  staged: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface DiffContent {
  path: string;
  original: string;
  modified: string;
  isBinary: boolean;
  isLarge: boolean;
}

// Binary file extensions that should not be diffed
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp',
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
  'exe', 'dll', 'so', 'dylib',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'sqlite', 'db',
]);

const MAX_DIFF_SIZE = 1_000_000; // 1MB limit

function isBinaryFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXTENSIONS.has(ext);
}

interface GitState {
  isRepo: boolean;
  branch: string | null;
  branches: GitBranch[];
  changes: GitFileChange[];
  commitMessage: string;
  loading: boolean;
  error: string | null;
  diff: DiffContent | null;
  diffLoading: boolean;

  // Actions
  refresh: (dir: string) => Promise<void>;
  setCommitMessage: (message: string) => void;
  stageFile: (dir: string, path: string) => Promise<void>;
  unstageFile: (dir: string, path: string) => Promise<void>;
  stageAll: (dir: string) => Promise<void>;
  commit: (dir: string) => Promise<string | null>;
  checkoutBranch: (dir: string, branch: string) => Promise<void>;
  createBranch: (dir: string, name: string) => Promise<void>;
  loadDiff: (dir: string, path: string) => Promise<void>;
  closeDiff: () => void;
  clearError: () => void;
}

function parseStatusMatrix(matrix: string[][]): GitFileChange[] {
  const changes: GitFileChange[] = [];

  for (const row of matrix) {
    const [path, headStatus, worktreeStatus, stagedStatus] = row;
    const head = parseInt(headStatus, 10);
    const worktree = parseInt(worktreeStatus, 10);
    const staged = parseInt(stagedStatus, 10);

    // Status codes: 0 = absent, 1 = present, 2 = modified
    let status: FileStatus;
    let isStaged = false;

    if (head === 0 && worktree === 2) {
      status = 'added';
      isStaged = staged === 2;
    } else if (head === 1 && worktree === 0) {
      status = 'deleted';
      isStaged = staged === 0;
    } else if (head === 1 && worktree === 2) {
      status = 'modified';
      isStaged = staged === 2;
    } else if (head === 0 && worktree === 1) {
      status = 'untracked';
      isStaged = false;
    } else {
      continue; // Unmodified, skip
    }

    changes.push({ path, status, staged: isStaged });
  }

  return changes;
}

export const useGitStore = create<GitState>((set, get) => ({
  isRepo: false,
  branch: null,
  branches: [],
  changes: [],
  commitMessage: '',
  loading: false,
  error: null,
  diff: null,
  diffLoading: false,

  refresh: async (dir: string) => {
    set({ loading: true, error: null });
    try {
      // Check if repo exists
      const branch = await gitService.currentBranch(dir);
      const isRepo = branch !== undefined;

      if (!isRepo) {
        set({ isRepo: false, branch: null, branches: [], changes: [], loading: false });
        return;
      }

      // Get branches
      const branchList = await gitService.listBranches(dir);
      const branches: GitBranch[] = branchList.map(name => ({
        name,
        current: name === branch,
      }));

      // Get status
      const statusMatrix = await gitService.status(dir);
      const changes = parseStatusMatrix(statusMatrix);

      set({ isRepo, branch, branches, changes, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Git refresh failed', loading: false });
    }
  },

  setCommitMessage: (message: string) => {
    set({ commitMessage: message });
  },

  stageFile: async (dir: string, path: string) => {
    try {
      await gitService.add(dir, path);
      await get().refresh(dir);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Stage failed' });
    }
  },

  unstageFile: async (dir: string, path: string) => {
    try {
      // Reset index for the file (unstage)
      // isomorphic-git doesn't have resetIndex, so we need to use a workaround
      // For now, we'll just refresh - proper implementation would need git rm --cached
      set({ error: 'Unstage not yet implemented - use git reset in terminal' });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unstage failed' });
    }
  },

  stageAll: async (dir: string) => {
    try {
      await gitService.addAll(dir);
      await get().refresh(dir);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Stage all failed' });
    }
  },

  commit: async (dir: string) => {
    const { commitMessage } = get();
    if (!commitMessage.trim()) {
      set({ error: 'Commit message is required' });
      return null;
    }

    try {
      const sha = await gitService.commit({ dir, message: commitMessage });
      set({ commitMessage: '' });
      await get().refresh(dir);
      return sha;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Commit failed' });
      return null;
    }
  },

  checkoutBranch: async (dir: string, branch: string) => {
    try {
      await gitService.checkout(dir, branch);
      await get().refresh(dir);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Checkout failed' });
    }
  },

  createBranch: async (dir: string, name: string) => {
    try {
      await gitService.createBranch(dir, name);
      await get().checkoutBranch(dir, name);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Create branch failed' });
    }
  },

  loadDiff: async (dir: string, path: string) => {
    // Check if binary file
    if (isBinaryFile(path)) {
      set({
        diff: {
          path,
          original: '',
          modified: '',
          isBinary: true,
          isLarge: false,
        },
        diffLoading: false,
      });
      return;
    }

    set({ diffLoading: true, error: null });
    try {
      // Get HEAD version (original)
      const original = await gitService.show(dir, path, 'HEAD') ?? '';
      // Get working directory version (modified)
      const modified = await gitService.readFile(dir, path) ?? '';

      // Check if file is too large
      const totalSize = original.length + modified.length;
      if (totalSize > MAX_DIFF_SIZE) {
        set({
          diff: {
            path,
            original: '',
            modified: '',
            isBinary: false,
            isLarge: true,
          },
          diffLoading: false,
        });
        return;
      }

      set({ diff: { path, original, modified, isBinary: false, isLarge: false }, diffLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load diff', diffLoading: false });
    }
  },

  closeDiff: () => {
    set({ diff: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));
