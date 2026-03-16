import { useEffect, useMemo, useRef, useState } from 'react';

import { commandRegistry, type Command } from '../../core/commands/commandRegistry';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      return commandRegistry.getAll();
    }
    return commandRegistry.search(query);
  }, [query]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            executeCommand(filteredCommands[selectedIndex]);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  const executeCommand = async (command: Command) => {
    onClose();
    await commandRegistry.execute(command.id);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '15vh',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 600,
          maxWidth: '90vw',
          background: '#1e1e1e',
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ padding: 12, borderBottom: '1px solid #333' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            style={{
              width: '100%',
              background: '#2d2d2d',
              border: 'none',
              borderRadius: 4,
              padding: '10px 12px',
              fontSize: 14,
              color: '#fff',
              outline: 'none',
            }}
          />
        </div>

        {/* Command list */}
        <div
          style={{
            maxHeight: '50vh',
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {filteredCommands.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#666' }}>
              No commands found
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <div
                key={cmd.id}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: index === selectedIndex ? '#094771' : 'transparent',
                  color: index === selectedIndex ? '#fff' : '#ccc',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}>
                    {cmd.category && (
                      <span style={{ color: '#888', marginRight: 8 }}>
                        {cmd.category}:
                      </span>
                    )}
                    {cmd.label}
                  </div>
                </div>
                {cmd.shortcut && (
                  <div
                    style={{
                      fontSize: 11,
                      color: '#666',
                      background: '#2d2d2d',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    {cmd.shortcut}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid #333',
            fontSize: 11,
            color: '#666',
            display: 'flex',
            gap: 16,
          }}
        >
          <span>↑↓ Navigate</span>
          <span>↵ Execute</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
