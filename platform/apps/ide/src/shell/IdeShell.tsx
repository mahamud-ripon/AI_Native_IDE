/**
 * IDE Shell
 *
 * Main layout component for the AI-Native IDE.
 * Orchestrates all panels, status bar, and AI integration.
 *
 * Architecture:
 *   IdeShell
 *   ├── Header (branding, actions)
 *   ├── Sidebar (File Explorer, AI Chat)
 *   ├── Main Area (Editor, Patch Preview)
 *   ├── Bottom Panel (Terminal, Preview)
 *   └── Status Bar (Execution Status)
 *
 * Integrations:
 * - ExecutionStream for real-time updates
 * - AIChatPanel for AI coding assistance
 * - PatchPreviewPanel for patch review
 * - ExecutionStatusBar for task status
 */

import { useEffect, useMemo, useState } from 'react';

import { useUiStore } from '../state/uiStore';
import { useTabsStore } from '../state/tabsStore';
import { useExecutionStreamIntegration } from '../hooks/useExecutionStreamIntegration';
import { FileExplorerPanel } from './panels/FileExplorerPanel';
import { EditorPanel } from './panels/EditorPanel';
import { TerminalPanel } from './panels/TerminalPanel';
import { PreviewPanel } from './panels/PreviewPanel';
import { AIChatPanel } from './panels/AIChatPanel';
import { PatchPreviewPanel } from './panels/PatchPreviewPanel';
import { CommandPalette } from './components/CommandPalette';
import { ExecutionStatusBar } from './components/ExecutionStatusBar';
import { editorModelManager } from '../core/editor/modelManager';
import { demoViteReactProjectFiles } from '../workspace/workspaceService';

import styles from './IdeShell.module.css';

// ========================================
// TYPES
// ========================================

interface IdeShellProps {
  projectId: string;
  filePath: string;
  workspaceId?: string;
  userId?: string;
}

// ========================================
// COMPONENT
// ========================================

export function IdeShell({
  projectId,
  filePath,
  workspaceId = 'default-workspace',
  userId = 'default-user',
}: IdeShellProps) {
  const openTab = useTabsStore((s: { openTab: (projectId: string, filePath: string) => void }) => s.openTab);
  const {
    isSidebarOpen,
    isBottomPanelOpen,
    bottomPanelTab,
    isCommandPaletteOpen,
    toggleSidebar,
    toggleBottomPanel,
    setBottomPanelTab,
    setCommandPaletteOpen,
  } = useUiStore();

  // Sidebar tab state
  const [sidebarTab, setSidebarTab] = useState<'files' | 'ai'>('ai');

  // Execution stream integration
  const { status: connectionStatus } = useExecutionStreamIntegration({
    projectId,
    workspaceId,
    userId,
    autoConnect: true,
    autoSubscribeWorkspace: true,
    mockMode: import.meta.env.VITE_MOCK_MODE === 'true', // Use env to toggle mock mode
  });

  const headerSubtitle = useMemo(() => {
    if (!projectId) return 'No project';
    return filePath ? `${projectId} • ${filePath}` : projectId;
  }, [projectId, filePath]);

  // Open file tab
  useEffect(() => {
    if (!projectId || !filePath) return;
    openTab(projectId, filePath);
  }, [openTab, projectId, filePath]);

  // Initialize demo files in Monaco Editor on first load
  useEffect(() => {
    // Only initialize once per session
    const initialized = sessionStorage.getItem('demo_files_initialized');
    if (initialized) return;

    // Load demo files into Monaco Editor models
    (async () => {
      const Monaco = await import('monaco-editor');
      const files = demoViteReactProjectFiles();
      Object.entries(files).forEach(([path, content]) => {
        try {
          const fileModel = editorModelManager.getOrCreate(Monaco, '', path);
          if (fileModel?.model) {
            fileModel.model.setValue(content);
          }
        } catch (e) {
          console.debug('Failed to initialize demo file:', path, e);
        }
      });

      // Mark as initialized
      sessionStorage.setItem('demo_files_initialized', 'true');
      console.log('[IdeShell] Demo files initialized in Monaco Editor');
    })();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command palette: Ctrl/Cmd + Shift + P
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }

      // Toggle AI panel: Ctrl/Cmd + Shift + A
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        if (isSidebarOpen && sidebarTab === 'ai') {
          toggleSidebar();
        } else {
          if (!isSidebarOpen) toggleSidebar();
          setSidebarTab('ai');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen, toggleSidebar, isSidebarOpen, sidebarTab]);

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>AI-Native IDE</div>
        <div className={styles.subtitle}>{headerSubtitle}</div>
        <div className={styles.headerActions}>
          <button
            className={`${styles.button} ${sidebarTab === 'ai' ? styles.buttonActive : ''}`}
            onClick={() => {
              if (isSidebarOpen && sidebarTab === 'ai') {
                toggleSidebar();
              } else {
                if (!isSidebarOpen) toggleSidebar();
                setSidebarTab('ai');
              }
            }}
          >
            🤖 AI
          </button>
          <button
            className={`${styles.button} ${sidebarTab === 'files' ? styles.buttonActive : ''}`}
            onClick={() => {
              if (isSidebarOpen && sidebarTab === 'files') {
                toggleSidebar();
              } else {
                if (!isSidebarOpen) toggleSidebar();
                setSidebarTab('files');
              }
            }}
          >
            📁 Files
          </button>
          <button className={styles.button} onClick={toggleBottomPanel}>
            {isBottomPanelOpen ? '▼ Panel' : '▶ Panel'}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className={styles.body}>
        {/* Sidebar */}
        {isSidebarOpen ? (
          <aside className={styles.sidebar}>
            <div className={styles.sidebarTabs}>
              <button
                className={sidebarTab === 'ai' ? styles.sidebarTabActive : styles.sidebarTab}
                onClick={() => setSidebarTab('ai')}
                title="AI Assistant"
              >
                🤖
              </button>
              <button
                className={sidebarTab === 'files' ? styles.sidebarTabActive : styles.sidebarTab}
                onClick={() => setSidebarTab('files')}
                title="File Explorer"
              >
                📁
              </button>
            </div>

            <div className={styles.sidebarContent}>
              {sidebarTab === 'ai' ? (
                <AIChatPanel projectId={projectId} workspaceId={workspaceId} />
              ) : (
                <FileExplorerPanel />
              )}
            </div>
          </aside>
        ) : null}

        {/* Main Area */}
        <main className={styles.main}>
          {/* Editor Area */}
          <section className={styles.editorArea}>
            <EditorPanel projectId={projectId} filePath={filePath} />
          </section>

          {/* Bottom Panel */}
          {isBottomPanelOpen ? (
            <section className={styles.bottomPanel}>
              <div className={styles.bottomTabs}>
                <button
                  className={bottomPanelTab === 'terminal' ? styles.tabActive : styles.tab}
                  onClick={() => setBottomPanelTab('terminal')}
                >
                  Terminal
                </button>
                <button
                  className={bottomPanelTab === 'preview' ? styles.tabActive : styles.tab}
                  onClick={() => setBottomPanelTab('preview')}
                >
                  Preview
                </button>
              </div>

              <div className={styles.bottomContent}>
                {bottomPanelTab === 'terminal' ? (
                  <TerminalPanel />
                ) : (
                  <PreviewPanel />
                )}
              </div>
            </section>
          ) : null}
        </main>
      </div>

      {/* Status Bar */}
      <ExecutionStatusBar />

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  );
}

export default IdeShell;
