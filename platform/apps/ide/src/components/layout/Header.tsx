/**
 * Header Component
 *
 * Minimal chrome header with breadcrumbs, project actions, and user menu.
 * Inspired by Bolt.new and modern cloud IDEs.
 */

import * as React from 'react';
import {
  ChevronRight,
  Share2,
  Play,
  Settings,
  Bell,
  Search,
  Command,
  Github,
  Eye,
  Code,
  Sparkles,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { SimpleTooltip } from '../ui/Tooltip';

// ========================================
// TYPES
// ========================================

type ViewMode = 'coding' | 'preview' | 'settings';

interface HeaderProps {
  projectId: string;
  filePath?: string;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  className?: string;
}

// ========================================
// COMPONENTS
// ========================================

/**
 * Breadcrumb component for file path navigation
 */
function Breadcrumb({ path }: { path?: string }) {
  if (!path) {
    return (
      <span className="text-sm text-[var(--text-muted)]">Welcome</span>
    );
  }

  const segments = path.split('/').filter(Boolean);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center">
      <ol className="flex items-center gap-1">
        {segments.map((segment, index) => (
          <li key={index} className="flex items-center">
            {index > 0 && (
              <ChevronRight className="mx-1 h-4 w-4 text-[var(--text-muted)]" />
            )}
            <span
              className={cn(
                'text-sm',
                index === segments.length - 1
                  ? 'text-[var(--text-primary)] font-medium'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer'
              )}
            >
              {segment}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Search input component
 */
function HeaderSearch() {
  return (
    <div className="relative w-64">
      <Input
        icon={<Search className="h-4 w-4" />}
        placeholder="Search files..."
        className="h-8 bg-[var(--bg-tertiary)] border-transparent focus:border-[var(--accent-primary)]"
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border border-[var(--border-muted)] bg-[var(--bg-secondary)] px-1.5 text-[10px] font-medium text-[var(--text-muted)]">
          <Command className="h-3 w-3" />
          <span>P</span>
        </kbd>
      </div>
    </div>
  );
}

/**
 * Main header component
 */
export function Header({ projectId, filePath, viewMode = 'coding', onViewModeChange, className }: HeaderProps) {
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);

  const handleViewModeChange = (mode: ViewMode) => {
    onViewModeChange?.(mode);
  };

  return (
    <header
      className={cn(
        'flex h-[52px] items-center justify-between border-b bg-[#0e0e11] px-4',
        className
      )}
      style={{ borderColor: 'rgba(255, 255, 255, 0.08)', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', zIndex: 30 }}
    >
      {/* Left section: Logo & Breadcrumbs */}
      <div className="flex items-center gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="text-xl text-[#f4f4f5]">
            <Sparkles className="h-5 w-5 text-[#3b82f6]" />
          </div>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 text-sm text-[#a1a1aa]">
          <div className="w-5 h-5 rounded-full bg-[#10b981] text-white flex items-center justify-center text-xs font-bold">
            R
          </div>
          <span className="text-[#f4f4f5] font-medium">/</span>
          <span className="text-[#f4f4f5] font-medium">Todo Application</span>
          <Settings className="h-3 w-3 text-[#71717a] ml-1" />
        </div>
      </div>

      {/* Center section: View Mode Toggles */}
      <div className="flex-1 flex justify-center px-4">
        <div 
          className="flex items-center gap-1 p-1 rounded-md"
          style={{ backgroundColor: '#18181b', border: '1px solid rgba(255, 255, 255, 0.08)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)' }}
        >
          <SimpleTooltip content="Preview Mode">
            <button
              onClick={() => handleViewModeChange('preview')}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200',
                viewMode === 'preview'
                  ? 'bg-[rgba(59,130,246,0.15)] text-[#3b82f6]'
                  : 'text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[rgba(255,255,255,0.05)]'
              )}
              aria-label="Preview Mode"
            >
              <Eye className="h-4 w-4" />
            </button>
          </SimpleTooltip>
          <SimpleTooltip content="Coding Mode">
            <button
              onClick={() => handleViewModeChange('coding')}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200',
                viewMode === 'coding'
                  ? 'bg-[rgba(59,130,246,0.15)] text-[#3b82f6]'
                  : 'text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[rgba(255,255,255,0.05)]'
              )}
              aria-label="Coding Mode"
            >
              <Code className="h-4 w-4" />
            </button>
          </SimpleTooltip>
          <SimpleTooltip content="Settings Mode">
            <button
              onClick={() => handleViewModeChange('settings')}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200',
                viewMode === 'settings'
                  ? 'bg-[rgba(59,130,246,0.15)] text-[#3b82f6]'
                  : 'text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[rgba(255,255,255,0.05)]'
              )}
              aria-label="Settings Mode"
            >
              <Settings className="h-4 w-4" />
            </button>
          </SimpleTooltip>
        </div>
      </div>

      {/* Right section: Actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <SimpleTooltip content="Notifications">
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
          </Button>
        </SimpleTooltip>

        {/* Settings */}
        <SimpleTooltip content="Settings">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </SimpleTooltip>

        {/* Separator */}
        <div className="h-4 w-px bg-[var(--border-muted)] mx-1" />

        {/* Share button */}
        <Button
          variant="secondary"
          size="sm"
        >
          <Share2 className="h-4 w-4 mr-2" />
          Share
        </Button>

        {/* Deploy button */}
        <Button
          variant="default"
          size="sm"
        >
          <Play className="h-4 w-4 mr-2" />
          Deploy
        </Button>

        {/* User avatar */}
        <SimpleTooltip content="User menu">
          <button
            className="ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white text-sm font-medium hover:bg-[var(--accent-primary-hover)] transition-colors"
            aria-label="User menu"
          >
            U
          </button>
        </SimpleTooltip>
      </div>
    </header>
  );
}

export default Header;
