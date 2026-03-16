/**
 * AI Decorations
 *
 * Specialized Monaco decoration functions for AI-generated changes.
 * Provides visual indicators for additions, deletions, suggestions, and annotations.
 *
 * Features:
 * - AI change highlighting (add/delete/modify)
 * - Inline suggestions with ghost text
 * - Execution progress indicators
 * - Error/warning annotations
 * - Hover tooltips with AI context
 *
 * Decoration Types:
 * - ai-change-add: Green highlight for additions
 * - ai-change-delete: Red highlight for deletions
 * - ai-change-modify: Yellow highlight for modifications
 * - ai-suggestion: Blue highlight for suggestions
 * - ai-error: Red underline for errors
 * - ai-warning: Yellow underline for warnings
 *
 * Architecture:
 *   AI Agent → Patch → EditorManager
 *       │
 *   aiDecorations ← THIS MODULE
 *       │
 *   Monaco deltaDecorations API
 */

import type * as Monaco from 'monaco-editor';
import { editorManager } from './editorManager';

// ========================================
// TYPES
// ========================================

export interface AIChangeDecoration {
  id: string;
  type: 'add' | 'delete' | 'modify' | 'suggestion';
  range: Monaco.IRange;
  content?: string;
  hoverMessage?: string;
  source: string;
  timestamp: number;
}

export interface AIAnnotationDecoration {
  id: string;
  type: 'error' | 'warning' | 'info' | 'success';
  range: Monaco.IRange;
  message: string;
  actions?: Array<{
    label: string;
    action: () => void;
  }>;
}

export interface AISuggestionDecoration {
  id: string;
  range: Monaco.IRange;
  suggestion: string;
  acceptCommand?: string;
  rejectCommand?: string;
}

export interface AIProgressDecoration {
  id: string;
  line: number;
  message: string;
  progress: number;
}

// ========================================
// DECORATION MANAGER
// ========================================

class AIDecorationsManager {
  private decorations = new Map<string, AIChangeDecoration[]>();
  private annotations = new Map<string, AIAnnotationDecoration[]>();
  private suggestions = new Map<string, AISuggestionDecoration[]>();
  private progressIndicators = new Map<string, AIProgressDecoration[]>();

  // ========================================
  // AI CHANGE HIGHLIGHTS
  // ========================================

  /**
   * Highlight AI changes in an editor
   */
  highlightChanges(
    editorId: string,
    changes: Array<{
      startLine: number;
      endLine: number;
      type: 'add' | 'delete' | 'modify';
      hoverMessage?: string;
    }>
  ): string[] {
    const decorations = changes.map(c => ({
      range: {
        startLineNumber: c.startLine,
        startColumn: 1,
        endLineNumber: c.endLine,
        endColumn: Number.MAX_SAFE_INTEGER,
      },
      options: {
        isWholeLine: true,
        className: `ai-change-${c.type}`,
        glyphMarginClassName: `ai-glyph-${c.type}`,
        glyphMarginHoverMessage: c.hoverMessage,
        hoverMessage: c.hoverMessage,
      },
    }));

    return editorManager.addDecorations(editorId, decorations);
  }

  /**
   * Highlight a single line change
   */
  highlightLine(
    editorId: string,
    lineNumber: number,
    type: 'add' | 'delete' | 'modify',
    message?: string
  ): string[] {
    return this.highlightChanges(editorId, [{
      startLine: lineNumber,
      endLine: lineNumber,
      type,
      hoverMessage: message,
    }]);
  }

  /**
   * Highlight a range of changes
   */
  highlightRange(
    editorId: string,
    startLine: number,
    endLine: number,
    type: 'add' | 'delete' | 'modify',
    message?: string
  ): string[] {
    return this.highlightChanges(editorId, [{
      startLine,
      endLine,
      type,
      hoverMessage: message,
    }]);
  }

  /**
   * Clear all AI change highlights
   */
  clearChanges(editorId: string): void {
    editorManager.clearDecorations(editorId);
    this.decorations.delete(editorId);
  }

