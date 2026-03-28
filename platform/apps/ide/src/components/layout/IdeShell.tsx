/**
 * IDE Shell - Production-Ready Implementation
 *
 * Fully wired IDE with:
 * - Real AI chat via Groq streaming API (aiChatStore)
 * - Monaco Editor with real file content
 * - File explorer connected to filesystem API + WebSocket events
 * - Terminal with WebSocket PTY
 * - Live preview panel
 * - AI code apply with diff viewer
 * - Session persistence
 * - Error boundaries
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Rocket,
  Code,
  Github,
  Play,
  MoreHorizontal,
  Lock,
  GitBranch,
  AlertCircle,
  Loader2,
  Check,
  XCircle,
  FileCode,
  Eye,
  Settings,
  X,
  ChevronRight,
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { cn } from '@/lib/utils';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { CommandPalette } from '@/components/command-palette';
import { useIDEStore, ideEventBus, detectLanguage, type FileNode, type PendingDiff } from '@/stores/ideStore';
import { useAIChatStore } from '@/state/aiChatStore';
import { logger } from '@/lib/logger';
import { fileSystemClient } from '@/api/fileSystemClient';
import { smartFileSystemClient } from '@/api/smartFileSystemClient';
import { useExecutionStreamIntegration } from '@/hooks/useExecutionStreamIntegration';
import { aiCodingController } from '@/core/ai/aiCodingController';

// Extracted components
import { ChatPanel } from './ChatPanel';
import { FileExplorerPanel } from './FileExplorerPanel';
import { TerminalPanel, AnsiText } from './TerminalPanel';
import { PreviewPanel } from './PreviewPanel';
import { SettingsPanel } from './SettingsPanel';

// ============================================================================
// DESIGN TOKENS
// ============================================================================
const colors = {
  bgMain: '#0e0e11',
  bgPanel: '#18181b',
  bgPanelHover: '#27272a',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderColorHover: 'rgba(255, 255, 255, 0.15)',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  accentColor: '#3b82f6',
  accentHover: '#2563eb',
  successColor: '#10b981',
  errorColor: '#ef4444',
  warningColor: '#f59e0b',
};

// ============================================================================
// TYPES
// ============================================================================
type ViewMode = 'coding' | 'preview' | 'settings';

interface IdeShellProps {
  projectId: string;
  filePath?: string;
  projectName?: string;
  workspaceId?: string;
  userId?: string;
}

// ============================================================================
// FILE ICON COLORS
// ============================================================================
function getFileIconColor(name: string): string {
  if (name.endsWith('.tsx') || name.endsWith('.ts')) return '#3b82f6';
  if (name.endsWith('.css') || name.endsWith('.scss')) return '#0ea5e9';
  if (name.endsWith('.html')) return '#e34f26';
  if (name.endsWith('.json')) return '#facc15';
  if (name.endsWith('.js') || name.endsWith('.mjs')) return '#facc15';
  if (name.endsWith('.py')) return '#3b82f6';
  if (name.endsWith('.md')) return '#a1a1aa';
  if (name.startsWith('.')) return '#888';
  return '#a1a1aa';
}

// ============================================================================
// HEADER COMPONENT
// ============================================================================
interface HeaderProps {
  projectName: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isConnected: boolean;
  currentBranch: string;
}

function IdeHeader({ projectName, viewMode, onViewModeChange, isConnected, currentBranch }: HeaderProps) {
  return (
    <header
      className="flex items-center justify-between px-4 flex-shrink-0"
      style={{
        height: '52px',
        backgroundColor: colors.bgMain,
        borderBottom: `1px solid ${colors.borderColor}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        zIndex: 30,
      }}
    >
      {/* Left: Logo + Breadcrumbs */}
      <div className="flex items-center gap-3">
        <div style={{ fontSize: '20px', color: colors.textPrimary }}>
          <Zap className="h-5 w-5" style={{ color: colors.accentColor }} />
        </div>
        <div className="flex items-center gap-2" style={{ fontSize: '13px', color: colors.textSecondary }}>
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: '#10b981', fontSize: '10px' }}
          >
            R
          </div>
          <span style={{ color: colors.textSecondary }}>/</span>
          <span style={{ color: colors.textPrimary, fontWeight: 500 }}>{projectName}</span>
          <Lock className="h-3 w-3" style={{ color: colors.textMuted }} />
        </div>

        {/* Git branch indicator */}
        <div
          className="flex items-center gap-1 px-2 py-0.5 rounded"
          style={{
            backgroundColor: colors.bgPanel,
            border: `1px solid ${colors.borderColor}`,
            fontSize: '11px',
            color: colors.textSecondary,
          }}
        >
          <GitBranch className="h-3 w-3" />
          <span>{currentBranch}</span>
        </div>

        {/* Connection status */}
        <div
          className="flex items-center gap-1"
          style={{ fontSize: '11px', color: isConnected ? colors.successColor : colors.textMuted }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: isConnected ? colors.successColor : colors.textMuted }}
          />
          <span>{isConnected ? 'Connected' : 'Offline'}</span>
        </div>
      </div>

      {/* Center: View Mode Toggles */}
      <div className="flex items-center">
        <div
          className="flex items-center gap-0.5 p-0.5 rounded-md"
          style={{
            backgroundColor: colors.bgPanel,
            border: `1px solid ${colors.borderColor}`,
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)',
          }}
        >
          {[
            { mode: 'preview' as ViewMode, icon: <Eye className="h-4 w-4" />, title: 'Preview Mode' },
            { mode: 'coding' as ViewMode, icon: <Code className="h-4 w-4" />, title: 'Coding Mode' },
            { mode: 'settings' as ViewMode, icon: <Settings className="h-4 w-4" />, title: 'Settings Mode' },
          ].map(({ mode, icon, title }) => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              title={title}
              className="flex items-center justify-center rounded transition-all duration-150"
              style={{
                width: '32px',
                height: '28px',
                backgroundColor: viewMode === mode ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: viewMode === mode ? colors.accentColor : colors.textSecondary,
                boxShadow: viewMode === mode ? 'inset 0 0 0 1px rgba(59, 130, 246, 0.3)' : 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          className="flex items-center justify-center rounded-md transition-all duration-150"
          style={{
            width: '32px',
            height: '32px',
            backgroundColor: 'transparent',
            color: colors.textSecondary,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <Github className="h-4 w-4" />
        </button>
        <button
          style={{
            padding: '6px 14px',
            backgroundColor: colors.bgPanel,
            color: colors.textPrimary,
            border: `1px solid ${colors.borderColor}`,
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Share
        </button>
        <button
          style={{
            padding: '6px 14px',
            backgroundColor: colors.textPrimary,
            color: colors.bgMain,
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Publish
        </button>
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold ml-1"
          style={{ backgroundColor: '#8b5cf6', fontSize: '12px' }}
        >
          R
        </div>
      </div>
    </header>
  );
}

// ============================================================================
// DIFF VIEWER - For AI code apply
// ============================================================================
interface DiffViewerProps {
  diff: PendingDiff;
  onAccept: () => void;
  onReject: () => void;
}

function DiffViewer({ diff, onAccept, onReject }: DiffViewerProps) {
  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={{
        backgroundColor: colors.bgMain,
        zIndex: 50,
      }}
    >
      {/* Diff Header */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{
          backgroundColor: colors.bgPanel,
          borderBottom: `1px solid ${colors.borderColor}`,
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '13px', color: colors.textPrimary, fontWeight: 500 }}>
            AI Suggested Changes
          </span>
          <span style={{ fontSize: '11px', color: colors.textMuted }}>{diff.path}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: colors.errorColor,
              border: `1px solid rgba(239, 68, 68, 0.3)`,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </button>
          <button
            onClick={onAccept}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all"
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              color: colors.successColor,
              border: `1px solid rgba(16, 185, 129, 0.3)`,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            <Check className="h-3.5 w-3.5" />
            Accept
          </button>
        </div>
      </div>

      {/* Diff Content */}
      <div className="flex-1 overflow-auto" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '13px' }}>
        {diff.diff.hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            <div
              style={{
                padding: '4px 16px',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: colors.accentColor,
                fontSize: '11px',
              }}
            >
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </div>
            {hunk.lines.map((line, lineIdx) => (
              <div
                key={lineIdx}
                style={{
                  padding: '1px 16px',
                  backgroundColor:
                    line.type === 'add'
                      ? 'rgba(16, 185, 129, 0.1)'
                      : line.type === 'remove'
                        ? 'rgba(239, 68, 68, 0.1)'
                        : 'transparent',
                  color:
                    line.type === 'add'
                      ? '#4ade80'
                      : line.type === 'remove'
                        ? '#f87171'
                        : colors.textSecondary,
                  lineHeight: '1.6',
                }}
              >
                <span style={{ userSelect: 'none', marginRight: '8px', opacity: 0.5 }}>
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                </span>
                {line.content}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// CODE EDITOR PANEL - Monaco Editor with real file content
// ============================================================================
interface CodeEditorPanelProps {
  projectId: string;
}

function CodeEditorPanel({ projectId }: CodeEditorPanelProps) {
  const {
    openTabs,
    activeTabPath,
    fileContents,
    pendingDiffs,
    setActiveTab,
    closeTab,
    setFileContent,
    markTabDirty,
    acceptDiff,
    rejectDiff,
  } = useIDEStore();

  const editorRef = React.useRef<any>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const activeTab = openTabs.find(t => t.path === activeTabPath);
  const activeContent = activeTabPath ? fileContents.get(activeTabPath) : undefined;
  const activeDiff = activeTabPath ? pendingDiffs.get(activeTabPath) : undefined;

  // Listen for AI code apply events
  React.useEffect(() => {
    const handleApplyCode = ({ path, code }: { path: string; code: string }) => {
      if (path && activeTabPath) {
        const currentContent = fileContents.get(activeTabPath) || '';
        // Create a simple diff
        const diff = {
          path: activeTabPath,
          diff: {
            original: currentContent,
            modified: code,
            hunks: [{
              oldStart: 1,
              oldLines: currentContent.split('\n').length,
              newStart: 1,
              newLines: code.split('\n').length,
              lines: [
                ...currentContent.split('\n').map(l => ({ type: 'remove' as const, content: l })),
                ...code.split('\n').map(l => ({ type: 'add' as const, content: l })),
              ],
            }],
          },
          newContent: code,
          messageId: Date.now().toString(),
        };
        useIDEStore.getState().addPendingDiff(diff);
      }
    };

    ideEventBus.on('ai:applyCode', handleApplyCode);
    return () => ideEventBus.off('ai:applyCode', handleApplyCode);
  }, [activeTabPath, fileContents]);

  // Auto-save on content change - uses smart client for browser/cloud switching
  const handleEditorChange = React.useCallback(
    async (value: string | undefined) => {
      if (!activeTabPath || value === undefined) return;

      setFileContent(activeTabPath, value);
      markTabDirty(activeTabPath, true);

      // Debounced save - uses smart client to auto-detect browser/cloud
      clearTimeout((window as any).__saveTimeout);
      (window as any).__saveTimeout = setTimeout(async () => {
        setIsSaving(true);
        await smartFileSystemClient.writeFile(
          projectId, 
          activeTabPath, 
          value,
          smartFileSystemClient.getProjectType()
        );
        markTabDirty(activeTabPath, false);
        setIsSaving(false);
        ideEventBus.emit('file:saved', { path: activeTabPath, content: value });
      }, 1000);
    },
    [activeTabPath, projectId]
  );

  return (
    <div
      className="flex flex-col h-full relative"
      style={{
        flex: 1,
        backgroundColor: colors.bgMain,
        overflow: 'hidden',
        boxShadow: '1px 0 4px rgba(0,0,0,0.1)',
        zIndex: 10,
      }}
    >
      {/* Editor Header with Tabs */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: '44px',
          backgroundColor: colors.bgMain,
          borderBottom: `1px solid ${colors.borderColor}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          zIndex: 10,
        }}
      >
        <div className="flex items-end h-full pt-1.5 pl-2 gap-0.5 overflow-x-auto">
          {openTabs.map((tab) => {
            const isActive = tab.path === activeTabPath;
            const iconColor = getFileIconColor(tab.name);
            return (
              <div
                key={tab.path}
                onClick={() => setActiveTab(tab.path)}
                className="flex items-center gap-2 cursor-pointer transition-all duration-150 relative flex-shrink-0"
                style={{
                  padding: '0 14px',
                  height: '100%',
                  fontSize: '13px',
                  color: isActive ? colors.textPrimary : colors.textSecondary,
                  backgroundColor: isActive ? colors.bgPanel : 'transparent',
                  borderTopLeftRadius: '8px',
                  borderTopRightRadius: '8px',
                  border: isActive ? `1px solid ${colors.borderColor}` : '1px solid transparent',
                  borderBottom: 'none',
                  userSelect: 'none',
                  minWidth: '100px',
                  maxWidth: '160px',
                }}
              >
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-1px',
                      left: '-1px',
                      right: '-1px',
                      height: '2px',
                      backgroundColor: colors.accentColor,
                      borderTopLeftRadius: '8px',
                      borderTopRightRadius: '8px',
                    }}
                  />
                )}
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-1px',
                      left: 0,
                      right: 0,
                      height: '1px',
                      backgroundColor: colors.bgPanel,
                      zIndex: 3,
                    }}
                  />
                )}
                <FileCode className="h-3.5 w-3.5 flex-shrink-0" style={{ color: iconColor }} />
                <span className="truncate">{tab.name}</span>
                {tab.isDirty && (
                  <span style={{ color: colors.accentColor, fontSize: '16px', lineHeight: 1 }}>•</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
                  className="flex items-center justify-center rounded transition-all duration-150 flex-shrink-0"
                  style={{
                    width: '16px',
                    height: '16px',
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: colors.textMuted,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1 pr-3 flex-shrink-0">
          {isSaving && (
            <span style={{ fontSize: '11px', color: colors.textMuted }}>Saving...</span>
          )}
          <button
            className="flex items-center justify-center rounded-md"
            style={{
              width: '28px',
              height: '28px',
              backgroundColor: 'transparent',
              color: colors.textSecondary,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Play className="h-4 w-4" />
          </button>
          <button
            className="flex items-center justify-center rounded-md"
            style={{
              width: '28px',
              height: '28px',
              backgroundColor: 'transparent',
              color: colors.textSecondary,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      {activeTab && (
        <div
          className="flex items-center gap-1.5 flex-shrink-0"
          style={{
            height: '32px',
            padding: '0 16px',
            borderBottom: `1px solid ${colors.borderColor}`,
            backgroundColor: colors.bgPanel,
            fontSize: '12px',
            color: colors.textSecondary,
          }}
        >
          {activeTab.path.split('/').map((segment, idx, arr) => (
            <React.Fragment key={idx}>
              {idx > 0 && <ChevronRight className="h-3 w-3" style={{ color: colors.textMuted }} />}
              <span style={{ color: idx === arr.length - 1 ? colors.textPrimary : colors.textSecondary }}>
                {segment}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Monaco Editor */}
      {activeTab && activeContent !== undefined ? (
        <div className="flex-1 relative">
          <Editor
            height="100%"
            language={activeTab.language}
            value={activeContent}
            onChange={handleEditorChange}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
            theme="vs-dark"
            options={{
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontLigatures: true,
              lineHeight: 1.6,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              formatOnPaste: true,
              formatOnType: true,
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
              parameterHints: { enabled: true },
              renderLineHighlight: 'line',
              cursorBlinking: 'smooth',
              smoothScrolling: true,
              padding: { top: 16, bottom: 16 },
            }}
          />

          {/* Diff Overlay */}
          {activeDiff && (
            <DiffViewer
              diff={activeDiff}
              onAccept={() => acceptDiff(activeTabPath!)}
              onReject={() => rejectDiff(activeTabPath!)}
            />
          )}
        </div>
      ) : (
        <div
          className="flex-1 flex items-center justify-center"
          style={{ color: colors.textMuted, fontSize: '14px' }}
        >
          {openTabs.length === 0 ? (
            <div className="text-center">
              <FileCode className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Open a file to start editing</p>
            </div>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin" />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ERROR BOUNDARY
// ============================================================================
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div
          className="flex flex-col items-center justify-center h-full"
          style={{ color: colors.errorColor, padding: '24px', textAlign: 'center' }}
        >
          <AlertCircle className="h-8 w-8 mb-3" />
          <p style={{ fontSize: '14px', fontWeight: 500 }}>Something went wrong</p>
          <p style={{ fontSize: '12px', color: colors.textMuted, marginTop: '8px' }}>
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              backgroundColor: colors.bgPanel,
              color: colors.textPrimary,
              border: `1px solid ${colors.borderColor}`,
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// MAIN IDE SHELL
// ============================================================================

export function IdeShell({
  projectId,
  filePath,
  projectName = 'Todo Application',
  workspaceId = 'default',
  userId = 'default-user',
}: IdeShellProps) {
  logger.debug('[IdeShell] Initializing with props:', { projectId, filePath: filePath ? '...' : undefined, projectName, workspaceId });
  const {
    viewMode,
    setViewMode,
    bottomPanelTab,
    setBottomPanelTab,
    isWorkspaceConnected,
    currentBranch,
    setProject,
    openTab,
    setFileContent,
  } = useIDEStore();

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = React.useState(false);

  // Get activeConversationId from the chat store so we can ensure the
  // AI controller session is wired to the same conversation the ChatPanel uses.
  const activeConversationId = useAIChatStore((s) => s.activeConversationId);

  // bolt.new approach: All projects are cloud projects with UUID
  // WebContainer is execution environment, not storage
  const projectType: 'browser' | 'cloud' = React.useMemo(() => {
    return 'cloud'; // All projects are cloud projects
  }, []);

  // Initialize project
  React.useEffect(() => {
    setProject(projectId, projectName, workspaceId, projectType);
  }, [projectId, projectName, workspaceId, projectType]);

  // Initialize execution stream integration
  useExecutionStreamIntegration({
    projectId,
    workspaceId,
    userId: userId || 'default-user',
    autoConnect: true,
    autoSubscribeWorkspace: true,
    mockMode: false,
  });

  // Ensure AI controller session is ready
  React.useEffect(() => {
    if (projectId && workspaceId) {
      const activeSession = aiCodingController.getActiveSession();
      if (!activeSession || activeSession.projectId !== projectId) {
        // Pass existing conversation ID so we don't create a duplicate
        aiCodingController.createSession(projectId, workspaceId, activeConversationId || undefined);
      }
    }
  }, [projectId, workspaceId, activeConversationId]);

  // Open initial file - uses smart client to auto-detect browser/cloud
  React.useEffect(() => {
    if (filePath) {
      smartFileSystemClient.readFile(projectId, filePath, projectType).then(content => {
        setFileContent(filePath, content.content);
        openTab(filePath, content.content);
      }).catch(() => {
        // File doesn't exist yet (new/empty project) — that's fine, ignore
      });
    }
  }, [filePath, projectId, projectType]);

  // Keyboard shortcuts
  const { registerShortcut } = useKeyboardShortcuts();

  React.useEffect(() => {
    const shortcuts = [
      {
        id: 'command-palette',
        key: 'Ctrl+Shift+P',
        action: () => setIsCommandPaletteOpen(true),
        description: 'Open command palette',
        category: 'General',
      },
      {
        id: 'save-file',
        key: 'Ctrl+S',
        action: () => {
          const { activeTabPath, fileContents, projectType } = useIDEStore.getState();
          if (activeTabPath) {
            const content = fileContents.get(activeTabPath) || '';
            smartFileSystemClient.writeFile(projectId, activeTabPath, content, projectType);
          }
        },
        description: 'Save file',
        category: 'File',
      },
    ];

    const unregisterFns = shortcuts.map((s) => registerShortcut(s));
    return () => unregisterFns.forEach((fn) => fn());
  }, [registerShortcut, projectId]);

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        height: '100vh',
        width: '100vw',
        backgroundColor: colors.bgMain,
      }}
    >
      {/* Header */}
      <IdeHeader
        projectName={projectName}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        isConnected={isWorkspaceConnected}
        currentBranch={currentBranch}
      />

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Chat */}
        <ErrorBoundary>
          <ChatPanel
            projectId={projectId}
            projectName={projectName}
            workspaceId={workspaceId}
          />
        </ErrorBoundary>

        {/* Right Panel: Main Content */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Editor Container */}
          <div className="flex flex-1 overflow-hidden">
            {/* Settings Mode */}
            {viewMode === 'settings' && (
              <ErrorBoundary>
                <SettingsPanel projectId={projectId} />
              </ErrorBoundary>
            )}

            {/* Coding/Preview Mode */}
            {viewMode !== 'settings' && (
              <>
                {/* File Explorer */}
                <ErrorBoundary>
                  <FileExplorerPanel projectId={projectId} />
                </ErrorBoundary>

                {/* Code Editor */}
                {viewMode === 'coding' && (
                  <ErrorBoundary>
                    <CodeEditorPanel projectId={projectId} />
                  </ErrorBoundary>
                )}

                {/* Preview */}
                {viewMode === 'preview' && (
                  <ErrorBoundary>
                    <PreviewPanel />
                  </ErrorBoundary>
                )}
              </>
            )}
          </div>

          {/* Bottom Panel */}
          {viewMode !== 'settings' && (
            <ErrorBoundary>
              <TerminalPanel
                projectId={projectId}
                activeTab={bottomPanelTab}
                onTabChange={setBottomPanelTab}
                projectType={projectType}
              />
            </ErrorBoundary>
          )}
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={[
          {
            id: 'new-file',
            title: 'New File',
            category: 'File',
            shortcut: 'Ctrl+N',
            action: () => logger.debug('New file'),
          },
          {
            id: 'open-file',
            title: 'Open File',
            category: 'File',
            shortcut: 'Ctrl+O',
            action: () => logger.debug('Open file'),
          },
          {
            id: 'toggle-preview',
            title: 'Toggle Preview',
            category: 'View',
            action: () => setViewMode(viewMode === 'preview' ? 'coding' : 'preview'),
          },
          {
            id: 'toggle-settings',
            title: 'Open Settings',
            category: 'View',
            action: () => setViewMode('settings'),
          },
        ]}
      />
    </div>
  );
}

export default IdeShell;
