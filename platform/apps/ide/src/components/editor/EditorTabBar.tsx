/**
 * Editor Tab Bar Component
 *
 * Manages editor tabs with:
 * - Tab management (open, close, reorder)
 * - Draggable tab reordering
 * - File status indicators (modified, unsaved)
 * - Close buttons with hover effects
 * - Tab overflow handling
 *
 * @example
 * <EditorTabBar
 *   tabs={openTabs}
 *   activeTabId="file1"
 *   onTabSelect={(id) => console.log('Selected:', id)}
 *   onTabClose={(id) => console.log('Close:', id)}
 *   onTabReorder={(from, to) => console.log('Reorder:', from, to)}
 * />
 */

import React, { useState, useRef, useCallback } from 'react';
import { motion, Reorder, AnimatePresence } from 'framer-motion';
import { X, FileCode, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { SimpleTooltip as Tooltip } from '@/components/ui/Tooltip';

// ============================================================================
// Types
// ============================================================================

export interface EditorTab {
  id: string;
  name: string;
  path: string;
  language?: string;
  isModified?: boolean;
  isUnsaved?: boolean;
  isActive?: boolean;
}

export interface EditorTabBarProps {
  tabs: EditorTab[];
  activeTabId?: string;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder?: (oldIndex: number, newIndex: number) => void;
  onCloseAll?: () => void;
  onCloseOthers?: (tabId: string) => void;
  className?: string;
}

// ============================================================================
// Tab Item Component
// ============================================================================

interface TabItemProps {
  tab: EditorTab;
  isActive: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
}

function TabItem({ tab, isActive, onSelect, onClose }: TabItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showClose, setShowClose] = useState(false);

  const handleMouseEnter = () => {
    setIsHovered(true);
    setShowClose(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (!tab.isModified && !tab.isUnsaved) {
      setShowClose(false);
    }
  };

  return (
    <Tooltip content={tab.path} side="bottom">
      <motion.div
        layout
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.15 }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={onSelect}
        className={cn(
          'group relative flex items-center gap-2 px-3 py-2 min-w-[120px] max-w-[200px]',
          'cursor-pointer select-none transition-all duration-fast',
          'border-r border-ide-border',
          isActive
            ? 'bg-ide-bg-primary text-ide-text-primary'
            : 'bg-ide-bg-secondary text-ide-text-secondary hover:bg-ide-bg-tertiary hover:text-ide-text-primary'
        )}
        role="tab"
        aria-selected={isActive}
      >
        {/* Active indicator */}
        {isActive && (
          <motion.div
            layoutId="active-tab-indicator"
            className="absolute top-0 left-0 right-0 h-0.5 bg-ide-accent-primary"
            transition={{ duration: 0.15 }}
          />
        )}

        {/* File icon */}
        <FileCode className="h-4 w-4 flex-shrink-0 text-ide-text-muted" />

        {/* Tab name */}
        <span className="flex-1 truncate text-xs font-medium">
          {tab.name}
        </span>

        {/* Status indicators */}
        <div className="flex items-center gap-1">
          {/* Modified indicator */}
          {(tab.isModified || tab.isUnsaved) && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-2 h-2 rounded-full bg-ide-accent-warning"
              title={tab.isUnsaved ? 'Unsaved' : 'Modified'}
            />
          )}

          {/* Close button */}
          <AnimatePresence>
            {showClose && (
              <motion.button
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.1 }}
                onClick={onClose}
                className={cn(
                  'flex items-center justify-center w-4 h-4 rounded',
                  'text-ide-text-muted hover:text-ide-text-primary hover:bg-ide-bg-elevated',
                  'transition-colors duration-fast'
                )}
                aria-label={`Close ${tab.name}`}
              >
                <X className="h-3 w-3" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </Tooltip>
  );
}

// ============================================================================
// Main Tab Bar Component
// ============================================================================

export function EditorTabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onCloseAll,
  onCloseOthers,
  className,
}: EditorTabBarProps) {
  const [orderedTabs, setOrderedTabs] = useState(tabs);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync with external tabs
  React.useEffect(() => {
    if (!isDragging) {
      setOrderedTabs(tabs);
    }
  }, [tabs, isDragging]);

  const handleReorder = useCallback(
    (newOrder: EditorTab[]) => {
      setOrderedTabs(newOrder);

      // Find the moved tab and calculate indices
      if (onTabReorder) {
        const oldIndex = tabs.findIndex((t) => t.id === newOrder[0].id);
        const newIndex = newOrder.findIndex((t) => t.id === tabs[0].id);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          onTabReorder(oldIndex, newIndex);
        }
      }
    },
    [tabs, onTabReorder]
  );

  const handleDragStart = () => {
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Scroll active tab into view
  React.useEffect(() => {
    if (scrollRef.current && activeTabId) {
      const activeTab = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
      if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [activeTabId]);

  if (tabs.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center h-9 px-4 border-b border-ide-border bg-ide-bg-secondary',
          'text-ide-text-muted text-xs',
          className
        )}
      >
        No files open
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center h-9 border-b border-ide-border bg-ide-bg-secondary',
        className
      )}
    >
      {/* Tab list */}
      <div
        ref={scrollRef}
        className="flex-1 flex overflow-x-auto overflow-y-hidden scrollbar-hide"
      >
        {onTabReorder ? (
          <Reorder.Group
            axis="x"
            values={orderedTabs}
            onReorder={handleReorder}
            className="flex"
          >
            {orderedTabs.map((tab) => (
              <Reorder.Item
                key={tab.id}
                value={tab}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                className="flex-shrink-0"
              >
                <TabItem
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onSelect={() => onTabSelect(tab.id)}
                  onClose={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                />
              </Reorder.Item>
            ))}
          </Reorder.Group>
        ) : (
          tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={() => onTabSelect(tab.id)}
              onClose={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
            />
          ))
        )}
      </div>

      {/* Tab actions */}
      <div className="flex items-center gap-1 px-2 border-l border-ide-border">
        {onCloseOthers && activeTabId && (
          <Tooltip content="Close other tabs" side="top">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onCloseOthers(activeTabId)}
            >
              <Circle className="h-3 w-3" />
            </Button>
          </Tooltip>
        )}
        {onCloseAll && (
          <Tooltip content="Close all tabs" side="top">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onCloseAll}
            >
              <X className="h-3 w-3" />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default EditorTabBar;
