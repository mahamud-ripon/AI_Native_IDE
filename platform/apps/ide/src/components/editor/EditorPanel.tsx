/**
 * Editor Panel Component
 *
 * Integrated editor workspace with tabs and Monaco editor.
 * Supports multiple files, split editing, and minimap.
 *
 * @example
 * <EditorPanel
 *   projectId="my-project"
 *   files={openFiles}
 *   activeFileId="file1"
 *   onFileChange={(id, content) => console.log('Changed:', id, content)}
 * />
 */

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { EditorTabBar, EditorTab } from './EditorTabBar';
import { SplitEditor, EditorViewState } from './SplitEditor';

// ============================================================================
// Types
// ============================================================================

export interface OpenFile {
  id: string;
  path: string;
  name: string;
  content: string;
  language: string;
  isModified?: boolean;
  isUnsaved?: boolean;
}

export interface EditorPanelProps {
  projectId: string;
  files: OpenFile[];
  activeFileId?: string;
  splitDirection?: 'horizontal' | 'vertical';
  onFileSelect?: (fileId: string) => void;
  onFileClose?: (fileId: string) => void;
  onFileChange?: (fileId: string, content: string) => void;
  onFileSave?: (fileId: string) => void;
  onTabReorder?: (oldIndex: number, newIndex: number) => void;
  onSplitDirectionChange?: (direction: 'horizontal' | 'vertical') => void;
  className?: string;
}

// ============================================================================
// Monaco Editor Placeholder
// ============================================================================

interface MonacoPlaceholderProps {
  file: OpenFile;
  isActive: boolean;
  onChange?: (content: string) => void;
  onSave?: () => void;
}

