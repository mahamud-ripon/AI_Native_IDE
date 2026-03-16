/**
 * Editor Panel
 *
 * Main Monaco editor panel for the IDE.
 * All Monaco access is routed through EditorManager - no direct Monaco calls.
 *
 * Architecture:
 *   EditorPanel
 *       │
 *   EditorManager (centralized control)
 *       │
 *   Monaco API
 *
 * Features:
 * - Editor registration with EditorManager
 * - File model management via EditorManager
 * - Yjs collaboration binding
 * - FS sync for model changes
 */

import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useMemo, useRef } from 'react';

import { editorManager } from '../../core/editor/editorManager';
import { setupModelSync } from '../../core/editor/fsSyncService';
import { bindMonacoToYjs, setCollabUser, unbindMonacoFromYjs } from '../../core/collab/monacoBinding';
import styles from './Panel.module.css';

// ========================================
// TYPES
// ========================================

interface EditorPanelProps {
  projectId: string;
  filePath: string;
}

// ========================================
// COMPONENT
// ========================================

export function EditorPanel({ projectId, filePath }: EditorPanelProps) {
  // Refs for cleanup and collaboration (not for direct Monaco access)
  const editorIdRef = useRef<string>(`editor-${Date.now()}`);
  const syncDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const collabBindingRef = useRef<Monaco.IDisposable | null>(null);
  const currentFileRef = useRef<{ projectId: string; filePath: string } | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);

  // Generate unique editor ID
  const editorId = useMemo(() => `editor-${projectId}-${Date.now()}`, [projectId]);

  // Handle Monaco mount - register with EditorManager
  const handleMount: OnMount = (editor, monaco) => {
    const monacoLib = monaco as unknown as typeof Monaco;

    // Register editor with EditorManager (centralized control)
    const unregister = editorManager.registerEditor(
      editorId,
      editor,
      monacoLib,
      projectId,
      filePath
    );

    // Store unregister function for cleanup
    unregisterRef.current = unregister;
    editorIdRef.current = editorId;

    // Open file through EditorManager
    editorManager.openFile(editorId, projectId, filePath);
    currentFileRef.current = { projectId, filePath };

    // Setup FS sync for model changes
    const model = editor.getModel();
    if (model) {
      syncDisposableRef.current?.dispose();
      syncDisposableRef.current = setupModelSync(model, projectId, filePath);
    }

    // Setup Yjs collaboration binding
    collabBindingRef.current?.dispose();
    try {
      const binding = bindMonacoToYjs(monacoLib, editor, projectId, filePath);
      collabBindingRef.current = binding.disposable;

      // Set local user for awareness
      const userId = `user-${Math.random().toString(36).slice(2, 8)}`;
      const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      setCollabUser({ id: userId, name: `User ${userId.slice(0, 4)}`, color });
    } catch (err) {
      console.warn('[EditorPanel] Failed to bind Yjs:', err);
    }

    // Focus editor
    editor.focus();
  };

  // Handle file path changes
  useEffect(() => {
    const current = currentFileRef.current;

    // Skip if same file or editor not yet initialized
    if (!current) return;
    if (current.projectId === projectId && current.filePath === filePath) return;

    // Cleanup previous file bindings
    if (current.filePath !== filePath) {
      unbindMonacoFromYjs(current.projectId, current.filePath);
    }

    // Open new file through EditorManager
    const instance = editorManager.getEditor(editorId);
    if (instance) {
      editorManager.openFile(editorId, projectId, filePath);
      currentFileRef.current = { projectId, filePath };

      // Setup FS sync for new model
      const model = instance.editor.getModel();
      if (model) {
        syncDisposableRef.current?.dispose();
        syncDisposableRef.current = setupModelSync(model, projectId, filePath);
      }

      // Setup Yjs collaboration for new file
      collabBindingRef.current?.dispose();
      try {
        const binding = bindMonacoToYjs(instance.monaco, instance.editor, projectId, filePath);
        collabBindingRef.current = binding.disposable;
      } catch (err) {
        console.warn('[EditorPanel] Failed to bind Yjs:', err);
      }
    }
  }, [projectId, filePath, editorId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      syncDisposableRef.current?.dispose();
      collabBindingRef.current?.dispose();
      
      if (currentFileRef.current) {
        unbindMonacoFromYjs(currentFileRef.current.projectId, currentFileRef.current.filePath);
      }
      
      // Unregister from EditorManager
      unregisterRef.current?.();
    };
  }, []);

  // Header label
  const headerLabel = useMemo(() => {
    if (!filePath) return 'Editor';
    return `Editor — ${filePath}`;
  }, [filePath]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>{headerLabel}</div>
      <div className={styles.panelBody} style={{ padding: 0 }}>
        <Editor
          height="100%"
          defaultLanguage="plaintext"
          onMount={handleMount}
          onChange={() => {
            // FS sync is handled by setupModelSync
            // EditorManager handles all other operations
          }}
          options={{
            minimap: { enabled: true },
            fontSize: 14,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            // AI-friendly options
            suggest: {
              showMethods: true,
              showFunctions: true,
              showConstructors: true,
              showFields: true,
              showVariables: true,
              showClasses: true,
              showStructs: true,
              showInterfaces: true,
              showModules: true,
              showProperties: true,
              showEvents: true,
              showOperators: true,
              showUnits: true,
              showValues: true,
              showConstants: true,
              showEnums: true,
              showEnumMembers: true,
              showKeywords: true,
              showWords: true,
              showColors: true,
              showFiles: true,
              showReferences: true,
              showFolders: true,
              showTypeParameters: true,
              showSnippets: true,
            },
            // Enable inline suggestions for AI ghost text
            inlineSuggest: { enabled: true },
            // Quick suggestions
            quickSuggestions: {
              other: true,
              comments: false,
              strings: true,
            },
          }}
          theme="vs-dark"
          defaultValue=""
        />
      </div>
    </div>
  );
}

export default EditorPanel;
