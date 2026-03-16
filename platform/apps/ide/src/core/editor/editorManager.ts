/**
 * Editor Manager
 *
 * Centralized API for all Monaco editor operations.
 * UI components should NEVER talk directly to Monaco - always use EditorManager.
 *
 * Responsibilities:
 * - Editor instance registration and lifecycle
 * - File opening and model management
 * - Patch application (AI changes)
 * - Decorations (AI highlights, annotations)
 * - Multi-file operations
 * - Undo/redo coordination
 *
 * Architecture:
 *   UI Components
 *        │
 *   EditorManager  ← THIS MODULE
 *        │
 *   editorService / Monaco API
 */

import type * as Monaco from 'monaco-editor';
import { editorService } from './editorService';
import { editorModelManager } from './modelManager';
import { addFilesToRegistry } from '../../workspace/fileRegistry';
import { ensureContainer } from '../runtime/webcontainerManager';

// ========================================
// TYPES
// ========================================

export class TransactionError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TransactionError';
  }
}

export interface EditorInstance {
  id: string;
  editor: Monaco.editor.IStandaloneCodeEditor;
  monaco: typeof Monaco;
  projectId: string;
  filePath: string;
  registeredAt: number;
}

export interface TextPatch {
  /** File path to apply patch to */
  filePath: string;
  /** Start line (1-based) */
  startLine: number;
  /** Start column (1-based) */
  startColumn: number;
  /** End line (1-based) */
  endLine: number;
  /** End column (1-based) */
  endColumn: number;
  /** Text to replace (for validation) */
  oldText?: string;
  /** New text to insert */
  newText: string;
  /** Patch source */
  source: 'ai' | 'user' | 'collab';
  /** Unique identifier for this patch */
  patchId: string;
  /** File version at patch generation time */
  fileVersion?: number;
  /** Model version ID (Monaco's internal version) */
  modelVersionId?: number;
  /** Hash of file content at patch generation */
  contentHash?: string;
}

export interface DecorationOptions {
  className?: string;
  inlineClassName?: string;
  hoverMessage?: string;
  glyphMarginClassName?: string;
  glyphMarginHoverMessage?: string;
  isWholeLine?: boolean;
}

export interface Decoration {
  id: string;
  range: Monaco.IRange;
  options: DecorationOptions;
}

export type EditorEvent =
  | { type: 'editor.registered'; editorId: string }
  | { type: 'editor.unregistered'; editorId: string }
  | { type: 'editor.activated'; editorId: string }
  | { type: 'file.opened'; projectId: string; filePath: string }
  | { type: 'file.closed'; projectId: string; filePath: string }
  | { type: 'patch.applied'; patchId: string; filePath: string }
  | { type: 'patch.reverted'; patchId: string; filePath: string }
  | { type: 'decoration.added'; decorationId: string };

type EditorEventCallback = (event: EditorEvent) => void;

// ========================================
// EDITOR MANAGER
// ========================================

class EditorManager {
  private editors = new Map<string, EditorInstance>();
  private activeEditorId: string | null = null;
  private decorations = new Map<string, Decoration[]>();
  private patchHistory = new Map<string, TextPatch[]>();
  private eventListeners = new Set<EditorEventCallback>();

  // Transaction state
  private transaction: {
    active: boolean;
    editorId: string | null;
    snapshot: string | null;
    patches: TextPatch[];
    decorations: { editorId: string; decorationIds: string[] }[];
  } | null = null;

  // Decoration scopes per task
  private decorationScopes = new Map<string, Set<string>>();

  // Model cleanup tracking
  private modelRefs = new Map<string, number>();

  // File version tracking
  private fileVersions = new Map<string, number>();
  private modelVersionCache = new Map<string, number>();

  // ========================================
  // EDITOR REGISTRATION
  // ========================================

  /**
   * Register a Monaco editor instance
   */
  registerEditor(
    id: string,
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
    projectId: string,
    filePath: string
  ): () => void {
    const instance: EditorInstance = {
      id,
      editor,
      monaco,
      projectId,
      filePath,
      registeredAt: Date.now(),
    };

    this.editors.set(id, instance);
    this.activeEditorId = id;

    // Open the file model
    editorService.openFileModel(monaco, projectId, filePath);

    this.emit({ type: 'editor.registered', editorId: id });

    // Return unregister function
    return () => this.unregisterEditor(id);
  }

