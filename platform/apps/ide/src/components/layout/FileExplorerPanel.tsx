/**
 * FileExplorerPanel - File tree with search and context menu
 *
 * Connected to real filesystem API + WebSocket events + ideEventBus.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  Folder,
  FolderOpen,
  FolderTree,
  Search,
  Loader2,
  X,
} from 'lucide-react';
import { useIDEStore, ideEventBus, type FileNode } from '@/stores/ideStore';
import { fileSystemClient, type FileEntry } from '@/api/fileSystemClient';
import { workspaceSocket } from '@/services/workspaceSocket';

// Design tokens
const colors = {
  bgMain: '#0e0e11',
  bgPanel: '#18181b',
  bgPanelHover: '#27272a',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  accentColor: '#3b82f6',
  errorColor: '#ef4444',
};

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

// FileTreeItem
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

// Main Panel
interface FileExplorerPanelProps {
  projectId: string;
}

export function FileExplorerPanel({ projectId }: FileExplorerPanelProps) {
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

  // Load file tree on mount - use ref to prevent duplicate requests
  const treeLoadedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!projectId || treeLoadedRef.current === projectId) return;

    treeLoadedRef.current = projectId;
    setFileTreeLoading(true);
    fileSystemClient.listDirectory(projectId, '/').then(entries => {
      setFileTree(fileEntriesToNodes(entries));
    }).catch(() => {
      setFileTree([]);
    }).finally(() => {
      setFileTreeLoading(false);
    });
  }, [projectId]);

  // Subscribe to workspace file events
  // bolt.new approach: All projects are cloud projects with UUID
  const wsConnectedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!projectId || wsConnectedRef.current === projectId) return;

    wsConnectedRef.current = projectId;

    // Try to connect WebSocket, but don't fail if it's unavailable
    workspaceSocket.connect(projectId)
      .then(() => {
        // Connected successfully
      })
      .catch((error) => {
        // WebSocket connection failed - this is OK, we can still work without it
        console.warn('Workspace WebSocket unavailable:', error.message);
      });

    const unsubscribe = workspaceSocket.subscribe((event) => {
      ideEventBus.emit('workspace:fileEvent', { type: event.eventType, path: event.filePath || '' });

      if (event.eventType === 'file.created' || event.eventType === 'file.deleted') {
        fileSystemClient.listDirectory(projectId, '/').then(entries => {
          setFileTree(fileEntriesToNodes(entries));
        });
      }
    });

    return () => { 
      unsubscribe();
      wsConnectedRef.current = null;
    };
  }, [projectId]);

  // Subscribe to ideEventBus for AI-generated file events
  React.useEffect(() => {
    if (!projectId) return;

    const onCreated = async () => {
      try {
        const entries = await fileSystemClient.listDirectory(projectId, '/');
        setFileTree(fileEntriesToNodes(entries));
      } catch { /* refresh failed, ignore */ }
    };

    const onChanged = async () => {
      try {
        const entries = await fileSystemClient.listDirectory(projectId, '/');
        setFileTree(fileEntriesToNodes(entries));
      } catch { /* refresh failed, ignore */ }
    };

    ideEventBus.on('file:created', onCreated);
    ideEventBus.on('file:changed', onChanged);

    return () => {
      ideEventBus.off('file:created', onCreated);
      ideEventBus.off('file:changed', onChanged);
    };
  }, [projectId]);

  const handleFileSelect = async (path: string) => {
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
    const entries = await fileSystemClient.listDirectory(projectId, '/');
    setFileTree(fileEntriesToNodes(entries));
  };

  // Filter tree by search query
  const filteredTree = React.useMemo(() => {
    if (!searchQuery.trim()) return fileTree;
    const filter = (nodes: FileNode[]): FileNode[] =>
      nodes.reduce<FileNode[]>((acc, node) => {
        const matches = node.name.toLowerCase().includes(searchQuery.toLowerCase());
        const filteredChildren = node.children ? filter(node.children) : undefined;
        if (matches || (filteredChildren && filteredChildren.length > 0)) {
          acc.push({ ...node, children: filteredChildren, isExpanded: !!filteredChildren?.length });
        }
        return acc;
      }, []);
    return filter(fileTree);
  }, [fileTree, searchQuery]);

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
        ) : filteredTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <FolderTree className="h-8 w-8 mb-2" style={{ color: colors.textMuted }} />
            <span style={{ fontSize: '12px', color: colors.textMuted }}>
              {searchQuery ? 'No matching files' : 'No files yet'}
            </span>
          </div>
        ) : (
          filteredTree.map((node) => (
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
                color: danger ? colors.errorColor : colors.textPrimary,
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
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
