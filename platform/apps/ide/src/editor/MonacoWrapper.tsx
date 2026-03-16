/**
 * Monaco Editor Wrapper with Yjs CRDT Integration
 * 
 * Binds Monaco Editor to Yjs for real-time collaboration.
 * Uses y-monaco binding for automatic text synchronization.
 * 
 * Features:
 * - Real-time collaborative editing via Yjs CRDT
 * - Live cursor awareness (see other users' cursors)
 * - Automatic conflict resolution
 * - LSP integration ready
 * 
 * Architecture:
 * - Y.Text from Yjs doc binds to Monaco model
 * - MonacoBinding handles all sync automatically
 * - Awareness protocol shows remote cursors
 */

'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as monacoType from 'monaco-editor';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';

import { useYjsStore } from '../state/yjsStore';

interface MonacoWrapperProps {
  projectId: string;
  fileId: string;
  filePath: string;
  language: string;
  initialValue?: string;
  readOnly?: boolean;
  onContentChange?: (value: string) => void;
  wsUrl: string;
}

interface RemoteCursor {
  id: string;
  user: { name: string; color: string };
  position: { line: number; column: number };
}

interface UserState {
  name: string;
  color: string;
  id: string;
  cursor?: { line: number; column: number };
}

export function MonacoWrapper({
  projectId,
  fileId,
  filePath,
  language,
  initialValue = '',
  readOnly = false,
  onContentChange,
  wsUrl,
}: MonacoWrapperProps) {
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monacoType | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  
  // Get Yjs setup from store
  const getOrCreateDoc = useYjsStore((s: any) => s.getOrCreateDoc(projectId, fileId, wsUrl));
  const switchFile = useYjsStore((s: any) => s.switchFile);
  const setLocalUser = useYjsStore((s: any) => s.setLocalUser);
  const updateLocalCursor = useYjsStore((s: any) => s.updateLocalCursor);
  const destroyDoc = useYjsStore((s: any) => s.destroyDoc);

  // Setup local user awareness
  useEffect(() => {
    const userId = `user-${Math.random().toString(36).substring(2, 9)}`;
    const colors = [
      '#f783ac', '#818cf8', '#34d399', '#fbbf24', '#f87171', '#60a5fa'
    ];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    setLocalUser({
      id: userId,
      name: `User ${userId.substring(5, 8)}`,
      color,
    });
    
    return () => {
      destroyDoc(`${projectId}:${fileId}`);
    };
  }, [destroyDoc, setLocalUser, projectId, fileId]);

  // Listen for remote awareness changes (cursors)
  useEffect(() => {
    const { awareness } = getOrCreateDoc;
    if (!awareness) return;
    
    const updateRemoteCursors = () => {
      const states = awareness.getStates();
      const cursors: RemoteCursor[] = [];
      
      states.forEach((state: any, clientId: any) => {
        if (clientId !== awareness.clientID && state.user && state.user.cursor) {
          cursors.push({
            id: clientId.toString(),
            user: state.user as { name: string; color: string },
            position: state.user.cursor as { line: number; column: number },
          });
        }
      });
      
      setRemoteCursors(cursors);
    };
    
    awareness.on('change', updateRemoteCursors);
    updateRemoteCursors();
    
    return () => {
      awareness.off('change', updateRemoteCursors);
    };
  }, [getOrCreateDoc]);

  // Handle editor mount
  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // Get Y.Text from doc
    const { doc } = getOrCreateDoc;
    const yText = doc.getText('monaco');
    yTextRef.current = yText;
    
    // Set initial value if Y.Text is empty
    if (yText.length === 0 && initialValue) {
      yText.insert(0, initialValue);
    }
    
    // Create Monaco binding
    const { awareness } = getOrCreateDoc;
    const binding = new MonacoBinding(
      yText,
      editor.getModel()!,
      new Set([editor]),
      awareness
    );
    
    bindingRef.current = binding;
    
    // Setup cursor position tracking
    editor.onDidChangeCursorPosition((e) => {
      updateLocalCursor(e.position.lineNumber, e.position.column);
    });
    
    // Setup content change listener
    if (onContentChange) {
      editor.onDidChangeModelContent(() => {
        const value = editor.getValue();
        onContentChange(value);
      });
    }
    
    // Setup LSP-ready decorations for remote cursors
    setupRemoteCursorDecorations(monaco, editor);
  }, [getOrCreateDoc, initialValue, onContentChange, updateLocalCursor]);

  // Setup remote cursor decorations
  const setupRemoteCursorDecorations = (
    monaco: typeof monacoType,
    editor: monacoType.editor.IStandaloneCodeEditor
  ) => {
    let decorationIds: string[] = [];
    
    const updateDecorations = () => {
      const newDecorations: monacoType.editor.IModelDeltaDecoration[] = [];
      
      remoteCursors.forEach((cursor) => {
        const range = new monaco.Range(
          cursor.position.line,
          cursor.position.column,
          cursor.position.line,
          cursor.position.column + 1
        );
        
        newDecorations.push({
          range,
          options: {
            isWholeLine: false,
            className: 'remote-cursor',
            inlineClassName: 'remote-cursor-inline',
            hoverMessage: { value: cursor.user.name },
            overviewRuler: {
              color: cursor.user.color,
              position: monaco.editor.OverviewRulerLane.Center,
            },
          },
        });
      });
      
      // Update decorations
      decorationIds = editor.deltaDecorations(decorationIds, newDecorations);
    };
    
    // Update when remote cursors change
    const unsubscribe = useYjsStore.subscribe((state: any) => {
      updateDecorations();
    });
    
    return () => {
      unsubscribe();
      editor.deltaDecorations(decorationIds, []);
    };
  };

  // Switch to this file when mounted
  useEffect(() => {
    const fileKey = `${projectId}:${fileId}`;
    switchFile(fileKey);
  }, [projectId, fileId, switchFile]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (bindingRef.current) {
        bindingRef.current.destroy();
      }
    };
  }, []);

  // Determine file language for Monaco
  const getMonacoLanguage = (filePath: string, language: string): string => {
    // Map file extensions to Monaco languages
    const ext = filePath.split('.').pop()?.toLowerCase();
    
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      go: 'go',
      rs: 'rust',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      sql: 'sql',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      toml: 'toml',
      dockerfile: 'dockerfile',
    };
    
    return languageMap[ext || ''] || languageMap[language] || 'plaintext';
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Remote cursor styles */}
      <style>{`
        .remote-cursor {
          border-left: 2px solid;
          animation: cursor-blink 1s infinite;
        }
        
        .remote-cursor-inline {
          background-color: rgba(0, 0, 0, 0.1);
        }
        
        @keyframes cursor-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }
      `}</style>
      
      <Editor
        height="100%"
        language={getMonacoLanguage(filePath, language)}
        theme="vs-dark"
        value={undefined} // Yjs controls content
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: true },
          fontSize: 14,
          fontFamily: 'JetBrains Mono, Fira Code, monospace',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          formatOnPaste: true,
          formatOnType: true,
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          folding: true,
          lineNumbers: 'on',
          wordWrap: 'on',
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          contextmenu: true,
          rulers: [],
        }}
      />
      
      {/* Remote cursors indicator */}
      {remoteCursors.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            background: 'rgba(0, 0, 0, 0.6)',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            color: '#9ca3af',
          }}
        >
          <span>👥</span>
          <span>{remoteCursors.length} collaborator{remoteCursors.length > 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}