  // ========================================
  // INLINE SUGGESTIONS (Ghost Text)
  // ========================================

  /**
   * Add inline suggestion (ghost text)
   * Note: Monaco ghost text requires editor options, using decoration fallback
   */
  addSuggestion(
    editorId: string,
    lineNumber: number,
    column: number,
    suggestion: string,
    _options?: {
      acceptCommand?: string;
      rejectCommand?: string;
    }
  ): string[] {
    const instance = editorManager.getEditor(editorId);
    if (!instance) return [];

    const { monaco, editor } = instance;

    // Use after content decoration for suggestion preview
    const decorations = editor.deltaDecorations([], [{
      range: new monaco.Range(lineNumber, column, lineNumber, column),
      options: {
        after: {
          content: suggestion,
          inlineClassName: 'ai-ghost-text',
        },
        hoverMessage: { value: `**AI Suggestion**\n\n${suggestion}\n\nPress Tab to accept, Esc to reject` },
      },
    }]);

    // Store suggestion
    const existing = this.suggestions.get(editorId) ?? [];
    existing.push({
      id: decorations[0],
      range: { startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column },
      suggestion,
    });
    this.suggestions.set(editorId, existing);

    return decorations;
  }

  /**
   * Remove inline suggestion
   */
  removeSuggestion(editorId: string, suggestionId: string): void {
    const instance = editorManager.getEditor(editorId);
    if (!instance) return;

    instance.editor.deltaDecorations([suggestionId], []);

    const existing = this.suggestions.get(editorId) ?? [];
    this.suggestions.set(
      editorId,
      existing.filter(s => s.id !== suggestionId)
    );
  }

  /**
   * Clear all suggestions
   */
  clearSuggestions(editorId: string): void {
    const instance = editorManager.getEditor(editorId);
    const suggestions = this.suggestions.get(editorId);
    if (!instance || !suggestions) return;

    instance.editor.deltaDecorations(
      suggestions.map(s => s.id),
      []
    );
    this.suggestions.delete(editorId);
  }

  // ========================================
  // ANNOTATIONS (Errors, Warnings)
  // ========================================

  /**
   * Add error annotation
   */
  addError(
    editorId: string,
    lineNumber: number,
    message: string,
    column?: number
  ): string[] {
    return this.addAnnotation(editorId, lineNumber, 'error', message, column);
  }

  /**
   * Add warning annotation
   */
  addWarning(
    editorId: string,
    lineNumber: number,
    message: string,
    column?: number
  ): string[] {
    return this.addAnnotation(editorId, lineNumber, 'warning', message, column);
  }

  /**
   * Add info annotation
   */
  addInfo(
    editorId: string,
    lineNumber: number,
    message: string,
    column?: number
  ): string[] {
    return this.addAnnotation(editorId, lineNumber, 'info', message, column);
  }

