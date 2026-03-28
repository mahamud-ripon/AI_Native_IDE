/**
 * TerminalPanel - Unified terminal with tabs (Bolt, Publish, Terminal)
 * Uses xterm.js + WebContainer (bolt.new approach)
 * 
 * bolt.new approach: WebContainer is the execution environment for ALL projects
 * Files are stored in PostgreSQL (via cloud backend), but execution happens
 * in the browser via WebContainer. This provides consistent behavior
 * regardless of where files are stored.
 */

import * as React from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import {
  Zap,
  Rocket,
  Terminal as TerminalIcon,
} from 'lucide-react';
import {
  useIDEStore,
  ideEventBus,
  type TerminalConnectionState,
} from '@/stores/ideStore';
import { ensureContainer, spawnShell, killShell } from '@/core/runtime/webcontainerManager';
import { fileWatcher } from '@/core/runtime/fileWatcher';
import { fileSystemDB as fs } from '@/storage';
import 'xterm/css/xterm.css';

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

// ANSI Text Renderer (for other parts of the app)
export function AnsiText({ text }: { text: string }) {
  return <span>{text}</span>;
}

interface TerminalPanelProps {
  projectId: string;
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  projectType: 'browser' | 'cloud';
}

// Connection status indicator
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

export function TerminalPanel({ projectId, activeTab, onTabChange, projectType }: TerminalPanelProps) {
  const { terminalConnectionState, setTerminalConnectionState } = useIDEStore();
  
  const terminalRef = React.useRef<HTMLDivElement>(null);
  const termInstanceRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const shellWriterRef = React.useRef<WritableStreamDefaultWriter<string> | null>(null);
  const shellReaderRef = React.useRef<ReadableStreamDefaultReader<string> | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const handshakeResolved = React.useRef(false);

  // bolt.new approach: Always use WebContainer as execution environment
  // regardless of project type. WebSocket PTY is the fallback.
  const isCloudProject = false; // Disable WebSocket PTY - always use WebContainer
  const isBrowserProject = true; // Always true - WebContainer is the execution env

  const tabs: { id: BottomPanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'bolt', label: 'Bolt', icon: <Zap className="h-3.5 w-3.5" /> },
    { id: 'publish', label: 'Publish Output', icon: <Rocket className="h-3.5 w-3.5" /> },
    { id: 'terminal', label: 'Terminal', icon: <TerminalIcon className="h-3.5 w-3.5" /> },
  ];

  // Initialize xterm.js
  React.useEffect(() => {
    if (!terminalRef.current || termInstanceRef.current) return;
    if (activeTab !== 'terminal') return;

    // Wrap initialization in try-catch to handle xterm.js race conditions
    let cleanup = () => {};
    
    try {
      const term = new Terminal({
        theme: {
          background: colors.bgMain,
          foreground: colors.textSecondary,
          cursor: colors.accentColor,
          selectionBackground: 'rgba(59, 130, 246, 0.3)',
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 5000,
        cursorBlink: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // Delay terminal opening to avoid race conditions with viewport initialization
      const initTimeout = setTimeout(() => {
        try {
          if (terminalRef.current && terminalRef.current.isConnected) {
            term.open(terminalRef.current);
            
            // Fit after render cycle completes
            requestAnimationFrame(() => {
              try {
                if (fitAddonRef.current && terminalRef.current?.isConnected) {
                  fitAddonRef.current.fit();
                }
              } catch (fitErr) {
                console.warn('Initial fit failed:', fitErr);
              }
            });
            
            termInstanceRef.current = term;
            fitAddonRef.current = fitAddon;
          }
        } catch (openErr) {
          console.error('Terminal open failed:', openErr);
        }
      }, 50);

      const resizeHandler = () => {
        if (fitAddonRef.current && terminalRef.current?.isConnected) {
          try {
            fitAddonRef.current.fit();
          } catch (e) {
            // Ignore fit errors on resize
          }
        }
      };

      window.addEventListener('resize', resizeHandler);

      cleanup = () => {
        clearTimeout(initTimeout);
        window.removeEventListener('resize', resizeHandler);
        if (termInstanceRef.current) {
          termInstanceRef.current.dispose();
          termInstanceRef.current = null;
        }
        fitAddonRef.current = null;
      };
    } catch (e) {
      console.error('Failed to initialize terminal:', e);
    }

    return cleanup;
  }, [activeTab]);

  // Browser projects: Connect to WebContainer
  React.useEffect(() => {
    if (!isBrowserProject || activeTab !== 'terminal') return;
    if (!termInstanceRef.current) return;

    const term = termInstanceRef.current;
    
    // Ensure terminal is ready before writing
    if (!term.element || !term.element.isConnected) {
      console.warn('Terminal not ready for WebContainer');
      return;
    }

    setTerminalConnectionState('connecting');
    
    term.writeln('\x1b[1;36m▶ Booting WebContainer...\x1b[0m');

    let cancelled = false;

    const startShell = async () => {
      try {
        // Check if WebContainer is supported
        if (!window.crossOriginIsolated) {
          term.writeln('');
          term.writeln('\x1b[1;33m⚠ Cross-origin isolation not enabled\x1b[0m');
          term.writeln('');
          term.writeln('\x1b[90mWebContainer requires Cross-Origin-Opener-Policy and\x1b[0m');
          term.writeln('\x1b[90mCross-Origin-Embedder-Policy headers.\x1b[0m');
          term.writeln('');
          term.writeln('\x1b[90mTo fix this:\x1b[0m');
          term.writeln('\x1b[90m1. Restart the Vite dev server\x1b[0m');
          term.writeln('\x1b[90m2. Clear browser cache (Ctrl+Shift+Delete)\x1b[0m');
          term.writeln('\x1b[90m3. Reload the page\x1b[0m');
          term.writeln('');
          term.writeln('\x1b[90mWebContainer terminal is unavailable.\x1b[0m');
          term.writeln('\x1b[90mFiles will be saved to PostgreSQL.\x1b[0m');
          term.writeln('');
          
          // Show prompt even when offline
          term.write('\x1b[36m~/project\x1b[0m $ ');
          setTerminalConnectionState('offline');
          return;
        }
        
        await ensureContainer();
        
        if (cancelled || !termInstanceRef.current) return;
        
        setTerminalConnectionState('local');
        term.writeln('\x1b[1;32m✓ WebContainer ready\x1b[0m');
        term.writeln('');

        const shell = await spawnShell();

        if (cancelled) {
          killShell();
          return;
        }

        const writer = shell.input.getWriter();
        const reader = shell.output.getReader();

        shellWriterRef.current = writer;
        shellReaderRef.current = reader;

        // Connect terminal input to shell
        term.onData((data) => {
          if (writer && !cancelled) {
            writer.write(data);
          }
        });

        // Pump shell output to terminal
        const pumpOutput = async () => {
          while (!cancelled && termInstanceRef.current) {
            try {
              const { value, done } = await reader.read();
              if (done) break;
              if (value && termInstanceRef.current) {
                termInstanceRef.current.write(value);
              }
            } catch (e) {
              if (!cancelled) {
                console.error('WebContainer shell error:', e);
              }
              break;
            }
          }
        };

        pumpOutput();
        
        // Start watching for file changes in WebContainer and sync to IndexedDB
        if (!cancelled) {
          try {
            const container = await ensureContainer();
            if (!cancelled) {
              await fileWatcher.init(container);
              
              fileWatcher.subscribe(async (event) => {
                if (event.type === 'create' || event.type === 'update') {
                  try {
                    const wc = await ensureContainer();
                    const content = await wc.fs.readFile(event.path, 'utf8');
                    const contentStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
                    
                    // Sync to IndexedDB
                    await fs.writeFile(projectId, event.path, contentStr);
                    
                    // Notify UI
                    ideEventBus.emit('file:changed', { path: event.path, content: contentStr });
                  } catch (e) {
                    console.warn('Failed to sync file to IndexedDB:', e);
                  }
                } else if (event.type === 'delete') {
                  try {
                    await fs.deleteFile(projectId, event.path);
                    ideEventBus.emit('file:changed', { path: event.path, content: '' });
                  } catch (e) {
                    console.warn('Failed to delete file from IndexedDB:', e);
                  }
                }
              });
            }
          } catch (watcherError) {
            console.warn('Failed to init file watcher:', watcherError);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setTerminalConnectionState('offline');
          term.writeln(`\x1b[1;31mFailed to start WebContainer: ${e instanceof Error ? e.message : 'Unknown error'}\x1b[0m`);
        }
      }
    };

    startShell();

    return () => {
      cancelled = true;
      
      // Cleanup shell process
      if (shellWriterRef.current) {
        try {
          shellWriterRef.current.close();
        } catch (e) {
          // Ignore close errors
        }
        shellWriterRef.current = null;
      }
      
      if (shellReaderRef.current) {
        try {
          shellReaderRef.current.cancel();
        } catch (e) {
          // Ignore cancel errors
        }
        shellReaderRef.current = null;
      }
      
      // Cleanup file watcher
      try {
        fileWatcher.destroy();
      } catch (e) {
        // Ignore watcher cleanup errors
      }
      
      killShell();
    };
  }, [isBrowserProject, activeTab]);

  // Cloud projects: Connect to WebSocket PTY
  React.useEffect(() => {
    if (!isCloudProject || activeTab !== 'terminal') return;
    if (!termInstanceRef.current) return;

    const term = termInstanceRef.current;
    
    // Ensure terminal is ready before connecting
    if (!term.element || !term.element.isConnected) {
      console.warn('Terminal not ready for WebSocket connection');
      return;
    }

    handshakeResolved.current = false;
    setTerminalConnectionState('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `/ws/exec`;
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');

    const ws = new WebSocket(`${protocol}//${window.location.host}${wsUrl}?session_id=${projectId}${token ? `&token=${token}` : ''}`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Wait for ready-ack from backend
    };

    ws.onmessage = (event) => {
      if (!handshakeResolved.current) {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ready') {
            handshakeResolved.current = true;
            setTerminalConnectionState('connected');
            return;
          }
        } catch {
          // Not JSON, treat as regular output
          handshakeResolved.current = true;
          setTerminalConnectionState('connected');
        }
      }
      if (termInstanceRef.current) {
        termInstanceRef.current.write(event.data);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setTerminalConnectionState('offline');
      if (termInstanceRef.current) {
        termInstanceRef.current.writeln('\r\n\x1b[33m[Disconnected from backend]\x1b[0m');
      }
    };

    ws.onerror = () => {
      wsRef.current = null;
      setTerminalConnectionState('offline');
      handshakeResolved.current = true;
    };

    // Connect terminal input to WebSocket
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [isCloudProject, activeTab, projectId]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (shellWriterRef.current) {
        shellWriterRef.current.close();
      }
      if (shellReaderRef.current) {
        shellReaderRef.current.cancel();
      }
      killShell();
      wsRef.current?.close();
    };
  }, []);

  return (
    <div
      className="flex flex-col flex-shrink-0"
      style={{
        height: '200px',
        borderTop: `1px solid ${colors.borderColor}`,
        backgroundColor: colors.bgMain,
      }}
    >
      {/* Tab Header */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: '44px',
          padding: '0 16px',
          borderBottom: `1px solid ${colors.borderColor}`,
          backgroundColor: colors.bgMain,
        }}
      >
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
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

        {activeTab === 'terminal' && (
          <ConnectionStatus state={terminalConnectionState} />
        )}
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-hidden" style={{ backgroundColor: colors.bgMain }}>
        {activeTab === 'bolt' && (
          <div style={{ padding: '12px 16px', color: colors.accentColor, fontWeight: 500 }}>
            ★ Bolt AI ready
            <div style={{ color: colors.textMuted, opacity: 0.6, marginTop: '4px' }}>
              Waiting for instructions...
            </div>
          </div>
        )}
        {activeTab === 'publish' && (
          <div style={{ padding: '12px 16px', color: colors.textMuted, opacity: 0.6 }}>
            Build and deployment output will appear here
          </div>
        )}
        {activeTab === 'terminal' && (
          <div
            ref={terminalRef}
            tabIndex={0}
            onClick={() => {
              if (termInstanceRef.current) {
                termInstanceRef.current.focus();
              }
            }}
            style={{
              width: '100%',
              height: '100%',
              padding: '8px',
              cursor: 'text',
              outline: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}

export default TerminalPanel;
