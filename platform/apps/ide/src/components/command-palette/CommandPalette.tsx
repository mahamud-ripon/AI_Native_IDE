/**
 * Command Palette Component
 *
 * Keyboard-centric command palette with:
 * - Fuzzy search for commands
 * - Command categorization with icons
 * - Recent commands section
 * - Keyboard shortcut display
 * - Modal overlay with focus trapping
 *
 * @example
 * <CommandPalette
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   commands={commands}
 *   onSelect={(cmd) => executeCommand(cmd)}
 * />
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Command,
  FileText,
  GitBranch,
  Settings,
  HelpCircle,
  X,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';

// ============================================================================
// Types
// ============================================================================

export interface CommandItem {
  id: string;
  title: string;
  description?: string;
  category: string;
  icon?: React.ReactNode;
  shortcut?: string;
  keywords?: string[];
  action: () => void;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
  recentCommands?: string[];
  placeholder?: string;
}

// ============================================================================
// Fuzzy Search Utility
// ============================================================================

function fuzzyMatch(pattern: string, str: string): boolean {
  pattern = pattern.toLowerCase();
  str = str.toLowerCase();
  let patternIdx = 0;
  let strIdx = 0;

  while (patternIdx < pattern.length && strIdx < str.length) {
    if (pattern[patternIdx] === str[strIdx]) {
      patternIdx++;
    }
    strIdx++;
  }

  return patternIdx === pattern.length;
}

function scoreMatch(pattern: string, item: CommandItem): number {
  let score = 0;
  const searchStr = pattern.toLowerCase();

  // Exact match in title
  if (item.title.toLowerCase().includes(searchStr)) {
    score += 10;
  }

  // Fuzzy match in title
  if (fuzzyMatch(pattern, item.title)) {
    score += 5;
  }

  // Match in description
  if (item.description?.toLowerCase().includes(searchStr)) {
    score += 3;
  }

  // Match in keywords
  if (item.keywords?.some((k) => k.toLowerCase().includes(searchStr))) {
    score += 2;
  }

  // Match in category
  if (item.category.toLowerCase().includes(searchStr)) {
    score += 1;
  }

  return score;
}

// ============================================================================
// Command Item Component
// ============================================================================

interface CommandItemProps {
  item: CommandItem;
  isSelected: boolean;
  onSelect: () => void;
  onClick: () => void;
}

function CommandItemComponent({ item, isSelected, onSelect, onClick }: CommandItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);

  return (
    <div
      ref={ref}
      onMouseEnter={onSelect}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-fast',
        isSelected
          ? 'bg-[var(--accent-primary)]/10 text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
      )}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-md bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-muted)]">
        {item.icon || <Command className="h-4 w-4" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{item.title}</span>
          <span className="text-xs text-[var(--text-muted)] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)]">
            {item.category}
          </span>
        </div>
        {item.description && (
          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
            {item.description}
          </p>
        )}
      </div>

      {item.shortcut && (
        <kbd className="flex-shrink-0 px-2 py-1 text-xs font-mono bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded">
          {item.shortcut}
        </kbd>
      )}
    </div>
  );
}

// ============================================================================
// Main Command Palette Component
// ============================================================================

export function CommandPalette({
  isOpen,
  onClose,
  commands,
  recentCommands = [],
  placeholder = 'Type a command or search...',
}: CommandPaletteProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter and sort commands
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) {
      // Show recent commands first when no search
      const recent = recentCommands
        .map((id) => commands.find((c) => c.id === id))
        .filter(Boolean) as CommandItem[];

      const others = commands.filter((c) => !recentCommands.includes(c.id));
      return [...recent, ...others];
    }

    return commands
      .map((cmd) => ({ cmd, score: scoreMatch(searchQuery, cmd) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.cmd);
  }, [commands, searchQuery, recentCommands]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
          onClose();
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  const handleSelect = (index: number) => {
    setSelectedIndex(index);
  };

  const handleExecute = (command: CommandItem) => {
    command.action();
    onClose();
  };

  // Group commands by category when no search
  const groupedCommands = useMemo(() => {
    if (searchQuery.trim()) return null;

    const groups: Record<string, CommandItem[]> = {};
    filteredCommands.forEach((cmd) => {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category].push(cmd);
    });
    return groups;
  }, [filteredCommands, searchQuery]);

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
    >
      <div className="flex flex-col max-w-2xl">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-muted)]">
          <Search className="h-5 w-5 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none text-base"
          />
          <kbd className="px-2 py-1 text-xs font-mono bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
              <Search className="h-8 w-8 mb-3 opacity-50" />
              <p className="text-sm">No commands found</p>
              <p className="text-xs mt-1">Try a different search term</p>
            </div>
          ) : groupedCommands && !searchQuery.trim() ? (
            // Grouped view (no search)
            Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category}>
                <div className="px-4 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  {category}
                </div>
                {cmds.map((cmd, index) => {
                  const globalIndex = filteredCommands.indexOf(cmd);
                  return (
                    <CommandItemComponent
                      key={cmd.id}
                      item={cmd}
                      isSelected={globalIndex === selectedIndex}
                      onSelect={() => handleSelect(globalIndex)}
                      onClick={() => handleExecute(cmd)}
                    />
                  );
                })}
              </div>
            ))
          ) : (
            // Flat list (with search)
            filteredCommands.map((cmd, index) => (
              <CommandItemComponent
                key={cmd.id}
                item={cmd}
                isSelected={index === selectedIndex}
                onSelect={() => handleSelect(index)}
                onClick={() => handleExecute(cmd)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-muted)] bg-[var(--bg-secondary)] text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <ArrowUp className="h-3 w-3" />
              <ArrowDown className="h-3 w-3" />
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" />
              Select
            </span>
          </div>
          <span>{filteredCommands.length} commands</span>
        </div>
      </div>
    </Modal>
  );
}

export default CommandPalette;
