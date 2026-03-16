import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useState } from 'react';

import styles from './Panel.module.css';

export interface DiffPanelProps {
  originalContent: string;
  modifiedContent: string;
  filename: string;
  language?: string;
  isBinary?: boolean;
  isLarge?: boolean;
  onClose: () => void;
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'java':
      return 'java';
    default:
      return 'plaintext';
  }
}

export function DiffPanel({
  originalContent,
  modifiedContent,
  filename,
  language,
  isBinary = false,
  isLarge = false,
  onClose,
}: DiffPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [renderSideBySide, setRenderSideBySide] = useState(true);

  const handleMount: DiffOnMount = (editor, monaco) => {
    setMounted(true);
    // Focus the modified side
    const modifiedEditor = editor.getModifiedEditor();
    modifiedEditor.focus();
  };

  const detectedLanguage = language || detectLanguage(filename);

  // Handle binary files
  if (isBinary) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Diff — {filename}</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>
        <div className={styles.panelBody} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
            <div style={{ fontSize: 14 }}>Binary file cannot be displayed</div>
            <div style={{ fontSize: 11, marginTop: 8, color: '#666' }}>
              Images, archives, and other binary files cannot be diffed.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Handle large files
  if (isLarge) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Diff — {filename}</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>
        <div className={styles.panelBody} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
            <div style={{ fontSize: 14 }}>File too large to diff</div>
            <div style={{ fontSize: 11, marginTop: 8, color: '#666' }}>
              Files larger than 1MB are not displayed for performance reasons.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Diff — {filename}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Inline/Side-by-side toggle */}
          <button
            onClick={() => setRenderSideBySide(!renderSideBySide)}
            style={{
              background: '#333',
              border: 'none',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 10,
              color: renderSideBySide ? '#4ecdc4' : '#888',
              cursor: 'pointer',
            }}
          >
            {renderSideBySide ? 'Side by Side' : 'Inline'}
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>
      </div>
      <div className={styles.panelBody} style={{ padding: 0 }}>
        <DiffEditor
          height="100%"
          language={detectedLanguage}
          original={originalContent}
          modified={modifiedContent}
          onMount={handleMount}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            renderSideBySide,
            scrollBeyondLastLine: false,
            originalEditable: false,
            automaticLayout: true,
          }}
          theme="vs-dark"
        />
      </div>
    </div>
  );
}
