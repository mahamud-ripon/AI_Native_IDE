/**
 * TerminalPanel - Unified bottom panel with Bolt / Publish / Terminal tabs
 * Browser-first runtime powered by WebContainer + xterm.js.
 */

import * as React from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Zap, Rocket, Terminal as TerminalIcon } from 'lucide-react';
import type { IDisposable } from 'xterm';

import {
  useIDEStore,
  ideEventBus,
  type TerminalConnectionState,
} from '@/stores/ideStore';
import {
  ensureProjectMounted,
  spawnTerminalShell,
  killShell,
} from '@/core/runtime/webcontainerManager';
import { fileWatcher } from '@/core/runtime/fileWatcher';
import { fileSystemDB as fs } from '@/storage';
import { fileSystemClient } from '@/api/fileSystemClient';
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

export function AnsiText({ text }: { text: string }) {
  return <span>{text}</span>;
}

interface TerminalPanelProps {
  projectId: string;
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
}

function ConnectionStatus({ state }: { state: TerminalConnectionState }) {
  const config: Record<TerminalConnectionState, { color: string; label: string }> = {
    offline: { color: colors.textMuted, label: 'Offline' },
    connecting: { color: colors.warningColor, label: 'Connecting...' },
    connected: { color: colors.successColor, label: 'Connected' },
    local: { color: colors.successColor, label: 'WebContainer' },
  };

  const { color, label } = config[state];

  return (
    <div className="flex items-center gap-1" style={{ fontSize: '11px', color }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </div>
  );
}

function writeRuntimeError(term: Terminal, message: string): void {
  term.writeln('');
  term.writeln('\x1b[1;31mWebContainer terminal unavailable.\x1b[0m');
  term.writeln('');
  term.writeln(`\x1b[90m${message}\x1b[0m`);
  term.writeln('');
  term.writeln('\x1b[90mTry these checks:\x1b[0m');
  term.writeln('\x1b[90m1. Reload after restarting the IDE dev server.\x1b[0m');
  term.writeln('\x1b[90m2. Allow Service Workers and third-party storage/cookies for WebContainer domains.\x1b[0m');
  term.writeln('\x1b[90m3. Confirm COOP/COEP headers are present for this app.\x1b[0m');
}

export function TerminalPanel({ projectId, activeTab, onTabChange }: TerminalPanelProps) {
  const {
    terminalConnectionState,
    runtimeStatus,
    runtimeMessage,
    setTerminalConnectionState,
  } = useIDEStore();

  const terminalRef = React.useRef<HTMLDivElement>(null);
  const termInstanceRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const shellWriterRef = React.useRef<WritableStreamDefaultWriter<string> | null>(null);
  const shellReaderRef = React.useRef<ReadableStreamDefaultReader<string> | null>(null);
  const shellProcessRef = React.useRef<{ resize: (dimensions: { cols: number; rows: number }) => void } | null>(null);
  const onDataDisposableRef = React.useRef<IDisposable | null>(null);
  const fileWatcherUnsubscribeRef = React.useRef<(() => void) | null>(null);
  const [terminalReady, setTerminalReady] = React.useState(false);

  const tabs: { id: BottomPanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'bolt', label: 'Bolt', icon: <Zap className="h-3.5 w-3.5" /> },
    { id: 'publish', label: 'Publish Output', icon: <Rocket className="h-3.5 w-3.5" /> },
    { id: 'terminal', label: 'Terminal', icon: <TerminalIcon className="h-3.5 w-3.5" /> },
  ];

  React.useEffect(() => {
    if (activeTab !== 'terminal') {
      setTerminalReady(false);
      return;
    }
    if (!terminalRef.current || termInstanceRef.current) return;

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

    let disposed = false;
    const resizeTerminal = () => {
      if (!fitAddonRef.current || !termInstanceRef.current || !terminalRef.current?.isConnected) return;

      try {
        fitAddonRef.current.fit();
        shellProcessRef.current?.resize({
          cols: termInstanceRef.current.cols,
          rows: termInstanceRef.current.rows,
        });
      } catch (error) {
        console.warn('Terminal resize failed:', error);
      }
    };

    requestAnimationFrame(() => {
      if (disposed || !terminalRef.current?.isConnected) return;

      term.open(terminalRef.current);
      termInstanceRef.current = term;
      fitAddonRef.current = fitAddon;
      setTerminalReady(true);

      requestAnimationFrame(resizeTerminal);
      term.focus();
    });

    window.addEventListener('resize', resizeTerminal);

    return () => {
      disposed = true;
      window.removeEventListener('resize', resizeTerminal);
      onDataDisposableRef.current?.dispose();
      onDataDisposableRef.current = null;
      term.dispose();
      termInstanceRef.current = null;
      fitAddonRef.current = null;
      shellProcessRef.current = null;
      setTerminalReady(false);
    };
  }, [activeTab]);

  React.useEffect(() => {
    if (activeTab !== 'terminal' || !terminalReady || !termInstanceRef.current) return;

    const term = termInstanceRef.current;
    let cancelled = false;

    setTerminalConnectionState('connecting');
    term.clear();
    term.writeln('\x1b[1;36mBooting WebContainer...\x1b[0m');

    const startShell = async () => {
      try {
        const container = await ensureProjectMounted(projectId);
        if (cancelled || !termInstanceRef.current) return;

        const shell = await spawnTerminalShell({
          cols: Math.max(term.cols, 1),
          rows: Math.max(term.rows, 1),
        });

        if (cancelled) {
          killShell();
          return;
        }

        shellProcessRef.current = shell.process;
        shellWriterRef.current = shell.input.getWriter();
        shellReaderRef.current = shell.output.getReader();

        onDataDisposableRef.current?.dispose();
        onDataDisposableRef.current = term.onData((data) => {
          shellWriterRef.current?.write(data).catch((error) => {
            console.error('Terminal input write failed:', error);
          });
        });

        setTerminalConnectionState('local');
        term.writeln('\x1b[1;32mWebContainer shell ready.\x1b[0m');
        term.writeln('');

        await fileWatcher.init(container);
        fileWatcherUnsubscribeRef.current?.();
        fileWatcherUnsubscribeRef.current = fileWatcher.subscribe(async (event) => {
          if (event.entryType === 'directory') {
            try {
              if (event.type === 'create') {
                await fs.createDirectory(projectId, event.path);
                await fileSystemClient.createDirectory(projectId, event.path);
                ideEventBus.emit('file:created', { path: event.path });
              } else if (event.type === 'delete') {
                await fs.deleteFile(projectId, event.path).catch(() => {
                  // Ignore if the local shadow stored the directory with a trailing slash.
                });
                await fs.deleteFile(projectId, `${event.path}/`).catch(() => {
                  // Ignore if the local shadow stored the directory without a trailing slash.
                });
                await fileSystemClient.deleteFile(projectId, event.path);
                ideEventBus.emit('file:deleted', { path: event.path });
              }

              ideEventBus.emit('tree:refresh', { path: event.path });
            } catch (error) {
              console.warn('Failed to sync directory from WebContainer:', error);
            }
            return;
          }

          if (event.type === 'create' || event.type === 'update') {
            try {
              const content = await container.fs.readFile(event.path, 'utf8');
              const contentStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
              await fs.writeFile(projectId, event.path, contentStr);
              await fileSystemClient.applyAiPatches(projectId, [{ path: event.path, content: contentStr }]);
              if (event.type === 'create') {
                ideEventBus.emit('file:created', { path: event.path });
              }
              ideEventBus.emit('file:changed', { path: event.path, content: contentStr });
              ideEventBus.emit('tree:refresh', { path: event.path });
            } catch (error) {
              console.warn('Failed to sync file from WebContainer:', error);
            }
          } else if (event.type === 'delete') {
            try {
              await fs.deleteFile(projectId, event.path);
              await fileSystemClient.deleteFile(projectId, event.path);
              ideEventBus.emit('file:deleted', { path: event.path });
              ideEventBus.emit('file:changed', { path: event.path, content: '' });
              ideEventBus.emit('tree:refresh', { path: event.path });
            } catch (error) {
              console.warn('Failed to delete synced file from IndexedDB:', error);
            }
          }
        });

        while (!cancelled && termInstanceRef.current && shellReaderRef.current) {
          const { value, done } = await shellReaderRef.current.read();
          if (done) break;
          if (value) {
            term.write(value);
          }
        }
      } catch (error) {
        if (cancelled) return;
        setTerminalConnectionState('offline');
        writeRuntimeError(
          term,
          error instanceof Error ? error.message : 'Unknown runtime error.',
        );
      }
    };

    startShell();

    return () => {
      cancelled = true;
      setTerminalConnectionState('offline');
      onDataDisposableRef.current?.dispose();
      onDataDisposableRef.current = null;
      fileWatcherUnsubscribeRef.current?.();
      fileWatcherUnsubscribeRef.current = null;
      fileWatcher.destroy();

      if (shellWriterRef.current) {
        shellWriterRef.current.close().catch(() => {
          // ignore
        });
        shellWriterRef.current = null;
      }

      if (shellReaderRef.current) {
        shellReaderRef.current.cancel().catch(() => {
          // ignore
        });
        shellReaderRef.current = null;
      }

      shellProcessRef.current = null;
      killShell();
    };
  }, [activeTab, projectId, terminalReady, setTerminalConnectionState]);

  React.useEffect(() => {
    return () => {
      onDataDisposableRef.current?.dispose();
      fileWatcherUnsubscribeRef.current?.();
      fileWatcher.destroy();
      killShell();
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
          <div className="flex items-center gap-3">
            {(runtimeStatus === 'unsupported' || runtimeStatus === 'error') && runtimeMessage && (
              <span style={{ fontSize: '11px', color: colors.textMuted, maxWidth: '460px' }} className="truncate">
                {runtimeMessage}
              </span>
            )}
            <ConnectionStatus state={terminalConnectionState} />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden" style={{ backgroundColor: colors.bgMain }}>
        {activeTab === 'bolt' && (
          <div style={{ padding: '12px 16px', color: colors.accentColor, fontWeight: 500 }}>
            Bolt AI ready
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
              termInstanceRef.current?.focus();
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
