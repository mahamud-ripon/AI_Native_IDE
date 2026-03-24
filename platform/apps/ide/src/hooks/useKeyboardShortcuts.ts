/**
 * Keyboard Shortcuts Hook
 *
 * Comprehensive keyboard shortcut system for the IDE.
 * Supports custom shortcuts, context-aware bindings, and help modal integration.
 *
 * @example
 * const { registerShortcut, unregisterShortcut, showHelp } = useKeyboardShortcuts();
 *
 * registerShortcut({
 *   id: 'save-file',
 *   key: 'Ctrl+S',
 *   action: () => saveFile(),
 *   description: 'Save current file',
 * });
 */

import { useEffect, useRef, useCallback, useState } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface KeyboardShortcut {
  id: string;
  key: string;
  action: () => void;
  description: string;
  category?: string;
  context?: string;
  preventDefault?: boolean;
}

export interface ShortcutContext {
  id: string;
  name: string;
  shortcuts: KeyboardShortcut[];
}

// ============================================================================
// Parse Key Combination
// ============================================================================

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('cmd', 'meta')
    .replace('command', 'meta')
    .replace('option', 'alt')
    .replace('ctrl', 'control');
}

function parseKeyCombo(combo: string): {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
} {
  const parts = normalizeKey(combo).split('+');
  return {
    ctrl: parts.includes('control') || parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta'),
    key: parts.find((p) => !['control', 'ctrl', 'alt', 'shift', 'meta'].includes(p)) || '',
  };
}

function matchesKeyCombo(event: KeyboardEvent, combo: string): boolean {
  const parsed = parseKeyCombo(combo);

  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.metaKey === parsed.meta &&
    event.key.toLowerCase() === parsed.key.toLowerCase()
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useKeyboardShortcuts() {
  const shortcutsRef = useRef<Map<string, KeyboardShortcut>>(new Map());
  const [shortcutsList, setShortcutsList] = useState<KeyboardShortcut[]>([]);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const registerShortcut = useCallback((shortcut: KeyboardShortcut) => {
    shortcutsRef.current.set(shortcut.id, shortcut);
    setShortcutsList(Array.from(shortcutsRef.current.values()));

    return () => {
      shortcutsRef.current.delete(shortcut.id);
      setShortcutsList(Array.from(shortcutsRef.current.values()));
    };
  }, []);

  const unregisterShortcut = useCallback((id: string) => {
    shortcutsRef.current.delete(id);
    setShortcutsList(Array.from(shortcutsRef.current.values()));
  }, []);

  const showHelp = useCallback(() => {
    setIsHelpOpen(true);
  }, []);

  const hideHelp = useCallback(() => {
    setIsHelpOpen(false);
  }, []);

  // Global keyboard listener
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Show help shortcut
      if (matchesKeyCombo(event, 'ctrl+shift+?') || matchesKeyCombo(event, 'ctrl+/')) {
        event.preventDefault();
        setIsHelpOpen((prev) => !prev);
        return;
      }

      // Check all registered shortcuts
      for (const shortcut of shortcutsRef.current.values()) {
        if (matchesKeyCombo(event, shortcut.key)) {
          if (shortcut.preventDefault !== false) {
            event.preventDefault();
          }
          shortcut.action();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Group shortcuts by category
  const groupedShortcuts = shortcutsList.reduce((acc, shortcut) => {
    const category = shortcut.category || 'General';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(shortcut);
    return acc;
  }, {} as Record<string, KeyboardShortcut[]>);

  return {
    registerShortcut,
    unregisterShortcut,
    shortcuts: shortcutsList,
    groupedShortcuts,
    isHelpOpen,
    showHelp,
    hideHelp,
  };
}

// ============================================================================
// Default IDE Shortcuts
// ============================================================================

export const defaultShortcuts: Omit<KeyboardShortcut, 'action'>[] = [
  { id: 'command-palette', key: 'Ctrl+Shift+P', description: 'Open command palette', category: 'General' },
  { id: 'quick-open', key: 'Ctrl+P', description: 'Quick open file', category: 'General' },
  { id: 'save-file', key: 'Ctrl+S', description: 'Save current file', category: 'File' },
  { id: 'save-all', key: 'Ctrl+Shift+S', description: 'Save all files', category: 'File' },
  { id: 'close-tab', key: 'Ctrl+W', description: 'Close current tab', category: 'File' },
  { id: 'find', key: 'Ctrl+F', description: 'Find in file', category: 'Edit' },
  { id: 'replace', key: 'Ctrl+H', description: 'Replace in file', category: 'Edit' },
  { id: 'find-in-files', key: 'Ctrl+Shift+F', description: 'Find in all files', category: 'Edit' },
  { id: 'toggle-sidebar', key: 'Ctrl+B', description: 'Toggle sidebar', category: 'View' },
  { id: 'toggle-panel', key: 'Ctrl+J', description: 'Toggle bottom panel', category: 'View' },
  { id: 'toggle-terminal', key: 'Ctrl+`', description: 'Toggle terminal', category: 'View' },
  { id: 'new-file', key: 'Ctrl+N', description: 'New file', category: 'File' },
  { id: 'comment-line', key: 'Ctrl+/', description: 'Toggle line comment', category: 'Edit' },
  { id: 'format-document', key: 'Shift+Alt+F', description: 'Format document', category: 'Edit' },
  { id: 'go-to-line', key: 'Ctrl+G', description: 'Go to line', category: 'Navigation' },
  { id: 'go-to-file', key: 'Ctrl+O', description: 'Go to file', category: 'Navigation' },
  { id: 'split-editor', key: 'Ctrl+\\', description: 'Split editor', category: 'View' },
];

export default useKeyboardShortcuts;
