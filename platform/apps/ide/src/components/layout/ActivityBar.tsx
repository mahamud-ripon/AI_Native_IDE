/**
 * Activity Bar Component
 *
 * Vertical icon sidebar for navigating between different views.
 * Similar to VS Code's activity bar.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  Files,
  Search,
  GitBranch,
  Bot,
  Puzzle,
  Settings,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { SimpleTooltip } from '../ui/Tooltip';
import { useLayoutStore, type LayoutState } from '../../stores/layoutStore';

/**
 * Activity bar item configuration
 */
interface ActivityBarItem {
  id: NonNullable<LayoutState['activeSidebarView']>;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

/**
 * Bottom activity bar item (can have null id for non-view actions)
 */
interface BottomActivityBarItem {
  id: LayoutState['activeSidebarView'] | null;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

/**
 * Activity bar items configuration
 */
const activityBarItems: ActivityBarItem[] = [
  { id: 'files', icon: Files, label: 'Explorer', shortcut: 'Ctrl+Shift+E' },
  { id: 'search', icon: Search, label: 'Search', shortcut: 'Ctrl+Shift+F' },
  { id: 'git', icon: GitBranch, label: 'Source Control', shortcut: 'Ctrl+Shift+G' },
  { id: 'ai', icon: Bot, label: 'AI Assistant', shortcut: 'Ctrl+Shift+A' },
];

/**
 * Bottom activity bar items (settings, etc.)
 */
const bottomActivityBarItems: BottomActivityBarItem[] = [
  { id: 'extensions', icon: Puzzle, label: 'Extensions' },
  { id: null, icon: Settings, label: 'Settings', shortcut: 'Ctrl+,' },
];

/**
 * Activity bar component props
 */
interface ActivityBarProps {
  className?: string;
}

/**
 * Activity bar component
 */
export function ActivityBar({ className }: ActivityBarProps) {
  const { activeSidebarView, setActiveSidebarView, panels, togglePanel } =
    useLayoutStore();

  const sidebarPanel = panels.sidebar;

  /**
   * Handle activity bar item click
   */
  const handleItemClick = (itemId: LayoutState['activeSidebarView']) => {
    if (itemId === null) {
      // Settings clicked - could open settings modal
      return;
    }

    if (itemId === activeSidebarView && sidebarPanel.visible) {
      // Toggle sidebar off if clicking the same item
      togglePanel('sidebar');
    } else {
      // Switch to the selected view and ensure sidebar is visible
      setActiveSidebarView(itemId);
      if (!sidebarPanel.visible) {
        togglePanel('sidebar');
      }
    }
  };

  /**
   * Render activity bar item
   */
  const renderItem = (
    item: ActivityBarItem | BottomActivityBarItem,
    isBottom = false
  ) => {
    const Icon = item.icon;
    const isActive =
      item.id !== null && item.id === activeSidebarView && sidebarPanel.visible;

    return (
      <SimpleTooltip
        key={item.label}
        content={
          <div className="flex items-center gap-2">
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-[var(--text-muted)]">{item.shortcut}</span>
            )}
          </div>
        }
        side="right"
      >
        <button
          onClick={() => handleItemClick(item.id)}
          className={cn(
            'group relative flex h-12 w-12 items-center justify-center rounded-lg transition-all duration-fast ease-in-out',
            'hover:bg-[var(--bg-elevated)]',
            isActive && 'bg-[var(--bg-elevated)]'
          )}
          aria-label={item.label}
          aria-pressed={isActive}
        >
          {/* Active indicator */}
          {isActive && (
            <motion.div
              layoutId="activeIndicator"
              className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent-primary)]"
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}

          {/* Icon */}
          <Icon
            className={cn(
              'h-6 w-6 transition-colors duration-fast',
              isActive
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'
            )}
          />
        </button>
      </SimpleTooltip>
    );
  };

  return (
    <div
      className={cn(
        'flex h-full w-12 flex-col border-r border-[var(--border-muted)] bg-[var(--bg-secondary)]',
        className
      )}
      role="toolbar"
      aria-label="Activity Bar"
    >
      {/* Top section */}
      <div className="flex flex-col gap-1 p-1">
        {activityBarItems.map((item) => renderItem(item))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom section */}
      <div className="flex flex-col gap-1 p-1">
        {bottomActivityBarItems.map((item) => renderItem(item, true))}
      </div>
    </div>
  );
}

export default ActivityBar;
