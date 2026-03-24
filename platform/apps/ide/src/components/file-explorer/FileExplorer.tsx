/**
 * File Explorer Component
 *
 * A comprehensive file tree explorer with:
 * - Collapsible folder tree
 * - File icons based on extension
 * - Context menu for file operations
 * - Search/filter functionality
 * - New file/folder operations
 * - Drag and drop support (prepared)
 *
 * @example
 * <FileExplorer
 *   files={fileTree}
 *   onFileSelect={(path) => console.log('Selected:', path)}
 *   onFileCreate={(path, type) => console.log('Create:', path, type)}
 * />
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileJson,
  FileType,
  FileText,
  FileImage,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ChevronRight,
  ChevronDown,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SimpleTooltip as Tooltip } from '@/components/ui/Tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/ContextMenu';

// ============================================================================
// Types
// ============================================================================

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
  isModified?: boolean;
  isSelected?: boolean;
  isExpanded?: boolean;
}

export interface FileExplorerProps {
  files: FileNode[];
  selectedPath?: string;
  expandedPaths?: Set<string>;
  onFileSelect?: (path: string) => void;
  onFileCreate?: (path: string, type: 'file' | 'directory') => void;
  onFileDelete?: (path: string) => void;
  onFileRename?: (path: string, newName: string) => void;
  onFolderToggle?: (path: string, expanded: boolean) => void;
  onRefresh?: () => void;
  className?: string;
}

// ============================================================================
// File Icon Helper
// ============================================================================

const getFileIcon = (filename: string, isOpen?: boolean) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  
  if (filename === 'package.json' || ext === 'json') {
    return <FileJson className="h-4 w-4 text-[var(--accent-warning)]" />;
  }
  if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) {
    return <FileCode className="h-4 w-4 text-[var(--accent-primary)]" />;
  }
  if (['css', 'scss', 'less', 'sass'].includes(ext || '')) {
    return <FileType className="h-4 w-4 text-[var(--accent-primary)]" />;
  }
  if (['html', 'htm', 'xml'].includes(ext || '')) {
    return <FileText className="h-4 w-4 text-[var(--accent-error)]" />;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) {
    return <FileImage className="h-4 w-4 text-purple-400" />;
  }
  if (['md', 'txt', 'log'].includes(ext || '')) {
    return <FileText className="h-4 w-4 text-[var(--text-secondary)]" />;
  }
  
  return <File className="h-4 w-4 text-[var(--text-secondary)]" />;
};

const getFolderIcon = (isOpen: boolean) => {
  return isOpen ? (
    <FolderOpen className="h-4 w-4 text-[var(--accent-primary)]" />
  ) : (
    <Folder className="h-4 w-4 text-[var(--accent-primary)]" />
  );
};

// ============================================================================
// File Tree Item Component
// ============================================================================

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  selectedPath?: string;
  expandedPaths: Set<string>;
  searchQuery: string;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onCreate: (parentPath: string, type: 'file' | 'directory') => void;
  onRename: (path: string, newName: string) => void;
  onDelete: (path: string) => void;
}

function FileTreeItem({
  node,
  depth,
  selectedPath,
  expandedPaths,
  searchQuery,
  onSelect,
  onToggle,
  onCreate,
  onRename,
  onDelete,
}: FileTreeItemProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === 'directory';
  const hasChildren = isDirectory && node.children && node.children.length > 0;

  // Filter based on search query
  const matchesSearch = useMemo(() => {
    if (!searchQuery) return true;
    return node.name.toLowerCase().includes(searchQuery.toLowerCase());
  }, [node.name, searchQuery]);

  if (!matchesSearch && !isDirectory) {
    return null;
  }

  const handleClick = () => {
    if (isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // Get parent path for creating new files/folders
  const getParentPath = () => {
    if (isDirectory) {
      return node.path;
    }
    // For files, get the parent directory path
    const lastSlashIndex = node.path.lastIndexOf('/');
    return lastSlashIndex > 0 ? node.path.substring(0, lastSlashIndex) : '';
  };

  const handleNewFile = () => {
    const parentPath = getParentPath();
    onCreate(parentPath, 'file');
  };

  const handleNewFolder = () => {
    const parentPath = getParentPath();
    onCreate(parentPath, 'directory');
  };

  const handleOpen = () => {
    onSelect(node.path);
  };

  const handleRename = () => {
    const newName = prompt('Enter new name:', node.name);
    if (newName && newName !== node.name) {
      onRename(node.path, newName);
    }
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete "${node.name}"?`)) {
      onDelete(node.path);
    }
  };

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15, delay: depth * 0.02 }}
            className={cn(
              'group flex items-center gap-1.5 rounded px-2 py-1 cursor-pointer select-none',
              'transition-colors duration-fast',
              isSelected
                ? 'bg-[var(--accent-primary)]/20 text-[var(--text-primary)]'
                : 'hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
            )}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            role="treeitem"
            aria-selected={isSelected}
            aria-expanded={isDirectory ? isExpanded : undefined}
          >
            {/* Expand/collapse indicator */}
            {isDirectory ? (
              <button
                className="flex items-center justify-center w-4 h-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(node.path);
                }}
                aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {isExpanded ? (
                    <motion.div
                      key="expanded"
                      initial={{ rotate: -90 }}
                      animate={{ rotate: 0 }}
                      exit={{ rotate: -90 }}
                      transition={{ duration: 0.15 }}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="collapsed"
                      initial={{ rotate: 90 }}
                      animate={{ rotate: 0 }}
                      exit={{ rotate: 90 }}
                      transition={{ duration: 0.15 }}
                    >
                      <ChevronRight className="h-3 w-3" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            ) : (
              <span className="w-4" />
            )}

            {/* Icon */}
            <span className="flex-shrink-0">
              {isDirectory ? getFolderIcon(isExpanded) : getFileIcon(node.name)}
            </span>

            {/* Name */}
            <span className="flex-1 truncate text-sm">
              {node.name}
            </span>

            {/* Modified indicator */}
            {node.isModified && (
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-warning)]" />
            )}
          </motion.div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-48">
          {isDirectory ? (
            <>
              <ContextMenuItem onClick={handleOpen}>
                Open Folder
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleNewFile}>
                New File...
              </ContextMenuItem>
              <ContextMenuItem onClick={handleNewFolder}>
                New Folder...
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : (
            <ContextMenuItem onClick={handleOpen}>
              Open
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={handleRename}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={handleDelete} className="text-[var(--accent-error)]">
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Children */}
      <AnimatePresence initial={false}>
        {isDirectory && isExpanded && node.children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                searchQuery={searchQuery}
                onSelect={onSelect}
                onToggle={onToggle}
                onContextMenu={() => {}}
                onCreate={onCreate}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Main File Explorer Component
// ============================================================================

export function FileExplorer({
  files,
  selectedPath,
  expandedPaths: controlledExpandedPaths,
  onFileSelect,
  onFileCreate,
  onFileDelete,
  onFileRename,
  onFolderToggle,
  onRefresh,
  className,
}: FileExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [internalExpandedPaths, setInternalExpandedPaths] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Use controlled or uncontrolled expanded paths
  const expandedPaths = controlledExpandedPaths ?? internalExpandedPaths;

  const handleToggle = useCallback((path: string) => {
    if (controlledExpandedPaths) {
      onFolderToggle?.(path, !controlledExpandedPaths.has(path));
    } else {
      setInternalExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    }
  }, [controlledExpandedPaths, onFolderToggle]);

  const handleSearchOpen = () => {
    setIsSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleSearchClose = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
  };

  // Expand all folders when searching
  React.useEffect(() => {
    if (searchQuery && !controlledExpandedPaths) {
      const allPaths = new Set<string>();
      const collectPaths = (nodes: FileNode[]) => {
        nodes.forEach((node) => {
          if (node.type === 'directory') {
            allPaths.add(node.path);
            if (node.children) {
              collectPaths(node.children);
            }
          }
        });
      };
      collectPaths(files);
      setInternalExpandedPaths(allPaths);
    }
  }, [searchQuery, files, controlledExpandedPaths]);

  // Handle creating new file at root level
  const handleCreateNewFile = () => {
    const fileName = prompt('Enter file name:');
    if (fileName) {
      onFileCreate?.(fileName, 'file');
    }
  };

  // Handle creating new folder at root level
  const handleCreateNewFolder = () => {
    const folderName = prompt('Enter folder name:');
    if (folderName) {
      onFileCreate?.(folderName, 'directory');
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-muted)]">
        <AnimatePresence mode="wait">
          {isSearchOpen ? (
            <motion.div
              key="search"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: '100%', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="flex items-center gap-2"
            >
              <Search className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                className="flex-1 h-7 text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleSearchClose}
              >
                <X className="h-3 w-3" />
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="header"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between w-full"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Explorer
              </span>
              <div className="flex items-center gap-1">
                <Tooltip content="Search" side="top">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleSearchOpen}
                  >
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content="New File" side="top">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleCreateNewFile}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content="Refresh" side="top">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={onRefresh}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content="More Actions" side="top">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-auto py-1" role="tree">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--text-muted)]">
            <Folder className="h-8 w-8 mb-2 opacity-50" />
            <span className="text-sm">No files</span>
          </div>
        ) : (
          files.map((file) => (
            <FileTreeItem
              key={file.path}
              node={file}
              depth={0}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              searchQuery={searchQuery}
              onSelect={(path) => onFileSelect?.(path)}
              onToggle={handleToggle}
              onContextMenu={() => {}}
              onCreate={(path, type) => onFileCreate?.(path, type)}
              onRename={(path, newName) => onFileRename?.(path, newName)}
              onDelete={(path) => onFileDelete?.(path)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default FileExplorer;