function MonacoPlaceholder({ file, isActive, onChange, onSave }: MonacoPlaceholderProps) {
  const [localContent, setLocalContent] = useState(file.content);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setLocalContent(newContent);
    onChange?.(newContent);
  };

  // Keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave?.();
    }
  };

  return (
    <div className="flex flex-col h-full bg-ide-bg-primary">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-ide-border bg-ide-bg-secondary">
        <div className="flex items-center gap-2 text-xs text-ide-text-muted">
          <span className="font-mono">{file.path}</span>
          {file.isModified && (
            <span className="px-1.5 py-0.5 rounded bg-ide-accent-warning/20 text-ide-accent-warning">
              Modified
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-ide-text-muted">{file.language}</span>
        </div>
      </div>

      {/* Monaco placeholder */}
      <div className="flex-1 relative overflow-hidden">
        <textarea
          value={localContent}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={cn(
            'w-full h-full p-4 resize-none',
            'bg-ide-bg-primary text-ide-text-primary',
            'font-mono text-sm leading-6',
            'focus:outline-none',
            'selection:bg-ide-accent-primary/30'
          )}
          spellCheck={false}
          disabled={!isActive}
        />

        {/* Minimap overlay */}
        <div className="absolute right-0 top-0 bottom-0 w-[100px] bg-ide-bg-secondary/50 border-l border-ide-border">
          <div className="p-2 text-xs text-ide-text-tertiary text-center">
            Minimap
          </div>
        </div>
      </div>

      {/* Status line */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-ide-border bg-ide-bg-secondary text-xs text-ide-text-muted">
        <div className="flex items-center gap-4">
          <span>Ln 1, Col 1</span>
          <span>UTF-8</span>
          <span>{file.language}</span>
        </div>
        <div className="flex items-center gap-2">
          {file.isModified && (
            <span className="text-ide-accent-warning">Unsaved</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Editor Panel Component
// ============================================================================

export function EditorPanel({
  projectId,
  files,
  activeFileId,
  splitDirection = 'horizontal',
  onFileSelect,
  onFileClose,
  onFileChange,
  onFileSave,
  onTabReorder,
  onSplitDirectionChange,
  className,
}: EditorPanelProps) {
  const [splitViews, setSplitViews] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Convert files to tabs
  const tabs: EditorTab[] = files.map((file) => ({
    id: file.id,
    name: file.name,
    path: file.path,
    language: file.language,
    isModified: file.isModified,
    isUnsaved: file.isUnsaved,
    isActive: file.id === activeFileId,
  }));

  // Convert files to editor views for split editor
  const views: EditorViewState[] = splitViews.length > 0
    ? splitViews.map((id) => {
        const file = files.find((f) => f.id === id);
        return {
          id,
          filePath: file?.path || '',
          content: file?.content || '',
          language: file?.language,
          isActive: id === activeFileId,
        };
      })
    : activeFileId
      ? [
          {
            id: activeFileId,
            filePath: files.find((f) => f.id === activeFileId)?.path || '',
            content: files.find((f) => f.id === activeFileId)?.content || '',
            language: files.find((f) => f.id === activeFileId)?.language,
            isActive: true,
          },
        ]
      : [];

  const handleTabSelect = useCallback(
    (tabId: string) => {
      onFileSelect?.(tabId);
    },
    [onFileSelect]
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      onFileClose?.(tabId);
      // Remove from split views if present
      setSplitViews((prev) => prev.filter((id) => id !== tabId));
    },
    [onFileClose]
  );

  const handleCloseAll = useCallback(() => {
    files.forEach((file) => onFileClose?.(file.id));
    setSplitViews([]);
  }, [files, onFileClose]);

  const handleCloseOthers = useCallback(
    (tabId: string) => {
      files.forEach((file) => {
        if (file.id !== tabId) {
          onFileClose?.(file.id);
        }
      });
      setSplitViews([tabId]);
    },
    [files, onFileClose]
  );

  // Split editor handlers
  const handleSplitView = useCallback((fileId: string) => {
    setSplitViews((prev) => {
      if (prev.includes(fileId)) {
        return prev;
      }
      return [...prev, fileId];
    });
  }, []);

  const handleCloseSplitView = useCallback((viewId: string) => {
    setSplitViews((prev) => prev.filter((id) => id !== viewId));
  }, []);

  // Get active file
  const activeFile = files.find((f) => f.id === activeFileId);

  if (files.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col h-full items-center justify-center',
          'bg-ide-bg-primary text-ide-text-muted',
          className
        )}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h2 className="text-xl font-semibold text-ide-text-primary mb-2">
            Welcome to AI-Native IDE
          </h2>
          <p className="text-sm text-ide-text-secondary mb-4">
            Open a file from the explorer to start editing
          </p>
          <p className="text-xs text-ide-text-tertiary">
            Project: {projectId}
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('flex flex-col h-full', className)}>
      {/* Tab bar */}
      <EditorTabBar
        tabs={tabs}
        activeTabId={activeFileId}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
        onTabReorder={onTabReorder}
        onCloseAll={handleCloseAll}
        onCloseOthers={handleCloseOthers}
      />

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        {splitViews.length > 1 ? (
          <SplitEditor
            views={views}
            direction={splitDirection}
            activeViewId={activeFileId}
            onViewSelect={(id) => onFileSelect?.(id)}
            onViewClose={handleCloseSplitView}
            onDirectionChange={onSplitDirectionChange}
          >
            {splitViews.map((viewId) => {
              const file = files.find((f) => f.id === viewId);
              if (!file) return null;
              return (
                <MonacoPlaceholder
                  key={viewId}
                  file={file}
                  isActive={viewId === activeFileId}
                  onChange={(content) => onFileChange?.(viewId, content)}
                  onSave={() => onFileSave?.(viewId)}
                />
              );
            })}
          </SplitEditor>
        ) : activeFile ? (
          <MonacoPlaceholder
            file={activeFile}
            isActive={true}
            onChange={(content) => onFileChange?.(activeFile.id, content)}
            onSave={() => onFileSave?.(activeFile.id)}
          />
        ) : null}
      </div>
    </div>
  );
}

export default EditorPanel;
