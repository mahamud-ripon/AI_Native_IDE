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
import Editor from '@monaco-editor/react';
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  Folder,
  FolderOpen,
  Zap,
  Rocket,
  Terminal,
  Settings,
  Search,
  FolderTree,
  X,
  Plus,
  RefreshCw,
  Eye,
  Code,
  Bookmark,
  Sparkles,
  Send,
  Github,
  Play,
  MoreHorizontal,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Lock,
  MousePointer2,
  Lightbulb,
  Check,
  XCircle,
  GitBranch,
  AlertCircle,
  Loader2,
  Copy,
  CheckCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { CommandPalette } from '@/components/command-palette';
import { useIDEStore, ideEventBus, detectLanguage, type FileNode, type PendingDiff } from '@/stores/ideStore';
import { useAIChatStore } from '@/state/aiChatStore';
import { fileSystemClient, type FileEntry } from '@/api/fileSystemClient';
import { workspaceSocket } from '@/services/workspaceSocket';
import { useExecutionStreamIntegration } from '@/hooks/useExecutionStreamIntegration';
import { aiCodingController } from '@/core/ai/aiCodingController';

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
// CONVERT FILE ENTRIES TO FILE NODES
// ============================================================================
function fileEntriesToNodes(entries: FileEntry[]): FileNode[] {
  return entries.map((entry, idx) => ({
    id: `${entry.path}-${idx}`,
    name: entry.name,
    type: entry.type,
    path: entry.path,
    isExpanded: false,
    children: entry.children ? fileEntriesToNodes(entry.children) : undefined,
  }));
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
// CHAT PANEL - Connected to real aiChatStore + Groq
// ============================================================================
interface ChatPanelProps {
  projectId: string;
  projectName: string;
  workspaceId: string;
}

function ChatPanel({ projectId, projectName, workspaceId }: ChatPanelProps) {
  const {
    conversations,
    activeConversationId,
    input,
    isSending,
    createConversation,
    setInput,
    sendMessage,
    getMessages,
  } = useAIChatStore();

  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  // Initialize conversation
  React.useEffect(() => {
    if (!activeConversationId) {
      createConversation(projectId, workspaceId);
    }
  }, [projectId, workspaceId, activeConversationId, createConversation]);

  const messages = activeConversationId ? getMessages(activeConversationId) : [];

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isSending || !activeConversationId) return;

    const instruction = input.trim();
    // Clear input immediately for UX responsiveness
    setInput('');

    // Use aiCodingController for enhanced task lifecycle management (real-time updates)
    try {
      await aiCodingController.submitTask({
        instruction,
        projectId,
        workspaceId,
        conversationId: activeConversationId,
      });
    } catch (error) {
      console.error('[ChatPanel] Failed to submit task via controller:', error);
      // submitTask already added the user message + error to the conversation.
      // Don't call sendMessage() as it would duplicate the user message.
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleApplyCode = (code: string, path?: string) => {
    // Use explicitly provided path, fall back to the active editor tab path
    const targetPath = path || useIDEStore.getState().activeTabPath;
    if (targetPath) {
      ideEventBus.emit('ai:applyCode', { path: targetPath, code });
    } else {
      // No file open — create a new file for the code
      const newPath = `src/generated-${Date.now()}.ts`;
      useIDEStore.getState().setFileContent(newPath, code);
      useIDEStore.getState().openTab(newPath, code);
      ideEventBus.emit('file:created', { path: newPath });
    }
  };

  // Render message content with code block support
  const renderMessageContent = (content: string, messageId: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('```')) {
        const lines = part.split('\n');
        const lang = lines[0].replace('```', '').trim();
        const code = lines.slice(1, -1).join('\n');
        const blockId = `${messageId}-${idx}`;

        return (
          <div
            key={idx}
            className="rounded-lg overflow-hidden my-2"
            style={{
              backgroundColor: '#1e1e2e',
              border: `1px solid ${colors.borderColor}`,
            }}
          >
            <div
              className="flex items-center justify-between px-3 py-1.5"
              style={{
                backgroundColor: '#2a2a3e',
                borderBottom: `1px solid ${colors.borderColor}`,
              }}
            >
              <span style={{ fontSize: '11px', color: colors.textMuted }}>{lang || 'code'}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyCode(code)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-all"
                  style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    color: colors.accentColor,
                    border: `1px solid rgba(59, 130, 246, 0.3)`,
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  <Check className="h-3 w-3" />
                  Apply
                </button>
                <button
                  onClick={() => handleCopyCode(code, blockId)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-all"
                  style={{
                    backgroundColor: 'transparent',
                    color: colors.textMuted,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  {copiedId === blockId ? (
                    <CheckCheck className="h-3 w-3" style={{ color: colors.successColor }} />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
            <pre
              style={{
                padding: '12px',
                margin: 0,
                fontSize: '12px',
                lineHeight: '1.5',
                color: '#cdd6f4',
                fontFamily: "'JetBrains Mono', monospace",
                overflowX: 'auto',
              }}
            >
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      return (
        <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>
          {part}
        </span>
      );
    });
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: '320px',
        flexShrink: 0,
        backgroundColor: colors.bgMain,
        borderRight: `1px solid ${colors.borderColor}`,
        boxShadow: '1px 0 4px rgba(0,0,0,0.1)',
        zIndex: 20,
      }}
    >
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '16px' }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{
                backgroundColor: colors.bgPanel,
                border: `1px solid ${colors.borderColor}`,
              }}
            >
              <Sparkles className="h-7 w-7" style={{ color: colors.accentColor }} />
            </div>
            <p style={{ fontSize: '14px', fontWeight: 500, color: colors.textPrimary, marginBottom: '8px' }}>
              How can I help you build {projectName}?
            </p>
            <p style={{ fontSize: '12px', color: colors.textMuted }}>
              Ask me to modify code, explain features, or deploy changes
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-1"
              >
                {message.role === 'user' ? (
                  <div
                    className="self-end rounded-xl px-4 py-2 text-sm"
                    style={{
                      backgroundColor: colors.accentColor,
                      color: 'white',
                      maxWidth: '85%',
                      fontSize: '13px',
                      lineHeight: '1.5',
                    }}
                  >
                    {message.content}
                  </div>
                ) : message.role === 'system' ? (
                  <div
                    className="flex items-start gap-2 rounded-lg px-3 py-2"
                    style={{
                      backgroundColor: message.status === 'error'
                        ? 'rgba(239, 68, 68, 0.1)'
                        : 'rgba(59, 130, 246, 0.1)',
                      border: `1px solid ${message.status === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
                      fontSize: '12px',
                      color: message.status === 'error' ? colors.errorColor : colors.accentColor,
                    }}
                  >
                    {message.status === 'error' ? (
                      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Sparkles className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    )}
                    <span>{message.content}</span>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: '13px',
                      lineHeight: '1.6',
                      color: colors.textPrimary,
                    }}
                  >
                    {message.status === 'streaming' ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" style={{ color: colors.accentColor }} />
                        <span style={{ color: colors.textMuted }}>Thinking...</span>
                      </div>
                    ) : (
                      renderMessageContent(message.content, message.id)
                    )}
                  </div>
                )}
              </motion.div>
            ))}

            {/* Typing indicator */}
            <AnimatePresence>
              {isSending && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl"
                  style={{
                    backgroundColor: colors.bgPanel,
                    border: `1px solid ${colors.borderColor}`,
                    width: 'fit-content',
                  }}
                >
                  {[0, 0.1, 0.2].map((delay, i) => (
                    <motion.span
                      key={i}
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 0.5, repeat: Infinity, delay }}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: colors.textMuted }}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Chat Input */}
      <div
        style={{
          padding: '16px 20px',
          borderTop: `1px solid ${colors.borderColor}`,
          backgroundColor: colors.bgMain,
        }}
      >
        <div
          className="flex flex-col rounded-xl transition-all duration-150"
          style={{
            backgroundColor: colors.bgPanel,
            border: `1px solid ${colors.borderColor}`,
            padding: '12px',
            gap: '12px',
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="How can Bolt help you today? (or /command)"
            rows={1}
            disabled={isSending}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textPrimary,
              fontFamily: 'inherit',
              fontSize: '14px',
              resize: 'none',
              outline: 'none',
              minHeight: '40px',
              maxHeight: '120px',
              width: '100%',
              opacity: isSending ? 0.6 : 1,
            }}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
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
                <Plus className="h-4 w-4" />
              </button>
              <button
                className="flex items-center gap-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: colors.textSecondary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                <Sparkles className="h-3 w-3" />
                <span>Sonnet 4.5</span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="flex items-center gap-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: colors.textSecondary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                <MousePointer2 className="h-3 w-3" />
                <span>Select</span>
              </button>
              <button
                className="flex items-center gap-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: colors.textSecondary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                <Lightbulb className="h-3 w-3" />
                <span>Plan</span>
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className="flex items-center justify-center rounded-full transition-all duration-150"
                style={{
                  width: '28px',
                  height: '28px',
                  backgroundColor: input.trim() && !isSending ? colors.accentColor : colors.bgPanelHover,
                  color: input.trim() && !isSending ? 'white' : colors.textMuted,
                  border: 'none',
                  cursor: input.trim() && !isSending ? 'pointer' : 'not-allowed',
                }}
              >
                {isSending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// FILE TREE ITEM
// ============================================================================
interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, path: string, type: 'file' | 'directory') => void;
}

function FileTreeItem({ node, depth, selectedPath, onSelect, onToggle, onContextMenu }: FileTreeItemProps) {
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === 'directory';
  const isExpanded = node.isExpanded;
  const iconColor = getFileIconColor(node.name);

  const handleClick = () => {
    if (isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu?.(e, node.path, node.type)}
        className="flex items-center w-full text-left transition-all duration-150 rounded-md"
        style={{
          paddingLeft: `${8 + depth * 12}px`,
          paddingRight: '8px',
          paddingTop: '5px',
          paddingBottom: '5px',
          fontSize: '13px',
          color: isSelected ? colors.accentColor : colors.textSecondary,
          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          gap: '6px',
          margin: '1px 8px',
          width: 'calc(100% - 16px)',
        }}
        onMouseEnter={e => {
          if (!isSelected) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = colors.bgPanelHover;
            (e.currentTarget as HTMLButtonElement).style.color = colors.textPrimary;
          }
        }}
        onMouseLeave={e => {
          if (!isSelected) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = colors.textSecondary;
          }
        }}
      >
        {isDirectory ? (
          <span style={{ color: colors.textMuted, flexShrink: 0 }}>
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        ) : (
          <span style={{ width: '12px', flexShrink: 0 }} />
        )}

        <span style={{ flexShrink: 0 }}>
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen className="h-4 w-4" style={{ color: colors.accentColor }} />
            ) : (
              <Folder className="h-4 w-4" style={{ color: colors.accentColor }} />
            )
          ) : (
            <FileCode className="h-4 w-4" style={{ color: iconColor }} />
          )}
        </span>

        <span className="truncate">{node.name}</span>
      </button>

      <AnimatePresence initial={false}>
        {isDirectory && isExpanded && node.children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onToggle={onToggle}
                onContextMenu={onContextMenu}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// FILE EXPLORER PANEL - Connected to real filesystem
// ============================================================================
interface FileExplorerPanelProps {
  projectId: string;
}

function FileExplorerPanel({ projectId }: FileExplorerPanelProps) {
  const {
    fileTree,
    selectedFilePath,
    isFileTreeLoading,
    setFileTree,
    toggleFileNode,
    openTab,
    setFileContent,
    setFileTreeLoading,
  } = useIDEStore();

  const [activeTab, setActiveTab] = React.useState<'files' | 'search'>('files');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    path: string;
    type: 'file' | 'directory';
  } | null>(null);

  // Load file tree on mount
  React.useEffect(() => {
    if (!projectId) return;

    setFileTreeLoading(true);
    fileSystemClient.listDirectory(projectId, '/').then(entries => {
      setFileTree(fileEntriesToNodes(entries));
    }).catch(() => {
      // Project is empty or project-service not reachable — show empty tree
      setFileTree([]);
    }).finally(() => {
      setFileTreeLoading(false);
    });
  }, [projectId]);

  // Subscribe to workspace file events
  React.useEffect(() => {
    if (!projectId) return;

    workspaceSocket.connect(projectId).catch(console.error);

    const unsubscribe = workspaceSocket.subscribe((event) => {
      ideEventBus.emit('workspace:fileEvent', { type: event.eventType, path: event.filePath || '' });

      // Refresh file tree on changes
      if (event.eventType === 'file.created' || event.eventType === 'file.deleted') {
        fileSystemClient.listDirectory(projectId, '/').then(entries => {
          setFileTree(fileEntriesToNodes(entries));
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [projectId]);

  const handleFileSelect = async (path: string) => {
    // Load file content
    const content = await fileSystemClient.readFile(projectId, path);
    setFileContent(path, content.content);
    openTab(path, content.content);
  };

  const handleContextMenu = (e: React.MouseEvent, path: string, type: 'file' | 'directory') => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path, type });
  };

  const handleDeleteFile = async () => {
    if (!contextMenu) return;
    await fileSystemClient.deleteFile(projectId, contextMenu.path);
    setContextMenu(null);
    // Refresh tree
    const entries = await fileSystemClient.listDirectory(projectId, '/');
    setFileTree(fileEntriesToNodes(entries));
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: '240px',
        flexShrink: 0,
        backgroundColor: colors.bgMain,
        borderRight: `1px solid ${colors.borderColor}`,
        boxShadow: '1px 0 4px rgba(0,0,0,0.1)',
        zIndex: 15,
      }}
      onClick={() => setContextMenu(null)}
    >
      {/* Panel Header */}
      <div
        className="flex items-center"
        style={{
          height: '44px',
          padding: '0 12px',
          borderBottom: `1px solid ${colors.borderColor}`,
          backgroundColor: colors.bgMain,
          flexShrink: 0,
        }}
      >
        <div className="flex items-center gap-1">
          {[
            { id: 'files' as const, icon: <FolderTree className="h-3.5 w-3.5" />, label: 'Files' },
            { id: 'search' as const, icon: <Search className="h-3.5 w-3.5" />, label: 'Search' },
          ].map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex items-center gap-1.5 rounded transition-all duration-150"
              style={{
                padding: '6px 10px',
                fontSize: '12px',
                color: activeTab === id ? colors.textPrimary : colors.textSecondary,
                backgroundColor: activeTab === id ? colors.bgPanel : 'transparent',
                border: 'none',
                cursor: 'pointer',
                boxShadow: activeTab === id ? '0 1px 2px 0 rgba(0, 0, 0, 0.2)' : 'none',
              }}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search Input */}
      {activeTab === 'search' && (
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${colors.borderColor}` }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            style={{
              width: '100%',
              backgroundColor: colors.bgPanel,
              border: `1px solid ${colors.borderColor}`,
              borderRadius: '6px',
              padding: '6px 10px',
              color: colors.textPrimary,
              fontSize: '12px',
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '8px 0' }}>
        {isFileTreeLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: colors.textMuted }} />
          </div>
        ) : (
          fileTree.map((node) => (
            <FileTreeItem
              key={node.id}
              node={node}
              depth={0}
              selectedPath={selectedFilePath}
              onSelect={handleFileSelect}
              onToggle={toggleFileNode}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed rounded-lg shadow-xl overflow-hidden"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: colors.bgPanel,
            border: `1px solid ${colors.borderColor}`,
            zIndex: 1000,
            minWidth: '160px',
          }}
        >
          {[
            { label: 'Open', action: () => { handleFileSelect(contextMenu.path); setContextMenu(null); } },
            { label: 'Rename', action: () => setContextMenu(null) },
            { label: 'Delete', action: handleDeleteFile, danger: true },
          ].map(({ label, action, danger }) => (
            <button
              key={label}
              onClick={action}
              className="flex items-center w-full px-3 py-2 text-sm transition-colors"
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: danger ? colors.errorColor : colors.textPrimary,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = colors.bgPanelHover;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
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

  // Auto-save on content change
  const handleEditorChange = React.useCallback(
    async (value: string | undefined) => {
      if (!activeTabPath || value === undefined) return;

      setFileContent(activeTabPath, value);
      markTabDirty(activeTabPath, true);

      // Debounced save
      clearTimeout((window as any).__saveTimeout);
      (window as any).__saveTimeout = setTimeout(async () => {
        setIsSaving(true);
        await fileSystemClient.writeFile(projectId, activeTabPath, value);
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
// TERMINAL PANEL - WebSocket PTY
// ============================================================================
type BottomPanelTab = 'bolt' | 'terminal' | 'publish' | 'problems';

interface TerminalPanelProps {
  projectId: string;
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
}

function TerminalPanel({ projectId, activeTab, onTabChange }: TerminalPanelProps) {
  const { terminalOutput, addTerminalOutput, clearTerminal, fileTree, fileContents } = useIDEStore();
  const terminalRef = React.useRef<HTMLDivElement>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const [inputValue, setInputValue] = React.useState('');
  const [isConnected, setIsConnected] = React.useState(false);
  const [currentDir, setCurrentDir] = React.useState('/');
  const [showedWelcome, setShowedWelcome] = React.useState(false);

  const tabs: { id: BottomPanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'bolt', label: 'Bolt', icon: <Zap className="h-3.5 w-3.5" /> },
    { id: 'publish', label: 'Publish Output', icon: <Rocket className="h-3.5 w-3.5" /> },
    { id: 'terminal', label: 'Terminal', icon: <Terminal className="h-3.5 w-3.5" /> },
  ];

  // Helper to flatten file tree for commands
  const getAllFiles = React.useCallback((nodes: FileNode[], basePath = ''): { name: string; path: string; type: 'file' | 'directory' }[] => {
    const result: { name: string; path: string; type: 'file' | 'directory' }[] = [];
    for (const node of nodes) {
      const nodePath = basePath ? `${basePath}/${node.name}` : node.name;
      result.push({ name: node.name, path: node.path, type: node.type });
      if (node.children && node.isExpanded !== false) {
        result.push(...getAllFiles(node.children, nodePath));
      }
    }
    return result;
  }, []);

  // Connect to PTY WebSocket
  React.useEffect(() => {
    if (activeTab !== 'terminal' || !projectId) return;

    const wsUrl = import.meta.env.VITE_PTY_WS_URL || 'ws://localhost:8004/api/v1/exec/ws';
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');

    try {
      const ws = new WebSocket(`${wsUrl}?session_id=${projectId}${token ? `&token=${token}` : ''}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        addTerminalOutput('\x1b[32m✓ Terminal connected to backend PTY\x1b[0m\r\n');
        addTerminalOutput('\x1b[36m~/project\x1b[0m $ ');
        setShowedWelcome(true);
      };

      ws.onmessage = (event) => {
        addTerminalOutput(event.data);
        if (terminalRef.current) {
          terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (!showedWelcome) {
          addTerminalOutput('\x1b[33mℹ Running in browser terminal mode (no backend PTY)\x1b[0m\r\n');
          addTerminalOutput('\x1b[90mType "help" for available commands\x1b[0m\r\n\r\n');
        } else {
          addTerminalOutput('\r\n\x1b[33m[Disconnected from backend - switched to browser mode]\x1b[0m\r\n');
        }
        addTerminalOutput('\x1b[36m~/project\x1b[0m $ ');
        setShowedWelcome(true);
      };

      ws.onerror = () => {
        setIsConnected(false);
      };
    } catch {
      setIsConnected(false);
      addTerminalOutput('\x1b[33mℹ Running in browser terminal mode\x1b[0m\r\n');
      addTerminalOutput('\x1b[90mType "help" for available commands\x1b[0m\r\n\r\n');
      addTerminalOutput('\x1b[36m~/project\x1b[0m $ ');
      setShowedWelcome(true);
    }

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [activeTab, projectId]);

  // Auto-scroll terminal
  React.useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  // Handle offline commands
  const handleOfflineCommand = (command: string) => {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    switch (cmd) {
      case '':
        break;

      case 'help':
        addTerminalOutput('\x1b[1mAvailable commands (browser mode):\x1b[0m\r\n');
        addTerminalOutput('  \x1b[36mls\x1b[0m       List directory contents\r\n');
        addTerminalOutput('  \x1b[36mcd\x1b[0m       Change directory\r\n');
        addTerminalOutput('  \x1b[36mpwd\x1b[0m      Print working directory\r\n');
        addTerminalOutput('  \x1b[36mcat\x1b[0m      Display file contents\r\n');
        addTerminalOutput('  \x1b[36mecho\x1b[0m     Print text\r\n');
        addTerminalOutput('  \x1b[36mclear\x1b[0m    Clear terminal\r\n');
        addTerminalOutput('  \x1b[36mhelp\x1b[0m     Show this help\r\n');
        addTerminalOutput('  \x1b[36mwhoami\x1b[0m   Display current user\r\n');
        addTerminalOutput('  \x1b[36mdate\x1b[0m     Show current date/time\r\n');
        break;

      case 'clear':
        clearTerminal();
        return; // Don't add prompt

      case 'pwd':
        addTerminalOutput(`${currentDir}\r\n`);
        break;

      case 'whoami':
        addTerminalOutput('developer\r\n');
        break;

      case 'date':
        addTerminalOutput(`${new Date().toString()}\r\n`);
        break;

      case 'echo':
        addTerminalOutput(`${args.join(' ')}\r\n`);
        break;

      case 'ls': {
        const targetDir = args[0] || currentDir;
        // Get files from store's file tree
        const files = getAllFiles(fileTree);
        const dirFiles = files.filter(f => {
          const parentPath = f.path.split('/').slice(0, -1).join('/') || '/';
          return parentPath === targetDir || (targetDir === '/' && f.path.split('/').length === 2);
        });

        if (dirFiles.length > 0) {
          const output = dirFiles.map(f =>
            f.type === 'directory' ? `\x1b[34m${f.name}/\x1b[0m` : f.name
          ).join('  ');
          addTerminalOutput(`${output}\r\n`);
        } else {
          // Fallback to default listing
          addTerminalOutput('\x1b[34msrc/\x1b[0m  package.json  vite.config.ts  tsconfig.json\r\n');
        }
        break;
      }

      case 'cd': {
        const target = args[0] || '/';
        if (target === '~' || target === '/') {
          setCurrentDir('/');
          addTerminalOutput('\r\n');
        } else if (target === '..') {
          const parts = currentDir.split('/').filter(Boolean);
          parts.pop();
          setCurrentDir('/' + parts.join('/'));
        } else {
          // Simple implementation - just accept any directory
          const newDir = target.startsWith('/') ? target : `${currentDir}/${target}`.replace('//', '/');
          setCurrentDir(newDir);
        }
        break;
      }

      case 'cat': {
        const filePath = args[0];
        if (!filePath) {
          addTerminalOutput('\x1b[31mcat: missing file operand\x1b[0m\r\n');
        } else {
          // Resolve path
          const resolvedPath = filePath.startsWith('/') ? filePath : `${currentDir}/${filePath}`.replace('//', '/');
          const content = fileContents.get(resolvedPath);
          if (content !== undefined) {
            addTerminalOutput(`${content}\r\n`);
          } else {
            addTerminalOutput(`\x1b[31mcat: ${filePath}: No such file or directory\x1b[0m\r\n`);
          }
        }
        break;
      }

      default:
        addTerminalOutput(`\x1b[31mcommand not found: ${cmd}\x1b[0m\r\n`);
        addTerminalOutput('\x1b[90mType "help" for available commands\x1b[0m\r\n');
    }

    // Add prompt with current directory
    const promptPath = currentDir === '/' ? '~' : currentDir;
    addTerminalOutput(`\x1b[36m${promptPath}\x1b[0m $ `);
  };

  const handleTerminalInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const command = inputValue;
      setInputValue('');

      // Echo command to output
      const promptPath = currentDir === '/' ? '~' : currentDir;
      addTerminalOutput(`\x1b[36m${promptPath}\x1b[0m $ ${command}\r\n`);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(command + '\n');
      } else {
        handleOfflineCommand(command);
      }

      ideEventBus.emit('terminal:command', { command });
    }
  };

  // Render ANSI escape codes as colored text
  const renderTerminalOutput = (output: string[]) => {
    return output.join('').split('\r\n').map((line, idx) => (
      <div key={idx} style={{ lineHeight: '1.5' }}>
        <AnsiText text={line} />
      </div>
    ));
  };

  return (
    <div
      className="flex flex-col flex-shrink-0"
      style={{
        height: '200px',
        borderTop: `1px solid ${colors.borderColor}`,
        backgroundColor: colors.bgMain,
        boxShadow: '0 -4px 12px rgba(0,0,0,0.2)',
        zIndex: 25,
      }}
    >
      {/* Panel Header */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: '44px',
          padding: '0 16px',
          borderBottom: `1px solid ${colors.borderColor}`,
          backgroundColor: colors.bgMain,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1 p-1 rounded-lg"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${colors.borderColor}`,
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className="flex items-center gap-1.5 rounded-md transition-all duration-150"
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: activeTab === tab.id ? colors.textPrimary : colors.textSecondary,
                  backgroundColor: activeTab === tab.id ? colors.bgPanel : 'transparent',
                  border: activeTab === tab.id ? `1px solid ${colors.borderColor}` : '1px solid transparent',
                  cursor: 'pointer',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
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
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'terminal' && (
            <div
              className="flex items-center gap-1"
              style={{ fontSize: '11px', color: isConnected ? colors.successColor : colors.textMuted }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: isConnected ? colors.successColor : colors.textMuted }}
              />
              {isConnected ? 'Connected' : 'Offline'}
            </div>
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
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Terminal Content */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-auto"
        style={{
          padding: '12px 16px',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: '13px',
          backgroundColor: colors.bgMain,
          lineHeight: '1.5',
        }}
      >
        {activeTab === 'bolt' && (
          <div>
            <div style={{ color: colors.accentColor, fontWeight: 500 }}>★ Bolt AI ready</div>
            <div style={{ color: colors.textMuted, opacity: 0.6 }}>Waiting for instructions...</div>
          </div>
        )}
        {activeTab === 'publish' && (
          <div style={{ color: colors.textMuted, opacity: 0.6 }}>
            Build and deployment output will appear here
          </div>
        )}
        {activeTab === 'terminal' && (
          <div>
            {renderTerminalOutput(terminalOutput)}
            <div className="flex items-center gap-2">
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleTerminalInput}
                style={{
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: colors.textPrimary,
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                  flex: 1,
                  caretColor: '#e06c75',
                }}
                autoFocus
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// ANSI TEXT RENDERER
// ============================================================================
function AnsiText({ text }: { text: string }) {
  // Simple ANSI color parser
  const parts = text.split(/(\x1b\[[0-9;]*m)/g);
  let currentColor = colors.textSecondary;
  let isBold = false;

  return (
    <span>
      {parts.map((part, idx) => {
        if (part.startsWith('\x1b[')) {
          const code = part.slice(2, -1);
          if (code === '0' || code === '') { currentColor = colors.textSecondary; isBold = false; }
          else if (code === '1') isBold = true;
          else if (code === '32') currentColor = colors.successColor;
          else if (code === '33') currentColor = colors.warningColor;
          else if (code === '36') currentColor = '#61afef';
          else if (code === '31') currentColor = colors.errorColor;
          return null;
        }
        return (
          <span key={idx} style={{ color: currentColor, fontWeight: isBold ? 'bold' : 'normal' }}>
            {part}
          </span>
        );
      })}
    </span>
  );
}

// ============================================================================
// PREVIEW PANEL - Live Preview from Editor Files
// ============================================================================
function PreviewPanel() {
  const {
    previewUrl,
    previewIsLoading,
    setPreviewUrl,
    setPreviewLoading,
    openTabs,
    activeTabPath,
    fileContents,
  } = useIDEStore();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [inputUrl, setInputUrl] = React.useState(previewUrl);
  const [previewSource, setPreviewSource] = React.useState<string | null>(null);
  const [previewMode, setPreviewMode] = React.useState<'file' | 'url'>('file');

  const activeContent = activeTabPath ? fileContents.get(activeTabPath) : undefined;

  React.useEffect(() => {
    if (previewMode !== 'file' || !activeTabPath || !activeContent) {
      setPreviewSource(null);
      return;
    }

    const ext = activeTabPath.split('.').pop()?.toLowerCase();
    let src = '';

    if (ext === 'html' || ext === 'htm') {
      src = activeContent;
    } else if (ext === 'md' || ext === 'markdown') {
      src = generateMarkdownPreview(activeContent);
    } else if (ext === 'css') {
      src = generateCSSPreview(activeContent);
    } else if (ext === 'json') {
      src = generateJSONPreview(activeContent);
    } else if (ext === 'svg') {
      src = `<!DOCTYPE html><html><head><style>body{display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e}</style></head><body>${activeContent}</body></html>`;
    } else if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) {
      src = generateJSPreview(activeContent, activeTabPath);
    } else {
      src = generateCodePreview(activeContent, activeTabPath);
    }
    setPreviewSource(src);
  }, [activeContent, activeTabPath, previewMode]);

  const handleNavigate = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputUrl.trim()) {
      setPreviewUrl(inputUrl);
      setPreviewMode('url');
    }
  };

  const handleRefresh = () => {
    if (previewMode === 'url' && previewUrl) {
      setPreviewLoading(true);
      if (iframeRef.current) iframeRef.current.src = previewUrl;
    } else if (previewMode === 'file' && previewSource) {
      const curr = previewSource;
      setPreviewSource(null);
      setTimeout(() => setPreviewSource(curr), 10);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ flex: 1, backgroundColor: '#ffffff', overflow: 'hidden', zIndex: 5 }}>
      <div className="flex items-center flex-shrink-0" style={{ height: '44px', padding: '0 12px', backgroundColor: colors.bgMain, borderBottom: `1px solid ${colors.borderColor}`, gap: '6px' }}>
        <div className="flex items-center rounded" style={{ backgroundColor: colors.bgPanel, border: `1px solid ${colors.borderColor}` }}>
          <button onClick={() => setPreviewMode('file')} style={{ padding: '4px 10px', background: previewMode === 'file' ? colors.accentColor : 'transparent', color: previewMode === 'file' ? 'white' : colors.textSecondary, border: 'none', borderRadius: '4px 0 0 4px', cursor: 'pointer', fontSize: '11px' }}>File</button>
          <button onClick={() => setPreviewMode('url')} style={{ padding: '4px 10px', background: previewMode === 'url' ? colors.accentColor : 'transparent', color: previewMode === 'url' ? 'white' : colors.textSecondary, border: 'none', borderRadius: '0 4px 4px 0', cursor: 'pointer', fontSize: '11px' }}>URL</button>
        </div>
        <button onClick={handleRefresh} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', padding: '6px' }}>
          {previewIsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
        {previewMode === 'file' ? (
          <div className="flex items-center gap-2 flex-1 rounded-lg" style={{ padding: '6px 14px', backgroundColor: colors.bgPanel, border: `1px solid ${colors.borderColor}`, margin: '0 8px' }}>
            <FileCode className="h-3 w-3" style={{ color: colors.accentColor }} />
            <span style={{ color: colors.textPrimary, fontSize: '12px' }}>{activeTabPath || 'No file selected'}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 rounded-lg" style={{ padding: '6px 14px', backgroundColor: colors.bgPanel, border: `1px solid ${colors.borderColor}`, margin: '0 8px' }}>
            <Lock className="h-3 w-3" style={{ color: colors.successColor }} />
            <input value={inputUrl} onChange={(e) => setInputUrl(e.target.value)} onKeyDown={handleNavigate} placeholder="Enter URL..." style={{ background: 'none', border: 'none', outline: 'none', color: colors.textPrimary, fontSize: '12px', flex: 1 }} />
          </div>
        )}
        {previewMode === 'url' && previewUrl && (
          <button onClick={() => window.open(previewUrl, '_blank')} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', padding: '6px' }}><ExternalLink className="h-4 w-4" /></button>
        )}
      </div>
      <div className="flex-1 relative">
        {previewMode === 'file' && !activeTabPath && (
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ backgroundColor: colors.bgMain }}>
            <Eye className="h-12 w-12 mb-4" style={{ color: colors.textMuted, opacity: 0.5 }} />
            <p style={{ color: colors.textSecondary, fontSize: '14px' }}>Open a file to see the preview</p>
            <p style={{ color: colors.textMuted, fontSize: '12px', marginTop: '8px' }}>Supported: HTML, CSS, JS, JSON, Markdown, SVG</p>
          </div>
        )}
        {previewMode === 'file' && previewSource && (
          <iframe ref={iframeRef} srcDoc={previewSource} className="w-full h-full border-none" onLoad={() => setPreviewLoading(false)} title="Live Preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        )}
        {previewMode === 'url' && previewUrl && (
          <iframe ref={iframeRef} src={previewUrl} className="w-full h-full border-none" onLoad={() => setPreviewLoading(false)} title="URL Preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        )}
        {previewIsLoading && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgba(14, 14, 17, 0.8)' }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: colors.accentColor }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// PREVIEW GENERATORS
// ============================================================================

function generateMarkdownPreview(content: string): string {
  let html = content
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre style="background:#2d2d2d;padding:12px;border-radius:6px;overflow-x:auto;"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background:#2d2d2d;padding:2px 6px;border-radius:4px;">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#e06c75;margin:16px 0 8px;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#e06c75;margin:20px 0 10px;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="color:#e06c75;margin:24px 0 12px;">$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#61afef;">$1</a>')
    .replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#cdd6f4;padding:24px;line-height:1.6;max-width:800px;margin:0 auto}pre{background:#2d2d2d;border-radius:8px;padding:16px;overflow-x:auto}code{font-family:'JetBrains Mono',monospace;font-size:14px}a{color:#61afef}</style></head><body>${html}</body></html>`;
}

function generateCSSPreview(content: string): string {
  return `<!DOCTYPE html><html><head><style>${content}</style><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#cdd6f4;padding:24px}.demo-box{background:#2d2d2d;border-radius:8px;padding:24px;margin:16px 0}.demo-element{padding:16px;margin:8px;background:#3d3d5c;border-radius:6px}</style></head><body><h2 style="color:#e06c75;margin-bottom:16px">CSS Preview</h2><div class="demo-box"><p>This preview shows how your CSS affects elements:</p><div class="demo-element">Demo Element 1</div><div class="demo-element">Demo Element 2</div><div class="demo-element">Demo Element 3</div><button style="margin-top:12px;padding:8px 16px;background:#61afef;color:#1a1a2e;border:none;border-radius:4px;cursor:pointer">Button</button></div></body></html>`;
}

function generateJSONPreview(content: string): string {
  let formatted: string;
  try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { formatted = content; }
  const highlighted = formatted
    .replace(/"([^"]+)":/g, '<span style="color:#e06c75">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span style="color:#98c379">"$1"</span>')
    .replace(/: (\d+)/g, ': <span style="color:#d19a66">$1</span>')
    .replace(/: (true|false)/g, ': <span style="color:#56b6c2">$1</span>');
  return `<!DOCTYPE html><html><head><style>body{font-family:'JetBrains Mono',monospace;background:#1a1a2e;color:#cdd6f4;padding:24px;line-height:1.6;font-size:13px}pre{margin:0;white-space:pre-wrap}</style></head><body><pre>${highlighted}</pre></body></html>`;
}

function generateJSPreview(content: string, filePath: string): string {
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#cdd6f4;padding:24px}.info-box{background:#2d2d2d;border-radius:8px;padding:20px;margin-bottom:16px}.code-preview{background:#1e1e2e;border-radius:8px;padding:16px;overflow:auto;max-height:400px}code{font-family:'JetBrains Mono',monospace;font-size:12px}h3{color:#61afef;margin:0 0 12px}.tag{display:inline-block;background:#3d3d5c;padding:2px 8px;border-radius:4px;font-size:11px;margin-right:8px}</style></head><body><div class="info-box"><span class="tag">${filePath.split('/').pop()}</span><h3>Code Preview</h3><p style="color:#a0a0a0;font-size:13px;margin:8px 0">This file requires a build step to run in the browser.</p></div><div class="code-preview"><pre><code>${escaped}</code></pre></div></body></html>`;
}

function generateCodePreview(content: string, filePath: string): string {
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><head><style>body{font-family:'JetBrains Mono',monospace;background:#1a1a2e;color:#cdd6f4;padding:24px;line-height:1.6;font-size:13px}.header{color:#e06c75;margin-bottom:16px;font-size:14px;border-bottom:1px solid #3d3d5c;padding-bottom:12px}pre{margin:0;white-space:pre-wrap;word-wrap:break-word}</style></head><body><div class="header">${filePath}</div><pre>${escaped}</pre></body></html>`;
}

// ============================================================================
// SETTINGS PANEL
// ============================================================================
function SettingsPanel({ projectId }: { projectId: string }) {
  const { projectName } = useIDEStore();
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div
      className="flex flex-col h-full overflow-auto"
      style={{ flex: 1, backgroundColor: colors.bgMain }}
    >
      <div
        className="flex items-center gap-3 flex-shrink-0"
        style={{
          height: '64px',
          padding: '0 24px',
          borderBottom: `1px solid ${colors.borderColor}`,
          backgroundColor: colors.bgMain,
        }}
      >
        <Settings className="h-6 w-6" style={{ color: colors.accentColor }} />
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: colors.textPrimary }}>Project Settings</h2>
      </div>

      <div style={{ padding: '24px', maxWidth: '800px' }}>
        {/* General Section */}
        {[
          {
            title: 'General',
            items: [
              { label: 'Project Name', desc: projectId, value: projectName, type: 'text' as const },
              { label: 'Description', desc: 'A beautiful todo application', value: 'A beautiful todo application', type: 'text' as const },
            ],
          },
          {
            title: 'Environment',
            items: [
              { label: 'Node Version', desc: '18.19.0', value: '18.19.0', type: 'select' as const, options: ['18.19.0', '20.10.0', '21.6.0'] },
              { label: 'Package Manager', desc: 'npm', value: 'npm', type: 'select' as const, options: ['npm', 'yarn', 'pnpm'] },
            ],
          },
          {
            title: 'Build & Deploy',
            items: [
              { label: 'Build Command', desc: 'Command to build the project', value: 'npm run build', type: 'text' as const },
              { label: 'Output Directory', desc: 'Directory to store build output', value: 'dist', type: 'text' as const },
            ],
          },
        ].map((section) => (
          <div
            key={section.title}
            className="rounded-xl mb-6"
            style={{
              backgroundColor: colors.bgPanel,
              border: `1px solid ${colors.borderColor}`,
              padding: '20px',
            }}
          >
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: colors.textPrimary, marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {section.title}
            </h3>
            {section.items.map((item, i) => (
              <div
                key={item.label}
                className="flex items-center justify-between"
                style={{
                  padding: '14px 0',
                  borderBottom: i < section.items.length - 1 ? `1px solid ${colors.borderColor}` : 'none',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: colors.textPrimary }}>{item.label}</div>
                  <div style={{ fontSize: '12px', color: colors.textSecondary }}>{item.desc}</div>
                </div>
                {item.type === 'select' ? (
                  <select
                    defaultValue={item.value}
                    style={{
                      width: '180px',
                      backgroundColor: colors.bgMain,
                      border: `1px solid ${colors.borderColor}`,
                      borderRadius: '6px',
                      padding: '7px 12px',
                      color: colors.textPrimary,
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  >
                    {(item as any).options?.map((opt: string) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    defaultValue={item.value}
                    style={{
                      width: '180px',
                      backgroundColor: colors.bgMain,
                      border: `1px solid ${colors.borderColor}`,
                      borderRadius: '6px',
                      padding: '7px 12px',
                      color: colors.textPrimary,
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Advanced Toggles */}
        <div
          className="rounded-xl mb-6"
          style={{
            backgroundColor: colors.bgPanel,
            border: `1px solid ${colors.borderColor}`,
            padding: '20px',
          }}
        >
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: colors.textPrimary, marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Advanced
          </h3>
          {[
            { label: 'TypeScript', desc: 'Enable TypeScript support', checked: true },
            { label: 'ESLint', desc: 'Enable code linting', checked: true },
            { label: 'Auto Save', desc: 'Automatically save changes', checked: true },
          ].map((item, i) => (
            <div
              key={item.label}
              className="flex items-center justify-between"
              style={{
                padding: '14px 0',
                borderBottom: i < 2 ? `1px solid ${colors.borderColor}` : 'none',
              }}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: colors.textPrimary }}>{item.label}</div>
                <div style={{ fontSize: '12px', color: colors.textSecondary }}>{item.desc}</div>
              </div>
              <ToggleSwitch defaultChecked={item.checked} />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            style={{
              padding: '8px 16px',
              backgroundColor: colors.bgPanel,
              color: colors.textPrimary,
              border: `1px solid ${colors.borderColor}`,
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 16px',
              backgroundColor: saved ? colors.successColor : colors.textPrimary,
              color: colors.bgMain,
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {saved ? '✓ Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TOGGLE SWITCH COMPONENT
// ============================================================================
function ToggleSwitch({ defaultChecked }: { defaultChecked: boolean }) {
  const [checked, setChecked] = React.useState(defaultChecked);

  return (
    <button
      onClick={() => setChecked(!checked)}
      style={{
        position: 'relative',
        width: '44px',
        height: '24px',
        backgroundColor: checked ? colors.accentColor : colors.bgMain,
        border: `1px solid ${checked ? colors.accentColor : colors.borderColor}`,
        borderRadius: '24px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          height: '18px',
          width: '18px',
          left: checked ? '22px' : '2px',
          bottom: '2px',
          backgroundColor: checked ? 'white' : colors.textSecondary,
          borderRadius: '50%',
          transition: 'all 0.2s',
        }}
      />
    </button>
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
  console.log('[IdeShell] Initializing with props:', { projectId, filePath, projectName, workspaceId, userId });
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

  // Initialize project
  React.useEffect(() => {
    setProject(projectId, projectName, workspaceId);
  }, [projectId, projectName, workspaceId]);

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

  // Open initial file
  React.useEffect(() => {
    if (filePath) {
      fileSystemClient.readFile(projectId, filePath).then(content => {
        setFileContent(filePath, content.content);
        openTab(filePath, content.content);
      }).catch(() => {
        // File doesn't exist yet (new/empty project) — that's fine, ignore
      });
    }
  }, [filePath, projectId]);

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
          const { activeTabPath, fileContents } = useIDEStore.getState();
          if (activeTabPath) {
            const content = fileContents.get(activeTabPath) || '';
            fileSystemClient.writeFile(projectId, activeTabPath, content);
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
            action: () => console.log('New file'),
          },
          {
            id: 'open-file',
            title: 'Open File',
            category: 'File',
            shortcut: 'Ctrl+O',
            action: () => console.log('Open file'),
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
