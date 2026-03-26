/**
 * WebContainerTerminal - Browser-based terminal using xterm.js + WebContainer
 * Used for browser-tier projects that don't require Firecracker VMs
 */

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import { ensureContainer, spawnShell, killShell } from '../../core/runtime/webcontainerManager';
import styles from './Panel.module.css';

interface WebContainerTerminalProps {
  onConnectionStateChange?: (state: 'connecting' | 'connected' | 'local' | 'offline') => void;
}

export function WebContainerTerminal({ onConnectionStateChange }: WebContainerTerminalProps = {}) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const shellWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const shellReaderRef = useRef<ReadableStreamDefaultReader<string> | null>(null);

  useEffect(() => {
    if (!terminalRef.current || termInstanceRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(88, 166, 255, 0.3)'
      },
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      cursorBlink: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    let resizeHandler: (() => void) | null = null;
    let isTerminated = false;

    const openTerminal = () => {
      if (!terminalRef.current || !terminalRef.current.isConnected || isTerminated) {
        console.warn('[WebContainerTerminal] Container no longer available, skipping terminal open');
        return;
      }
      
      try {
        term.open(terminalRef.current);
        
        requestAnimationFrame(() => {
          if (terminalRef.current && fitAddon && !isTerminated) {
            try {
              fitAddon.fit();
            } catch (e) {
              console.warn('Terminal fit failed:', e);
            }
          }
        });
      } catch (e) {
        console.error('[WebContainerTerminal] Failed to open terminal:', e);
        return;
      }

      termInstanceRef.current = term;
      fitAddonRef.current = fitAddon;

      resizeHandler = () => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
      };

      window.addEventListener('resize', resizeHandler);

      term.writeln('\x1b[1;36m▶ Terminal ready (Local Mode)\x1b[0m');
      term.writeln('Starting interactive shell...');
      term.writeln('');
    };

    setTimeout(openTerminal, 0);

    return () => {
      isTerminated = true;
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
      }
      term.dispose();
      termInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termInstanceRef.current;
    if (!term) return;

    let cancelled = false;

    const startShell = async () => {
      try {
        onConnectionStateChange?.('connecting');
        term.writeln('\x1b[1;36m▶ Booting WebContainer...\x1b[0m');
        await ensureContainer();
        term.writeln('\x1b[1;32m✓ WebContainer ready\x1b[0m');
        
        const shell = await spawnShell();

        if (cancelled) {
          killShell();
          return;
        }

        const writer = shell.input.getWriter();
        const reader = shell.output.getReader();

        shellWriterRef.current = writer;
        shellReaderRef.current = reader;

        onConnectionStateChange?.('local');

        term.onData((data) => {
          writer.write(data);
        });

        const pumpOutput = async () => {
          while (!cancelled) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) term.write(value);
          }
        };

        pumpOutput();
      } catch (e) {
        if (!cancelled) {
          onConnectionStateChange?.('offline');
          term.writeln(`\x1b[1;31mFailed to start shell: ${e instanceof Error ? e.message : 'Unknown error'}\x1b[0m`);
        }
      }
    };

    startShell();

    return () => {
      cancelled = true;
      if (shellWriterRef.current) {
        shellWriterRef.current.close();
        shellWriterRef.current = null;
      }
      if (shellReaderRef.current) {
        shellReaderRef.current.cancel();
        shellReaderRef.current = null;
      }
      killShell();
    };
  }, []);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>Terminal (Local Mode)</div>
      <div className={styles.panelBody} style={{ padding: 0, minHeight: '200px' }}>
        <div
          ref={terminalRef}
          style={{ width: '100%', height: '100%', minHeight: '200px' }}
        />
      </div>
    </div>
  );
}
