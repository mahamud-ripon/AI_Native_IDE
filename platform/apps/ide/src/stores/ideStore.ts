/**
 * Unified IDE Store with Event Bus
 *
 * Central state management for the entire IDE.
 * All components communicate through this store and event bus.
 *
 * Architecture:
 * - Zustand store for reactive state
 * - Event bus (mitt) for cross-component events
 * - Persisted state for session recovery
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import mitt, { Emitter } from 'mitt';

// ============================================================================
// EVENT BUS TYPES
// ============================================================================

export type IDEEvents = {
  // File events
  'file:opened': { path: string; content: string };
  'file:saved': { path: string; content: string };
  'file:closed': { path: string };
  'file:created': { path: string };
  'file:deleted': { path: string };
  'file:renamed': { oldPath: string; newPath: string };
  'file:changed': { path: string; content?: string };

  // Editor events
  'editor:tabChanged': { path: string };
  'editor:cursorMoved': { path: string; line: number; column: number };
  'editor:contentChanged': { path: string; content: string };
  'editor:applyDiff': { path: string; diff: FileDiff };
  'editor:diffAccepted': { path: string };
  'editor:diffRejected': { path: string };

  // AI events
  'ai:messageReceived': { content: string; role: 'user' | 'assistant' };
  'ai:streamChunk': { chunk: string; messageId: string };
  'ai:streamComplete': { messageId: string; content: string };
  'ai:codeGenerated': { path: string; code: string; diff: FileDiff };
  'ai:applyCode': { path: string; code: string };

  // Terminal events
  'terminal:output': { data: string };
  'terminal:command': { command: string };
  'terminal:clear': undefined;

  // Preview events
  'preview:reload': undefined;
  'preview:urlChanged': { url: string };

  // Git events
  'git:statusChanged': { files: GitFileStatus[] };
  'git:committed': { message: string; hash: string };
  'git:branchChanged': { branch: string };

  // Layout events
  'layout:viewModeChanged': { mode: ViewMode };
  'layout:panelToggled': { panel: string; visible: boolean };

  // Workspace events
  'workspace:connected': { projectId: string };
  'workspace:disconnected': undefined;
  'workspace:fileEvent': { type: string; path: string };
  'tree:refresh': { path: string };
};

// ============================================================================
// TYPES
// ============================================================================

export type ViewMode = 'coding' | 'preview' | 'settings';

export interface FileTab {
  path: string;
  name: string;
  isDirty: boolean;
  language: string;
  scrollTop?: number;
  cursorLine?: number;
  cursorColumn?: number;
}

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

export interface FileDiff {
  original: string;
  modified: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  lineNumber?: number;
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
}

export type ProjectType = 'browser' | 'cloud';

export type TerminalConnectionState = 'offline' | 'connecting' | 'connected' | 'local';
export type WebContainerRuntimeState =
  | 'idle'
  | 'booting'
  | 'mounted'
  | 'shell-ready'
  | 'installing'
  | 'running'
  | 'unsupported'
  | 'error';

export interface TerminalSession {
  id: string;
  name: string;
  output: string[];
  isActive: boolean;
}

export interface PendingDiff {
  path: string;
  diff: FileDiff;
  newContent: string;
  messageId: string;
}

// ============================================================================
// IDE STORE STATE
// ============================================================================

interface IDEState {
  // Project
  projectId: string;
  projectName: string;
  workspaceId: string;

  // View mode
  viewMode: ViewMode;

  // Editor tabs
  openTabs: FileTab[];
  activeTabPath: string | null;

  // File explorer
  fileTree: FileNode[];
  selectedFilePath: string | null;
  isFileTreeLoading: boolean;

  // File contents cache
  fileContents: Map<string, string>;

  // Terminal
  terminalSessions: TerminalSession[];
  activeTerminalId: string | null;
  terminalOutput: string[];

  // Preview
  previewUrl: string;
  previewIsLoading: boolean;
  runtimeStatus: WebContainerRuntimeState;
  runtimeMessage: string | null;

  // Git
  gitStatus: GitFileStatus[];
  currentBranch: string;
  gitIsLoading: boolean;

  // Pending AI diffs
  pendingDiffs: Map<string, PendingDiff>;

  // Project type (determines terminal mode)
  projectType: ProjectType;

  // Terminal connection state
  terminalConnectionState: TerminalConnectionState;

  // Connection status
  isWorkspaceConnected: boolean;
  isAIConnected: boolean;

  // Bottom panel
  bottomPanelTab: 'bolt' | 'terminal' | 'publish' | 'problems';
  bottomPanelHeight: number;

  // Actions - View
  setViewMode: (mode: ViewMode) => void;

  // Actions - Tabs
  openTab: (path: string, content?: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  markTabDirty: (path: string, isDirty: boolean) => void;
  updateTabScrollPosition: (path: string, scrollTop: number) => void;

  // Actions - File Tree
  setFileTree: (nodes: FileNode[]) => void;
  toggleFileNode: (path: string) => void;
  selectFile: (path: string) => void;
  addFileNode: (parentPath: string, node: FileNode) => void;
  removeFileNode: (path: string) => void;
  setFileTreeLoading: (loading: boolean) => void;

  // Actions - File Contents
  setFileContent: (path: string, content: string) => void;
  getFileContent: (path: string) => string | undefined;

  // Actions - Terminal
  addTerminalOutput: (data: string) => void;
  clearTerminal: () => void;
  setBottomPanelTab: (tab: IDEState['bottomPanelTab']) => void;
  setTerminalConnectionState: (state: TerminalConnectionState) => void;

  // Actions - Preview
  setPreviewUrl: (url: string) => void;
  setPreviewLoading: (loading: boolean) => void;
  setRuntimeState: (status: WebContainerRuntimeState, message?: string | null) => void;

  // Actions - Git
  setGitStatus: (files: GitFileStatus[]) => void;
  setCurrentBranch: (branch: string) => void;

  // Actions - Diffs
  addPendingDiff: (diff: PendingDiff) => void;
  acceptDiff: (path: string) => void;
  rejectDiff: (path: string) => void;

  // Actions - Connection
  setWorkspaceConnected: (connected: boolean) => void;
  setAIConnected: (connected: boolean) => void;

  // Actions - Project
  setProject: (projectId: string, projectName: string, workspaceId: string, projectType?: ProjectType) => void;
  setProjectType: (projectType: ProjectType) => void;
}

// ============================================================================
// EVENT BUS SINGLETON
// ============================================================================

export const ideEventBus: Emitter<IDEEvents> = mitt<IDEEvents>();

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

export function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    sh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    graphql: 'graphql',
    env: 'plaintext',
    gitignore: 'plaintext',
  };
  return langMap[ext || ''] || 'plaintext';
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useIDEStore = create<IDEState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // Initial state
        projectId: '',
        projectName: 'My Project',
        workspaceId: '',
        viewMode: 'coding',
        openTabs: [],
        activeTabPath: null,
        fileTree: [],
        selectedFilePath: null,
        isFileTreeLoading: false,
        fileContents: new Map(),
        terminalSessions: [],
        activeTerminalId: null,
        terminalOutput: [],
        previewUrl: 'http://localhost:5173',
        previewIsLoading: false,
        runtimeStatus: 'idle',
        runtimeMessage: null,
        gitStatus: [],
        currentBranch: 'main',
        gitIsLoading: false,
        pendingDiffs: new Map(),
        projectType: 'cloud',
        terminalConnectionState: 'offline',
        isWorkspaceConnected: false,
        isAIConnected: false,
        bottomPanelTab: 'terminal',
        bottomPanelHeight: 200,

        // View actions
        setViewMode: (mode) => {
          set({ viewMode: mode });
          ideEventBus.emit('layout:viewModeChanged', { mode });
        },

        // Tab actions
        openTab: (path, content) => {
          const { openTabs, fileContents } = get();
          const name = path.split('/').pop() || path;
          const language = detectLanguage(path);

          if (!openTabs.find(t => t.path === path)) {
            set({
              openTabs: [...openTabs, { path, name, isDirty: false, language }],
            });
          }

          if (content !== undefined) {
            const newContents = new Map(fileContents);
            newContents.set(path, content);
            set({ fileContents: newContents });
          }

          set({ activeTabPath: path, selectedFilePath: path });
          ideEventBus.emit('editor:tabChanged', { path });
        },

        closeTab: (path) => {
          const { openTabs, activeTabPath } = get();
          const newTabs = openTabs.filter(t => t.path !== path);
          let newActivePath = activeTabPath;

          if (activeTabPath === path) {
            const idx = openTabs.findIndex(t => t.path === path);
            newActivePath = newTabs[Math.max(0, idx - 1)]?.path || null;
          }

          set({ openTabs: newTabs, activeTabPath: newActivePath });
          ideEventBus.emit('file:closed', { path });
        },

        setActiveTab: (path) => {
          set({ activeTabPath: path, selectedFilePath: path });
          ideEventBus.emit('editor:tabChanged', { path });
        },

        markTabDirty: (path, isDirty) => {
          set(state => ({
            openTabs: state.openTabs.map(t =>
              t.path === path ? { ...t, isDirty } : t
            ),
          }));
        },

        updateTabScrollPosition: (path, scrollTop) => {
          set(state => ({
            openTabs: state.openTabs.map(t =>
              t.path === path ? { ...t, scrollTop } : t
            ),
          }));
        },

        // File tree actions
        setFileTree: (nodes) => {
          set({ fileTree: nodes, isFileTreeLoading: false });
        },

        toggleFileNode: (path) => {
          const toggleNode = (nodes: FileNode[]): FileNode[] =>
            nodes.map(node => {
              if (node.path === path) {
                return { ...node, isExpanded: !node.isExpanded };
              }
              if (node.children) {
                return { ...node, children: toggleNode(node.children) };
              }
              return node;
            });

          set(state => ({ fileTree: toggleNode(state.fileTree) }));
        },

        selectFile: (path) => {
          set({ selectedFilePath: path });
        },

        addFileNode: (parentPath, node) => {
          const addToParent = (nodes: FileNode[]): FileNode[] =>
            nodes.map(n => {
              if (n.path === parentPath) {
                return { ...n, children: [...(n.children || []), node] };
              }
              if (n.children) {
                return { ...n, children: addToParent(n.children) };
              }
              return n;
            });

          set(state => ({ fileTree: addToParent(state.fileTree) }));
        },

        removeFileNode: (path) => {
          const removeNode = (nodes: FileNode[]): FileNode[] =>
            nodes
              .filter(n => n.path !== path)
              .map(n => ({
                ...n,
                children: n.children ? removeNode(n.children) : undefined,
              }));

          set(state => ({ fileTree: removeNode(state.fileTree) }));
        },

        setFileTreeLoading: (loading) => {
          set({ isFileTreeLoading: loading });
        },

        // File content actions
        setFileContent: (path, content) => {
          set(state => {
            const newContents = new Map(state.fileContents);
            newContents.set(path, content);
            return { fileContents: newContents };
          });
        },

        getFileContent: (path) => {
          return get().fileContents.get(path);
        },

        // Terminal actions
        addTerminalOutput: (data) => {
          set(state => ({
            terminalOutput: [...state.terminalOutput, data],
          }));
          ideEventBus.emit('terminal:output', { data });
        },

        clearTerminal: () => {
          set({ terminalOutput: [] });
          ideEventBus.emit('terminal:clear', undefined);
        },

        setBottomPanelTab: (tab) => {
          set({ bottomPanelTab: tab });
        },

        setTerminalConnectionState: (state) => {
          set({ terminalConnectionState: state });
        },

        // Preview actions
        setPreviewUrl: (url) => {
          set({ previewUrl: url });
          ideEventBus.emit('preview:urlChanged', { url });
        },

        setPreviewLoading: (loading) => {
          set({ previewIsLoading: loading });
        },

        setRuntimeState: (status, message = null) => {
          set({ runtimeStatus: status, runtimeMessage: message });
        },

        // Git actions
        setGitStatus: (files) => {
          set({ gitStatus: files });
          ideEventBus.emit('git:statusChanged', { files });
        },

        setCurrentBranch: (branch) => {
          set({ currentBranch: branch });
          ideEventBus.emit('git:branchChanged', { branch });
        },

        // Diff actions
        addPendingDiff: (diff) => {
          set(state => {
            const newDiffs = new Map(state.pendingDiffs);
            newDiffs.set(diff.path, diff);
            return { pendingDiffs: newDiffs };
          });
          ideEventBus.emit('editor:applyDiff', { path: diff.path, diff: diff.diff });
        },

        acceptDiff: (path) => {
          const { pendingDiffs, fileContents } = get();
          const pending = pendingDiffs.get(path);
          if (pending) {
            const newContents = new Map(fileContents);
            newContents.set(path, pending.newContent);
            const newDiffs = new Map(pendingDiffs);
            newDiffs.delete(path);
            set({ fileContents: newContents, pendingDiffs: newDiffs });
            ideEventBus.emit('editor:diffAccepted', { path });
            ideEventBus.emit('file:saved', { path, content: pending.newContent });
          }
        },

        rejectDiff: (path) => {
          set(state => {
            const newDiffs = new Map(state.pendingDiffs);
            newDiffs.delete(path);
            return { pendingDiffs: newDiffs };
          });
          ideEventBus.emit('editor:diffRejected', { path });
        },

        // Connection actions
        setWorkspaceConnected: (connected) => {
          set({ isWorkspaceConnected: connected });
          if (connected) {
            ideEventBus.emit('workspace:connected', { projectId: get().projectId });
          } else {
            ideEventBus.emit('workspace:disconnected', undefined);
          }
        },

        setAIConnected: (connected) => {
          set({ isAIConnected: connected });
        },

        // Project actions
        setProject: (projectId, projectName, workspaceId, projectType) => {
          const currentProjectId = get().projectId;
          if (currentProjectId && currentProjectId !== projectId) {
            // Clear tabs and state when switching to a different project
            set({
              projectId,
              projectName,
              workspaceId,
              projectType: projectType || 'cloud',
              openTabs: [],
              activeTabPath: null,
              selectedFilePath: null,
              fileContents: new Map(),
              terminalConnectionState: 'offline',
              previewIsLoading: false,
              previewUrl: '',
              runtimeStatus: 'idle',
              runtimeMessage: null,
            });
          } else {
            set({ projectId, projectName, workspaceId, projectType: projectType || get().projectType });
          }
        },

        setProjectType: (projectType) => {
          set({ projectType });
        },
      }),
      {
        name: 'ide-store',
        partialize: (state) => ({
          viewMode: state.viewMode,
          bottomPanelTab: state.bottomPanelTab,
          bottomPanelHeight: state.bottomPanelHeight,
          currentBranch: state.currentBranch,
          previewUrl: state.previewUrl,
          projectType: state.projectType,
        }),
      }
    )
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectActiveTab = (state: IDEState) =>
  state.openTabs.find(t => t.path === state.activeTabPath);

export const selectActiveFileContent = (state: IDEState) =>
  state.activeTabPath ? state.fileContents.get(state.activeTabPath) : undefined;

export const selectHasPendingDiff = (path: string) => (state: IDEState) =>
  state.pendingDiffs.has(path);

export const selectPendingDiff = (path: string) => (state: IDEState) =>
  state.pendingDiffs.get(path);

export const selectDirtyTabs = (state: IDEState) =>
  state.openTabs.filter(t => t.isDirty);

export const selectGitStagedFiles = (state: IDEState) =>
  state.gitStatus.filter(f => f.staged);

export const selectGitUnstagedFiles = (state: IDEState) =>
  state.gitStatus.filter(f => !f.staged);