  /**
   * Unregister a Monaco editor instance (full cleanup)
   */
  unregisterEditor(id: string): void {
    const instance = this.editors.get(id);
    if (!instance) return;

    // Dispose decorations first
    this.clearDecorations(id);

    // Clear decoration scopes for this editor
    for (const [, scope] of this.decorationScopes) {
      scope.delete(id);
    }

    // Close the file model (decrements ref count)
    editorService.closeFileModel(instance.projectId, instance.filePath);

    // Decrement model reference
    const modelKey = `${instance.projectId}:${instance.filePath}`;
    const refs = this.modelRefs.get(modelKey) ?? 1;
    if (refs <= 1) {
      this.modelRefs.delete(modelKey);
    } else {
      this.modelRefs.set(modelKey, refs - 1);
    }

    // Dispose editor instance
    try {
      instance.editor.dispose();
    } catch (error) {
      console.warn('[EditorManager] Error disposing editor:', error);
    }

    // Remove from registry
    this.editors.delete(id);

    // Update active editor
    if (this.activeEditorId === id) {
      this.activeEditorId = this.editors.size > 0
        ? [...this.editors.keys()][0]
        : null;
    }

    this.emit({ type: 'editor.unregistered', editorId: id });
  }

  /**
   * Dispose a specific editor (alias for unregisterEditor with explicit cleanup)
   */
  disposeEditor(id: string): void {
    this.unregisterEditor(id);
  }

  /**
   * Reset workspace (dispose all editors for a project)
   */
  resetWorkspace(projectId: string): void {
    const editorsToDispose: string[] = [];

    for (const [id, instance] of this.editors) {
      if (instance.projectId === projectId) {
        editorsToDispose.push(id);
      }
    }

    for (const id of editorsToDispose) {
      this.disposeEditor(id);
    }

    // Clear patch history for project
    for (const [filePath, patches] of this.patchHistory) {
      const filtered = patches.filter(p => !p.filePath.startsWith(projectId));
      if (filtered.length === 0) {
        this.patchHistory.delete(filePath);
      } else {
        this.patchHistory.set(filePath, filtered);
      }
    }

    console.log(`[EditorManager] Reset workspace: ${projectId}, disposed ${editorsToDispose.length} editors`);
  }

  /**
   * Get active editor instance
   */
  getActiveEditor(): EditorInstance | null {
    if (!this.activeEditorId) return null;
    return this.editors.get(this.activeEditorId) ?? null;
  }

  /**
   * Get editor by ID
   */
  getEditor(id: string): EditorInstance | null {
    return this.editors.get(id) ?? null;
  }

  /**
   * Get editor for a specific file
   */
  getEditorForFile(projectId: string, filePath: string): EditorInstance | null {
    for (const instance of this.editors.values()) {
      if (instance.projectId === projectId && instance.filePath === filePath) {
        return instance;
      }
    }
    return null;
  }

  /**
   * Set active editor
   */
  setActiveEditor(id: string): void {
    if (!this.editors.has(id)) return;
    this.activeEditorId = id;
    this.emit({ type: 'editor.activated', editorId: id });
  }

  /**
   * Get all registered editors
   */
  getAllEditors(): EditorInstance[] {
    return [...this.editors.values()];
  }

  // ========================================
  // FILE OPERATIONS
  // ========================================

  /**
   * Open a file in an editor
   */
  openFile(
    editorId: string,
    projectId: string,
    filePath: string
  ): Monaco.editor.ITextModel | null {
    const instance = this.editors.get(editorId);
    if (!instance) return null;

    // Close previous file if different
    if (instance.filePath !== filePath || instance.projectId !== projectId) {
      editorService.closeFileModel(instance.projectId, instance.filePath);
    }

    // Open new file
    const fileModel = editorService.openFileModel(instance.monaco, projectId, filePath);
    instance.editor.setModel(fileModel.model);
    instance.projectId = projectId;
    instance.filePath = filePath;

    this.emit({ type: 'file.opened', projectId, filePath });

    return fileModel.model;
  }

