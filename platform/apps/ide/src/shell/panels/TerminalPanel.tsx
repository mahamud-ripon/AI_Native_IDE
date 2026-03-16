import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import { ensureContainer, spawnShell, killShell } from '../../core/runtime/webcontainerManager';
import styles from './Panel.module.css';

export function TerminalPanel() {
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
    term.open(terminalRef.current);
    
    // Use requestAnimationFrame to ensure DOM is fully rendered before fitting
    requestAnimationFrame(() => {
      if (terminalRef.current && fitAddon) {
        try {
          fitAddon.fit();
        } catch (e) {
          console.warn('Terminal fit failed:', e);
        }
      }
    });

    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);

    term.writeln('\x1b[1;36m▶ Terminal ready\x1b[0m');
    term.writeln('Starting interactive shell...');
    term.writeln('');

    return () => {
      window.removeEventListener('resize', handleResize);
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
      <div className={styles.panelHeader}>Terminal</div>
      <div className={styles.panelBody} style={{ padding: 0, minHeight: '200px' }}>
        <div
          ref={terminalRef}
          style={{ width: '100%', height: '100%', minHeight: '200px' }}
        />
      </div>
    </div>
  );
}
