/**
 * Editor Context Service
 *
 * Gathers context from the active editor for AI requests.
 * Provides file content, selection, cursor position, and project structure.
 *
 * Priority order for code context:
 * 1. Selected text (if any)
 * 2. Active file contents
 * 3. Project structure overview
 */

import { editorManager } from '../core/editor/editorManager';
import { useIDEStore } from '../stores/ideStore';

// ========================================
// TYPES
// ========================================

export interface EditorSelection {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

export interface EditorContext {
  /** Active file path (relative to project root) */
  filePath: string | null;
  /** Active file content */
  code: string | null;
  /** Programming language */
  language: string | null;
  /** Selected text (if any) */
  selection: EditorSelection | null;
  /** Current cursor line (1-indexed) */
  cursorLine: number | null;
  /** Current cursor column (1-indexed) */
  cursorColumn: number | null;
  /** Project ID */
  projectId: string | null;
  /** Workspace files (for context) */
  workspaceFiles: string[];
}

export interface IDEContextBlock {
  /** Formatted context string for AI prompt */
  systemContext: string;
  /** Raw context data */
  raw: EditorContext;
}

// ========================================
// EDITOR CONTEXT SERVICE
// ========================================

class EditorContextService {
  /**
   * Get the current editor context
   */
  getContext(): EditorContext {
    const activeEditor = editorManager.getActiveEditor();
    const projectId = activeEditor?.projectId ?? null;

    // Get selection info
    let selection: EditorSelection | null = null;
    let cursorLine: number | null = null;
    let cursorColumn: number | null = null;

    if (activeEditor?.editor) {
      const monacoEditor = activeEditor.editor;
      const model = monacoEditor.getModel();
      const selectionObj = monacoEditor.getSelection();

      if (selectionObj && model) {
        cursorLine = selectionObj.startLineNumber;
        cursorColumn = selectionObj.startColumn;

        // Check if there's actual selected text
        const selectedText = model.getValueInRange(selectionObj);
        if (selectedText.length > 0) {
          selection = {
            startLine: selectionObj.startLineNumber,
            startColumn: selectionObj.startColumn,
            endLine: selectionObj.endLineNumber,
            endColumn: selectionObj.endColumn,
            text: selectedText,
          };
        }
      }
    }

    // Get workspace files
    const workspaceFiles = this.getWorkspaceFiles(projectId);

    return {
      filePath: activeEditor?.filePath ?? null,
      code: activeEditor?.editor?.getModel()?.getValue() ?? null,
      language: activeEditor?.editor?.getModel()?.getLanguageId() ?? null,
      selection,
      cursorLine,
      cursorColumn,
      projectId,
      workspaceFiles,
    };
  }

  /**
   * Get formatted IDE context block for AI system prompt
   */
  getIDEContextBlock(): IDEContextBlock {
    const ctx = this.getContext();

    const parts: string[] = [];

    // Current file info
    if (ctx.filePath) {
      parts.push(`Current file: ${ctx.filePath}`);
      if (ctx.language) {
        parts.push(`Language: ${ctx.language}`);
      }
    }

    // Cursor position
    if (ctx.cursorLine !== null) {
      parts.push(`Cursor: line ${ctx.cursorLine}${ctx.cursorColumn !== null ? `, column ${ctx.cursorColumn}` : ''}`);
    }

    // Selection
    if (ctx.selection) {
      parts.push(`Selection: lines ${ctx.selection.startLine}-${ctx.selection.endLine} (${ctx.selection.text.length} chars)`);
    }

    // Workspace files (limited)
    if (ctx.workspaceFiles.length > 0) {
      const files = ctx.workspaceFiles.slice(0, 20).join('\n  ');
      parts.push(`Workspace files:\n  ${files}${ctx.workspaceFiles.length > 20 ? `\n  ... and ${ctx.workspaceFiles.length - 20} more` : ''}`);
    }

    return {
      systemContext: parts.join('\n'),
      raw: ctx,
    };
  }

  /**
   * Get the code to send to AI (selection or full file)
   */
  getCodeForAI(): string | null {
    const ctx = this.getContext();

    // Priority 1: Selected text
    if (ctx.selection && ctx.selection.text.length > 0) {
      return ctx.selection.text;
    }

    // Priority 2: Full file content
    return ctx.code;
  }

  /**
   * Build the full AI request payload
   */
  buildAIRequest(userMessage: string): {
    message: string;
    context: EditorContext;
    code: string | null;
  } {
    const ctx = this.getContext();
    const code = this.getCodeForAI();

    return {
      message: userMessage,
      context: ctx,
      code,
    };
  }

  /**
   * Get workspace files (placeholder - would integrate with file explorer)
   */
  private getWorkspaceFiles(_projectId: string | null): string[] {
    try {
      const state = useIDEStore.getState();

      // Collect open tab paths
      const tabPaths = state.openTabs.map((t: { path: string }) => t.path);

      // Flatten file tree to get all file paths
      const flattenTree = (nodes: Array<{ path: string; type: string; children?: any[] }>): string[] =>
        nodes.flatMap(n =>
          n.type === 'file'
            ? [n.path]
            : flattenTree(n.children ?? [])
        );
      const treePaths = flattenTree(state.fileTree);

      // Merge and deduplicate, capped to avoid huge prompts
      const all = [...new Set([...tabPaths, ...treePaths])];
      return all.slice(0, 50);
    } catch {
      return [];
    }
  }

  /**
   * Format context for display in UI
   */
  formatContextSummary(): string {
    const ctx = this.getContext();

    if (!ctx.filePath) {
      return 'No file open';
    }

    let summary = ctx.filePath;

    if (ctx.selection) {
      summary += ` (selected lines ${ctx.selection.startLine}-${ctx.selection.endLine})`;
    } else if (ctx.cursorLine !== null) {
      summary += ` (line ${ctx.cursorLine})`;
    }

    return summary;
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const editorContextService = new EditorContextService();

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Quick access to current editor context
 */
export function getEditorContext(): EditorContext {
  return editorContextService.getContext();
}

/**
 * Quick access to IDE context block for prompts
 */
export function getIDEContextBlock(): IDEContextBlock {
  return editorContextService.getIDEContextBlock();
}

/**
 * Quick access to code for AI
 */
export function getCodeForAI(): string | null {
  return editorContextService.getCodeForAI();
}

export default editorContextService;
