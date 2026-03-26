/**
 * TerminalPanel - Unified terminal wrapper
 * Routes to WebContainer (browser projects) or WebSocket PTY (cloud/VM projects)
 */

import * as React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Zap,
  Rocket,
  Terminal,
  Plus,
} from 'lucide-react';
import {
  useIDEStore,
  ideEventBus,
  type FileNode,
  type ProjectType,
  type TerminalConnectionState,
} from '@/stores/ideStore';

const colors = {
  bgMain: '#0e0e11',
  bgPanel: '#18181b',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  accentColor: '#3b82f6',
  successColor: '#10b981',
  warningColor: '#f59e0b',
  errorColor: '#ef4444',
};

type BottomPanelTab = 'bolt' | 'terminal' | 'publish' | 'problems';

interface TerminalPanelProps {
  projectId: string;
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
}

// ANSI Text Renderer - handles \r\n and complex sequences
export function AnsiText({ text }: { text: string }) {
  // Split on ANSI escape sequences (CSI sequences)
  const parts = text.split(/(\x1b\[[0-9;]*[a-zA-Z])/g);
  let currentColor = colors.textSecondary;
  let isBold = false;
  let isDim = false;

  return (
    <span>
      {parts.map((part, idx) => {
        if (part.startsWith('\x1b[')) {
          // Extract the code (strip \x1b[ and trailing letter)
          const code = part.slice(2, -1);
          const letter = part.slice(-1);

          // SGR (Select Graphic Rendition) sequences
          if (letter === 'm') {
            const codes = code.split(';').filter(Boolean);
            for (const c of codes) {
              if (c === '0' || c === '') {
                currentColor = colors.textSecondary;
                isBold = false;
                isDim = false;
              } else if (c === '1') {
                isBold = true;
              } else if (c === '2') {
                isDim = true;
              } else if (c === '22') {
                isBold = false;
                isDim = false;
              } else if (c === '30') {
                currentColor = '#000000';
              } else if (c === '31') {
                currentColor = colors.errorColor;
              } else if (c === '32') {
                currentColor = colors.successColor;
              } else if (c === '33') {
                currentColor = colors.warningColor;
              } else if (c === '34') {
                currentColor = '#3b82f6';
              } else if (c === '35') {
                currentColor = '#a855f7';
              } else if (c === '36') {
                currentColor = '#61afef';
              } else if (c === '37') {
                currentColor = colors.textPrimary;
              } else if (c === '90') {
                currentColor = colors.textMuted;
              } else if (c === '91') {
                currentColor = '#f87171';
              } else if (c === '92') {
                currentColor = '#4ade80';
              } else if (c === '93') {
                currentColor = '#facc15';
              } else if (c === '94') {
                currentColor = '#60a5fa';
              } else if (c === '96') {
                currentColor = '#22d3ee';
              }
            }
            return null;
          }
          // Ignore cursor movement and other non-SGR sequences
          return null;
        }
        return (
          <span key={idx} style={{ color: currentColor, fontWeight: isBold ? 'bold' : 'normal', opacity: isDim ? 0.6 : 1 }}>
            {part}
          </span>
        );
      })}
    </span>
  );
}

// Connection status indicator component
function ConnectionStatus({ state }: { state: TerminalConnectionState }) {
  const config: Record<TerminalConnectionState, { color: string; label: string }> = {
    offline: { color: colors.textMuted, label: 'Offline' },
    connecting: { color: colors.warningColor, label: 'Connecting...' },
    connected: { color: colors.successColor, label: 'Connected' },
    local: { color: colors.warningColor, label: 'Local Mode' },
  };

  const { color, label } = config[state];

  return (
    <div className="flex items-center gap-1" style={{ fontSize: '11px', color }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </div>
  );
}

export function TerminalPanel({ projectId, activeTab, onTabChange }: TerminalPanelProps) {
  const {
    terminalOutput,
    addTerminalOutput,
    clearTerminal,
    fileTree,
    fileContents,
    projectType,
    terminalConnectionState,
    setTerminalConnectionState,
  } = useIDEStore();
  const terminalRef = React.useRef<HTMLDivElement>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const [inputValue, setInputValue] = React.useState('');
  const [currentDir, setCurrentDir] = React.useState('/');
  const handshakeResolved = React.useRef(false);

  const tabs: { id: BottomPanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'bolt', label: 'Bolt', icon: <Zap className="h-3.5 w-3.5" /> },
    { id: 'publish', label: 'Publish Output', icon: <Rocket className="h-3.5 w-3.5" /> },
    { id: 'terminal', label: 'Terminal', icon: <Terminal className="h-3.5 w-3.5" /> },
  ];

  const isCloudProject = projectType === 'cloud';

  const getAllFiles = React.useCallback((nodes: FileNode[]): { name: string; path: string; type: 'file' | 'directory' }[] => {
    const result: { name: string; path: string; type: 'file' | 'directory' }[] = [];
    for (const node of nodes) {
      result.push({ name: node.name, path: node.path, type: node.type });
      if (node.children && node.isExpanded !== false) {
        result.push(...getAllFiles(node.children));
      }
    }
    return result;
  }, []);

  // Connect to PTY WebSocket for cloud projects
  React.useEffect(() => {
    if (activeTab !== 'terminal' || !projectId || !isCloudProject) return;

    handshakeResolved.current = false;
    setTerminalConnectionState('connecting');

    const wsUrl = import.meta.env.VITE_PTY_WS_URL || 'ws://localhost:8004/api/v1/exec/ws';
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');

    try {
      const ws = new WebSocket(`${wsUrl}?session_id=${projectId}${token ? `&token=${token}` : ''}`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Don't mark as connected yet - wait for ready-ack from backend
      };

      ws.onmessage = (event) => {
        // Check for ready-ack handshake message
        if (!handshakeResolved.current) {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ready') {
              handshakeResolved.current = true;
              setTerminalConnectionState('connected');
              addTerminalOutput('\x1b[32m✓ Terminal connected to backend PTY\x1b[0m\r\n');
              addTerminalOutput('\x1b[36m~/project\x1b[0m $ ');
              return;
            }
          } catch {
            // Not JSON, treat as regular output - but still resolve handshake
            if (!handshakeResolved.current) {
              handshakeResolved.current = true;
              setTerminalConnectionState('connected');
              addTerminalOutput('\x1b[32m✓ Terminal connected to backend PTY\x1b[0m\r\n');
            }
          }
        }
        addTerminalOutput(event.data);
        if (terminalRef.current) {
          terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!handshakeResolved.current) {
          // Connection closed before ready-ack - fall back to local mode
          setTerminalConnectionState('local');
          addTerminalOutput('\x1b[33m[Info] Running in local terminal mode (no backend PTY)\x1b[0m\r\n');
          addTerminalOutput('\x1b[90mType "help" for available commands\x1b[0m\r\n\r\n');
        } else {
          setTerminalConnectionState('local');
          addTerminalOutput('\r\n\x1b[33m[Disconnected from backend - switched to local mode]\x1b[0m\r\n');
        }
        addTerminalOutput('\x1b[36m~/project\x1b[0m $ ');
      };

      ws.onerror = () => {
        wsRef.current = null;
        if (!handshakeResolved.current) {
          setTerminalConnectionState('local');
          addTerminalOutput('\x1b[33m[Info] Running in local terminal mode (backend unavailable)\x1b[0m\r\n');
          addTerminalOutput('\x1b[90mType "help" for available commands\x1b[0m\r\n\r\n');
          addTerminalOutput('\x1b[36m~/project\x1b[0m $ ');
          handshakeResolved.current = true;
        }
      };
    } catch {
      setTerminalConnectionState('local');
      addTerminalOutput('\x1b[33m[Info] Running in local terminal mode\x1b[0m\r\n');
      addTerminalOutput('\x1b[90mType "help" for available commands\x1b[0m\r\n\r\n');
      addTerminalOutput('\x1b[36m~/project\x1b[0m $ ');
      handshakeResolved.current = true;
    }

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [activeTab, projectId, isCloudProject]);

  // For browser projects, set local mode immediately
  React.useEffect(() => {
    if (activeTab === 'terminal' && !isCloudProject) {
      setTerminalConnectionState('local');
      if (terminalOutput.length === 0) {
        addTerminalOutput('\x1b[33m[Browser Mode] Using WebContainer terminal\x1b[0m\r\n');
        addTerminalOutput('\x1b[90mType "help" for available commands\x1b[0m\r\n\r\n');
        addTerminalOutput('\x1b[36m~/project\x1b[0m $ ');
      }
    }
  }, [activeTab, isCloudProject]);

  React.useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  // Handle offline/browser commands
  const handleOfflineCommand = (command: string) => {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    switch (cmd) {
      case '':
        break;
      case 'help':
        addTerminalOutput('\x1b[1mAvailable commands (local mode):\x1b[0m\r\n');
        addTerminalOutput('  \x1b[36mls\x1b[0m       List directory contents\r\n');
        addTerminalOutput('  \x1b[36mcd\x1b[0m       Change directory\r\n');
        addTerminalOutput('  \x1b[36mpwd\x1b[0m      Print working directory\r\n');
        addTerminalOutput('  \x1b[36mcat\x1b[0m      Display file contents\r\n');
        addTerminalOutput('  \x1b[36mecho\x1b[0m     Print text\r\n');
        addTerminalOutput('  \x1b[36mclear\x1b[0m    Clear terminal\r\n');
        addTerminalOutput('  \x1b[36mhelp\x1b[0m     Show this help\r\n');
        break;
      case 'clear':
        clearTerminal();
        return;
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
        const files = getAllFiles(fileTree);
        if (files.length > 0) {
          const output = files.map(f =>
            f.type === 'directory' ? `\x1b[34m${f.name}/\x1b[0m` : f.name
          ).join('  ');
          addTerminalOutput(`${output}\r\n`);
        } else {
          addTerminalOutput('\x1b[34msrc/\x1b[0m  package.json  vite.config.ts\r\n');
        }
        break;
      }
      case 'cd': {
        const target = args[0] || '/';
        if (target === '~' || target === '/') {
          setCurrentDir('/');
        } else if (target === '..') {
          const p = currentDir.split('/').filter(Boolean);
          p.pop();
          setCurrentDir('/' + p.join('/'));
        } else {
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

    const promptPath = currentDir === '/' ? '~' : currentDir;
    addTerminalOutput(`\x1b[36m${promptPath}\x1b[0m $ `);
  };

  const handleTerminalInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const command = inputValue;
      setInputValue('');
      const promptPath = currentDir === '/' ? '~' : currentDir;
      addTerminalOutput(`\x1b[36m${promptPath}\x1b[0m $ ${command}\r\n`);

      if (wsRef.current?.readyState === WebSocket.OPEN && handshakeResolved.current) {
        wsRef.current.send(command + '\n');
      } else {
        handleOfflineCommand(command);
      }
      ideEventBus.emit('terminal:command', { command });
    }
  };

  const renderTerminalOutput = (output: string[]) => {
    // Normalize \r\n and handle line splitting correctly
    const joined = output.join('');
    const normalized = joined.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return normalized.split('\n').filter((_, idx, arr) => idx < arr.length - 1 || arr[arr.length - 1] !== '').map((line, idx) => (
      <div key={idx} style={{ lineHeight: '1.5', minHeight: '1.5em', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
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
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'terminal' && (
            <ConnectionStatus state={terminalConnectionState} />
          )}
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