  /**
   * Close a file
   */
  closeFile(projectId: string, filePath: string): void {
    const instance = this.getEditorForFile(projectId, filePath);
    if (instance) {
      editorService.closeFileModel(projectId, filePath);
      this.emit({ type: 'file.closed', projectId, filePath });
    }
  }

  /**
   * Get model for a file
   */
  getModel(projectId: string, filePath: string): Monaco.editor.ITextModel | null {
    const key = editorModelManager.key(projectId, filePath);
    return editorModelManager.get(key)?.model ?? null;
  }

  /**
   * Get file content
   */
  getFileContent(projectId: string, filePath: string): string | null {
    const model = this.getModel(projectId, filePath);
    return model?.getValue() ?? null;
  }

  /**
   * Set file content
   */
  setFileContent(projectId: string, filePath: string, content: string): boolean {
    const model = this.getModel(projectId, filePath);
    if (!model) return false;

    model.setValue(content);
    
    // Update version tracking
    const key = `${projectId}:${filePath}`;
    const currentVersion = this.fileVersions.get(key) ?? 0;
    this.fileVersions.set(key, currentVersion + 1);
    
    return true;
  }

  // ========================================
  // FILE VERSION TRACKING
  // ========================================

  /**
   * Get current file version
   */
  getFileVersion(projectId: string, filePath: string): number {
    const key = `${projectId}:${filePath}`;
    return this.fileVersions.get(key) ?? 0;
  }

  /**
   * Get model version ID (Monaco's internal version)
   */
  getModelVersionId(projectId: string, filePath: string): number | null {
    const model = this.getModel(projectId, filePath);
    return model?.getVersionId() ?? null;
  }

  /**
   * Increment file version (called on edit)
   */
  incrementFileVersion(projectId: string, filePath: string): void {
    const key = `${projectId}:${filePath}`;
    const currentVersion = this.fileVersions.get(key) ?? 0;
    this.fileVersions.set(key, currentVersion + 1);
  }

