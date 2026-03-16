/**
 * Workspace Module
 * 
 * The only interface for agents to interact with project files.
 */

export {
  WorkspaceFS,
  createWorkspace,
} from './workspace_fs.js';

export {
  FileEntry,
  SearchResult,
  PatchResult,
  PatchError,
  WorkspaceConfig,
  ReadFileOptions,
  WriteFileOptions,
  SearchOptions,
  WorkspaceStats,
  FileChangeEvent,
  FileChangeListener,
  DEFAULT_WORKSPACE_CONFIG,
  WorkspaceSafetyError,
  FileNotFoundError,
  PatchApplicationError,
} from './workspace_types.js';