  /**
   * Add annotation (generic)
   */
  addAnnotation(
    editorId: string,
    lineNumber: number,
    type: 'error' | 'warning' | 'info' | 'success',
    message: string,
    column?: number
  ): string[] {
    const instance = editorManager.getEditor(editorId);
    if (!instance) return [];

    const { monaco, editor } = instance;
    const col = column ?? 1;

    const severityMap = {
      error: monaco.MarkerSeverity.Error,
      warning: monaco.MarkerSeverity.Warning,
      info: monaco.MarkerSeverity.Info,
      success: monaco.MarkerSeverity.Hint,
    };

    // Add model marker
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, 'ai-decorations', [{
        severity: severityMap[type],
        message,
        startLineNumber: lineNumber,
        startColumn: col,
        endLineNumber: lineNumber,
        endColumn: col + 1,
      }]);
    }

    // Add decoration
    const decorations = editor.deltaDecorations([], [{
      range: new monaco.Range(lineNumber, col, lineNumber, col),
      options: {
        isWholeLine: false,
        inlineClassName: `ai-annotation-${type}`,
        hoverMessage: { value: message },
      },
    }]);

    // Store annotation
    const existing = this.annotations.get(editorId) ?? [];
    existing.push({
      id: decorations[0],
      type,
      range: { startLineNumber: lineNumber, startColumn: col, endLineNumber: lineNumber, endColumn: col },
      message,
    });
    this.annotations.set(editorId, existing);

    return decorations;
  }

  /**
   * Clear all annotations
   */
  clearAnnotations(editorId: string): void {
    const instance = editorManager.getEditor(editorId);
    const annotations = this.annotations.get(editorId);
    if (!instance || !annotations) return;

    instance.editor.deltaDecorations(
      annotations.map(a => a.id),
      []
    );

    // Clear model markers
    const model = instance.editor.getModel();
    if (model) {
      instance.monaco.editor.setModelMarkers(model, 'ai-decorations', []);
    }

    this.annotations.delete(editorId);
  }

  // ========================================
  // PROGRESS INDICATORS
  // ========================================

  /**
   * Show execution progress on a line
   */
  showProgress(
    editorId: string,
    lineNumber: number,
    message: string,
    progress: number
  ): string[] {
    const instance = editorManager.getEditor(editorId);
    if (!instance) return [];

    const { monaco, editor } = instance;

    const decorations = editor.deltaDecorations([], [{
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: 'ai-progress-line',
        glyphMarginClassName: progress < 100 ? 'ai-progress-spinner' : 'ai-progress-complete',
        glyphMarginHoverMessage: { value: `${message} (${progress}%)` },
        hoverMessage: { value: `**${message}**\n\nProgress: ${progress}%` },
      },
    }]);

    // Store progress
    const existing = this.progressIndicators.get(editorId) ?? [];
    existing.push({ id: decorations[0], line: lineNumber, message, progress });
    this.progressIndicators.set(editorId, existing);

    return decorations;
  }

  /**
   * Update progress
   */
  updateProgress(
    editorId: string,
    progressId: string,
    message: string,
    progress: number
  ): void {
    const instance = editorManager.getEditor(editorId);
    const indicators = this.progressIndicators.get(editorId);
    if (!instance || !indicators) return;

    const indicator = indicators.find(i => i.id === progressId);
    if (!indicator) return;

    // Update stored indicator
    indicator.message = message;
    indicator.progress = progress;

    // Re-apply decoration
    const { monaco, editor } = instance;
    editor.deltaDecorations([progressId], [{
      range: new monaco.Range(indicator.line, 1, indicator.line, 1),
      options: {
        isWholeLine: true,
        className: 'ai-progress-line',
        glyphMarginClassName: progress < 100 ? 'ai-progress-spinner' : 'ai-progress-complete',
        glyphMarginHoverMessage: { value: `${message} (${progress}%)` },
      },
    }]);
  }

  /**
   * Clear progress indicators
   */
  clearProgress(editorId: string): void {
    const instance = editorManager.getEditor(editorId);
    const indicators = this.progressIndicators.get(editorId);
    if (!instance || !indicators) return;

    instance.editor.deltaDecorations(
      indicators.map(i => i.id),
      []
    );
    this.progressIndicators.delete(editorId);
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  /**
   * Clear all AI decorations for an editor
   */
  clearAll(editorId: string): void {
    this.clearChanges(editorId);
    this.clearSuggestions(editorId);
    this.clearAnnotations(editorId);
    this.clearProgress(editorId);
  }

  /**
   * Get all decorations for an editor
   */
  getDecorations(editorId: string): {
    changes: AIChangeDecoration[];
    annotations: AIAnnotationDecoration[];
    suggestions: AISuggestionDecoration[];
    progress: AIProgressDecoration[];
  } {
    return {
      changes: this.decorations.get(editorId) ?? [],
      annotations: this.annotations.get(editorId) ?? [],
      suggestions: this.suggestions.get(editorId) ?? [],
      progress: this.progressIndicators.get(editorId) ?? [],
    };
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const aiDecorations = new AIDecorationsManager();

// ========================================
// CSS STYLES FOR DECORATIONS
// ========================================

/**
 * CSS styles for AI decorations (inject into document)
 */
export const AI_DECORATION_CSS = `
/* AI Change Highlighting */
.ai-change-add {
  background: linear-gradient(90deg, rgba(76, 175, 80, 0.2) 0%, rgba(76, 175, 80, 0.1) 100%);
  border-left: 3px solid #4caf50;
}

.ai-change-delete {
  background: linear-gradient(90deg, rgba(244, 67, 54, 0.2) 0%, rgba(244, 67, 54, 0.1) 100%);
  border-left: 3px solid #f44336;
}

.ai-change-modify {
  background: linear-gradient(90deg, rgba(255, 193, 7, 0.2) 0%, rgba(255, 193, 7, 0.1) 100%);
  border-left: 3px solid #ffc107;
}

.ai-change-suggestion {
  background: linear-gradient(90deg, rgba(33, 150, 243, 0.2) 0%, rgba(33, 150, 243, 0.1) 100%);
  border-left: 3px solid #2196f3;
}

/* Glyph Margin Icons */
.ai-glyph-add {
  background: #4caf50;
  width: 4px !important;
  margin-left: 3px;
}

.ai-glyph-delete {
  background: #f44336;
  width: 4px !important;
  margin-left: 3px;
}

.ai-glyph-modify {
  background: #ffc107;
  width: 4px !important;
  margin-left: 3px;
}

/* Ghost Text (Inline Suggestions) */
.ai-ghost-text {
  color: rgba(200, 200, 200, 0.5);
  font-style: italic;
  background: rgba(100, 149, 237, 0.1);
}

.ai-suggestion-ghost {
  opacity: 0.6;
}

/* Annotations */
.ai-annotation-error {
  text-decoration: underline wavy #f44336;
  text-decoration-skip-ink: none;
}

.ai-annotation-warning {
  text-decoration: underline wavy #ffc107;
  text-decoration-skip-ink: none;
}

.ai-annotation-info {
  text-decoration: underline dotted #2196f3;
  text-decoration-skip-ink: none;
}

.ai-annotation-success {
  text-decoration: underline solid #4caf50;
  text-decoration-skip-ink: none;
}

/* Progress Indicators */
.ai-progress-line {
  background: rgba(33, 150, 243, 0.1);
  animation: pulse-bg 2s ease-in-out infinite;
}

.ai-progress-spinner {
  width: 16px;
  height: 16px;
  background: transparent;
  border: 2px solid #2196f3;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-left: 2px;
}

.ai-progress-complete {
  width: 16px;
  height: 16px;
  background: #4caf50;
  border-radius: 50%;
  margin-left: 2px;
  position: relative;
}

.ai-progress-complete::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 10px;
  font-weight: bold;
}

/* Animations */
@keyframes pulse-bg {
  0%, 100% {
    background-color: rgba(33, 150, 243, 0.1);
  }
  50% {
    background-color: rgba(33, 150, 243, 0.2);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Hover Tooltip Styling */
.monaco-hover .hover-contents {
  background: #2d2d2d;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 8px 12px;
}

.monaco-hover .hover-contents .markdown-hover {
  color: #e0e0e0;
}

.monaco-hover .hover-contents .markdown-hover strong {
  color: #6495ed;
}
`;

/**
 * Inject AI decoration styles into the document
 */
export function injectAIDecorationStyles(): void {
  if (typeof document === 'undefined') return;

  // Check if already injected
  if (document.getElementById('ai-decoration-styles')) return;

  const style = document.createElement('style');
  style.id = 'ai-decoration-styles';
  style.textContent = AI_DECORATION_CSS;
  document.head.appendChild(style);
}

// Auto-inject on import
if (typeof window !== 'undefined') {
  injectAIDecorationStyles();
}