  /**
   * Verify file version matches expected
   */
  verifyFileVersion(
    projectId: string,
    filePath: string,
    expectedVersion?: number,
    expectedModelVersionId?: number
  ): { valid: boolean; reason?: string } {
    // If no version specified, skip verification
    if (expectedVersion === undefined && expectedModelVersionId === undefined) {
      return { valid: true };
    }

    const key = `${projectId}:${filePath}`;

    // Check file version
    if (expectedVersion !== undefined) {
      const currentVersion = this.fileVersions.get(key) ?? 0;
      if (currentVersion !== expectedVersion) {
        return {
          valid: false,
          reason: `File version mismatch: expected ${expectedVersion}, current is ${currentVersion}`,
        };
      }
    }

    // Check Monaco model version
    if (expectedModelVersionId !== undefined) {
      const model = this.getModel(projectId, filePath);
      if (!model) {
        return {
          valid: false,
          reason: 'Model not found',
        };
      }
      const currentModelVersion = model.getVersionId();
      if (currentModelVersion !== expectedModelVersionId) {
        return {
          valid: false,
          reason: `Model version mismatch: expected ${expectedModelVersionId}, current is ${currentModelVersion}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Generate content hash for verification
   */
  generateContentHash(content: string): string {
    // Simple hash function for content verification
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * Verify content hash matches
   */
  verifyContentHash(
    projectId: string,
    filePath: string,
    expectedHash?: string
  ): { valid: boolean; reason?: string } {
    if (!expectedHash) {
      return { valid: true };
    }

    const content = this.getFileContent(projectId, filePath);
    if (content === null) {
      return { valid: false, reason: 'File not found' };
    }

    const currentHash = this.generateContentHash(content);
    if (currentHash !== expectedHash) {
      return {
        valid: false,
        reason: `Content hash mismatch: file was modified since patch generation`,
      };
    }

    return { valid: true };
  }

  // ========================================
  // PATCH OPERATIONS (AI CHANGES)
  // ========================================

  /**
   * Begin a transaction for atomic patch application
   * @throws TransactionError if a transaction is already active (nested transactions not allowed)
   */
  beginTransaction(editorId: string): boolean {
    // Prevent nested transactions
    if (this.transaction?.active) {
      throw new TransactionError(
        'Cannot begin transaction: another transaction is already active. Nested transactions are not allowed.',
        'NESTED_TRANSACTION_NOT_ALLOWED'
      );
    }

    const instance = this.editors.get(editorId);
    if (!instance) return false;

    const model = instance.editor.getModel();
    if (!model) return false;

    this.transaction = {
      active: true,
      editorId,
      snapshot: model.getValue(),
      patches: [],
      decorations: [],
    };

    return true;
  }

  /**
   * Commit transaction (finalize all changes)
   */
  commitTransaction(): boolean {
    if (!this.transaction?.active) {
      console.warn('[EditorManager] No active transaction to commit');
      return false;
    }

    // Verify model state
    const instance = this.editors.get(this.transaction.editorId!);
    if (!instance) {
      this.rollbackTransaction();
      return false;
    }

    const model = instance.editor.getModel();
    if (!model) {
      this.rollbackTransaction();
      return false;
    }

    // Transaction successful - store patches in history
    for (const patch of this.transaction.patches) {
      const history = this.patchHistory.get(patch.filePath) ?? [];
      history.push(patch);
      this.patchHistory.set(patch.filePath, history);
    }

    this.transaction = null;
    return true;
  }

  /**
   * Rollback transaction (restore snapshot)
   */
  rollbackTransaction(): boolean {
    if (!this.transaction?.active) {
      console.warn('[EditorManager] No active transaction to rollback');
      return false;
    }

    const instance = this.editors.get(this.transaction.editorId!);
    if (!instance || !this.transaction.snapshot) {
      this.transaction = null;
      return false;
    }

    const model = instance.editor.getModel();
    if (!model) {
      this.transaction = null;
      return false;
    }

    // Restore snapshot
    model.setValue(this.transaction.snapshot);

    // Remove any decorations added during transaction
    for (const { editorId, decorationIds } of this.transaction.decorations) {
      this.removeDecorations(editorId, decorationIds);
    }

    console.log('[EditorManager] Transaction rolled back');
    this.transaction = null;
    return true;
  }

  /**
   * Check if transaction is active
   */
  isTransactionActive(): boolean {
    return this.transaction?.active ?? false;
  }

  /**
   * Apply a text patch (for AI changes)
   */
  applyPatch(patch: TextPatch): boolean {
    const instance = this.getEditorForFile(patch.filePath.includes('/')
      ? patch.filePath.split('/')[0]
      : '', patch.filePath);

    // Try to find editor with matching file
    let targetInstance: EditorInstance | null = null;
    for (const inst of this.editors.values()) {
      if (inst.filePath === patch.filePath) {
        targetInstance = inst;
        break;
      }
    }

    if (!targetInstance) {
      // Try to get model directly
      const model = this.getModel('', patch.filePath);
      if (!model) {
        console.error(`[EditorManager] No model found for patch: ${patch.filePath}`);
        return false;
      }

      // Apply patch to model directly
      return this.applyPatchToModel(model, patch, '');
    }

    const model = targetInstance.editor.getModel();
    if (!model) return false;

    const success = this.applyPatchToModel(model, patch, targetInstance.id);
    if (success) {
      // Store in patch history for potential revert
      const history = this.patchHistory.get(patch.filePath) ?? [];
      history.push(patch);
      this.patchHistory.set(patch.filePath, history);

      this.emit({ type: 'patch.applied', patchId: patch.patchId, filePath: patch.filePath });
    }

    return success;
  }

  /**
   * Apply patch to a model
   */
  private applyPatchToModel(
    model: Monaco.editor.ITextModel,
    patch: TextPatch,
    editorId: string
  ): boolean {
    const { monaco } = this.editors.values().next().value ?? { monaco: null };
    if (!monaco) return false;

    // Create range
    const range = new monaco.Range(
      patch.startLine,
      patch.startColumn,
      patch.endLine,
      patch.endColumn
    );

    // Validate old text if provided
    if (patch.oldText) {
      const currentText = model.getValueInRange(range);
      if (currentText !== patch.oldText) {
        console.warn(
          `[EditorManager] Patch validation failed: old text mismatch for patch ${patch.patchId}`
        );
        // Still apply - but log warning
      }
    }

    // Apply edit
    model.pushEditOperations(
      [],
      [{ range, text: patch.newText, forceMoveMarkers: true }],
      () => null
    );

    return true;
  }

  /**
   * Apply multiple patches atomically
   */
  applyPatches(patches: TextPatch[]): { applied: string[]; failed: string[] } {
    const applied: string[] = [];
    const failed: string[] = [];
    const newFiles: string[] = [];
    const modifiedFiles = new Set<string>();

    for (const patch of patches) {
      const success = this.applyPatch(patch);
      if (success) {
        applied.push(patch.patchId);
        
        // Track new files and modified files
        if (patch.path) {
          if (!newFiles.includes(patch.path)) {
            newFiles.push(patch.path);
          }
          modifiedFiles.add(patch.path);
        }
      } else {
        failed.push(patch.patchId);
      }
    }

    // Add new files to registry
    if (newFiles.length > 0) {
      addFilesToRegistry(newFiles);
    }

    // Sync modified files to WebContainer
    if (modifiedFiles.size > 0) {
      this.syncToWebContainer(Array.from(modifiedFiles)).catch(err => {
        console.warn('Failed to sync files to WebContainer:', err);
      });
    }

    return { applied, failed };
  }

  /**
   * Sync editor models to WebContainer filesystem
   */
  private async syncToWebContainer(filePaths: string[]): Promise<void> {
    try {
      const container = await ensureContainer();
      
      // Get current working directory
      let baseDir = '';
      try {
        const entries = await container.fs.readdir('.');
        // Check if we're already in the project dir or need to find it
        if (entries.some(e => e.name === 'package.json')) {
          baseDir = '.';
        } else {
          // Look for project directory
          for (const entry of entries) {
            if (entry.isDirectory()) {
              try {
                const subEntries = await container.fs.readdir(entry.name);
                if (subEntries.some(e => e.name === 'package.json')) {
                  baseDir = entry.name;
                  break;
                }
              } catch (e) {
                // Ignore
              }
            }
          }
        }
      } catch (e) {
        baseDir = '.';
      }
      
      console.log(`[EditorManager] WebContainer base dir: ${baseDir || '.'}`);
      
      for (const path of filePaths) {
        const model = this.getModel('', path);
        if (model) {
          const content = model.getValue();
          
          // Ensure directory exists
          const dir = path.substring(0, path.lastIndexOf('/'));
          if (dir) {
            try {
              const fullDir = baseDir ? `${baseDir}/${dir}` : dir;
              await container.fs.mkdir(fullDir, { recursive: true });
            } catch (e) {
              // Directory might already exist
            }
          }
          
          // Write file to WebContainer
          const fullPath = baseDir ? `${baseDir}/${path}` : path;
          await container.fs.writeFile(fullPath, content, 'utf-8');
          console.log(`[EditorManager] Synced ${path} to WebContainer at ${fullPath}`);
        }
      }
    } catch (e) {
      console.error('[EditorManager] Failed to sync to WebContainer:', e);
    }
  }

  /**
   * Revert a patch
   */
  revertPatch(patchId: string): boolean {
    // Find patch in history
    for (const [filePath, patches] of this.patchHistory.entries()) {
      const patchIndex = patches.findIndex(p => p.patchId === patchId);
      if (patchIndex === -1) continue;

      const patch = patches[patchIndex];
      const model = this.getModel('', filePath);
      if (!model) return false;

      // Create inverse patch
      const revertPatch: TextPatch = {
        ...patch,
        newText: patch.oldText ?? '',
        oldText: patch.newText,
        patchId: `revert-${patchId}`,
      };

      const success = this.applyPatchToModel(model, revertPatch, '');
      if (success) {
        // Remove from history
        patches.splice(patchIndex, 1);
        this.emit({ type: 'patch.reverted', patchId, filePath });
      }

      return success;
    }

    return false;
  }

  /**
   * Get patch history for a file
   */
  getPatchHistory(filePath: string): TextPatch[] {
    return this.patchHistory.get(filePath) ?? [];
  }

  // ========================================
  // DECORATIONS (AI HIGHLIGHTS)
  // ========================================

  /**
   * Add decorations to an editor (for AI highlights)
   */
  addDecorations(
    editorId: string,
    decorations: Array<{ range: Monaco.IRange; options: DecorationOptions }>
  ): string[] {
    const instance = this.editors.get(editorId);
    if (!instance) return [];

    const decorationIds = instance.editor.deltaDecorations(
      [],
      decorations.map(d => ({
        range: d.range,
        options: {
          inlineClassName: d.options.inlineClassName,
          className: d.options.className,
          hoverMessage: d.options.hoverMessage
            ? { value: d.options.hoverMessage }
            : undefined,
          isWholeLine: d.options.isWholeLine,
          glyphMarginClassName: d.options.glyphMarginClassName,
          glyphMarginHoverMessage: d.options.glyphMarginHoverMessage
            ? { value: d.options.glyphMarginHoverMessage }
            : undefined,
        },
      }))
    );

    // Store decorations
    const existing = this.decorations.get(editorId) ?? [];
    decorationIds.forEach((id, i) => {
      existing.push({
        id,
        range: decorations[i].range,
        options: decorations[i].options,
      });
    });
    this.decorations.set(editorId, existing);

    decorationIds.forEach(id => {
      this.emit({ type: 'decoration.added', decorationId: id });
    });

    return decorationIds;
  }

  /**
   * Remove decorations from an editor
   */
  removeDecorations(editorId: string, decorationIds: string[]): void {
    const instance = this.editors.get(editorId);
    if (!instance) return;

    // Pass empty array for decorations we want to remove
    instance.editor.deltaDecorations(decorationIds, []);

    // Update stored decorations
    const existing = this.decorations.get(editorId) ?? [];
    this.decorations.set(
      editorId,
      existing.filter(d => !decorationIds.includes(d.id))
    );
  }

  /**
   * Clear all decorations for an editor
   */
  clearDecorations(editorId: string): void {
    const instance = this.editors.get(editorId);
    const decorations = this.decorations.get(editorId);
    if (!instance || !decorations) return;

    instance.editor.deltaDecorations(
      decorations.map(d => d.id),
      []
    );

    this.decorations.delete(editorId);
  }

  /**
   * Clear all decorations for a task (scoped cleanup)
   */
  clearDecorationsForTask(taskId: string): void {
    const scope = this.decorationScopes.get(taskId);
    if (!scope) return;

    for (const editorId of scope) {
      const instance = this.editors.get(editorId);
      const decorations = this.decorations.get(editorId);
      if (!instance || !decorations) continue;

      // Remove all decorations for this editor
      instance.editor.deltaDecorations(
        decorations.map(d => d.id),
        []
      );

      this.decorations.delete(editorId);
    }

    this.decorationScopes.delete(taskId);
  }

  /**
   * Add decorations scoped to a task
   */
  addDecorationsScoped(
    taskId: string,
    editorId: string,
    decorations: Array<{ range: Monaco.IRange; options: DecorationOptions }>
  ): string[] {
    const decorationIds = this.addDecorations(editorId, decorations);

    // Track in scope
    if (!this.decorationScopes.has(taskId)) {
      this.decorationScopes.set(taskId, new Set());
    }
    this.decorationScopes.get(taskId)!.add(editorId);

    return decorationIds;
  }

  /**
   * Get decoration scope for a task
   */
  getDecorationScope(taskId: string): Set<string> | undefined {
    return this.decorationScopes.get(taskId);
  }

  /**
   * Add AI change highlight decorations
   */
  highlightAIChanges(
    editorId: string,
    changes: Array<{ startLine: number; endLine: number; type: 'add' | 'delete' | 'modify' }>
  ): string[] {
    return this.addDecorations(
      editorId,
      changes.map(c => ({
        range: {
          startLineNumber: c.startLine,
          startColumn: 1,
          endLineNumber: c.endLine,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: `ai-change-${c.type}`,
          glyphMarginClassName: `ai-glyph-${c.type}`,
          hoverMessage: `AI ${c.type}ion`,
        },
      }))
    );
  }

  // ========================================
  // EDITOR ACTIONS
  // ========================================

  /**
   * Reveal a range in the editor (scroll to)
   */
  revealRange(
    editorId: string,
    range: Monaco.IRange,
    center?: boolean
  ): void {
    const instance = this.editors.get(editorId);
    if (!instance) return;

    if (center) {
      instance.editor.revealRangeInCenter(range);
    } else {
      instance.editor.revealRange(range);
    }
  }

  /**
   * Reveal a line in the editor
   */
  revealLine(editorId: string, lineNumber: number): void {
    const instance = this.editors.get(editorId);
    if (!instance) return;

    instance.editor.revealLineInCenter(lineNumber);
  }

  /**
   * Set selection in editor
   */
  setSelection(
    editorId: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number
  ): void {
    const instance = this.editors.get(editorId);
    if (!instance) return;

    const { monaco } = instance;
    instance.editor.setSelection(
      new monaco.Range(startLine, startColumn, endLine, endColumn)
    );
  }

  /**
   * Focus an editor
   */
  focusEditor(editorId: string): void {
    const instance = this.editors.get(editorId);
    if (!instance) return;

    instance.editor.focus();
  }

  /**
   * Execute editor command
   */
  executeCommand(editorId: string, command: string): void {
    const instance = this.editors.get(editorId);
    if (!instance) return;

    instance.editor.trigger('editorManager', command, null);
  }

  /**
   * Format document
   */
  formatDocument(editorId: string): void {
    const instance = this.editors.get(editorId);
    if (!instance) return;

    instance.editor.getAction('editor.action.formatDocument')?.run();
  }

  // ========================================
  // UNDO/REDO
  // ========================================

  /**
   * Undo last change in editor
   */
  undo(editorId: string): void {
    const instance = this.editors.get(editorId);
    if (!instance) return;

    instance.editor.trigger('editorManager', 'undo', null);
  }

  /**
   * Redo last undone change in editor
   */
  redo(editorId: string): void {
    const instance = this.editors.get(editorId);
    if (!instance) return;

    instance.editor.trigger('editorManager', 'redo', null);
  }

  // ========================================
  // EVENTS
  // ========================================

  /**
   * Subscribe to editor events
   */
  subscribe(callback: EditorEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  /**
   * Emit an event
   */
  private emit(event: EditorEvent): void {
    this.eventListeners.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('[EditorManager] Event listener error:', error);
      }
    });
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Dispose all editors and resources
   */
  dispose(): void {
    for (const instance of this.editors.values()) {
      instance.editor.dispose();
    }
    this.editors.clear();
    this.decorations.clear();
    this.patchHistory.clear();
    this.eventListeners.clear();
    editorService.disposeAll();
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const editorManager = new EditorManager();

// ========================================
// CSS CLASSES FOR AI DECORATIONS
// ========================================

/**
 * CSS styles for AI decorations (inject into document)
 */
export const AI_DECORATION_STYLES = `
/* AI Change Decorations */
.ai-change-add {
  background-color: rgba(0, 255, 100, 0.15);
  border-left: 3px solid rgba(0, 255, 100, 0.6);
}

.ai-change-delete {
  background-color: rgba(255, 0, 0, 0.15);
  border-left: 3px solid rgba(255, 0, 0, 0.6);
}

.ai-change-modify {
  background-color: rgba(255, 200, 0, 0.15);
  border-left: 3px solid rgba(255, 200, 0, 0.6);
}

.ai-glyph-add {
  background-color: rgba(0, 255, 100, 0.8);
  margin-left: 3px;
}

.ai-glyph-delete {
  background-color: rgba(255, 0, 0, 0.8);
  margin-left: 3px;
}

.ai-glyph-modify {
  background-color: rgba(255, 200, 0, 0.8);
  margin-left: 3px;
}

/* AI Suggestion Decorations */
.ai-suggestion {
  background-color: rgba(100, 149, 237, 0.15);
  border-left: 3px solid rgba(100, 149, 237, 0.6);
}

.ai-suggestion-inline {
  background-color: rgba(100, 149, 237, 0.2);
  text-decoration: underline wavy rgba(100, 149, 237, 0.8);
}
`;
