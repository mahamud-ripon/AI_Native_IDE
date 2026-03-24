import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  ensureContainer,
  mountProject,
  ensureDependenciesInstalled,
  startDevServer,
} from '../../core/runtime/webcontainerManager';
import { useRuntimeLogStore } from '../../state/runtimeLogStore';
import styles from './Panel.module.css';

type RuntimeStatus = 'idle' | 'booting' | 'mounting' | 'installing' | 'starting' | 'running' | 'error';

const STATUS_LABELS: Record<RuntimeStatus, string> = {
  idle: 'Idle',
  booting: 'Booting WebContainer…',
  mounting: 'Mounting project files…',
  installing: 'Installing dependencies…',
  starting: 'Starting dev server…',
  running: 'Running',
  error: 'Error',
};

export function PreviewPanel() {
  const { projectId } = useParams<{ projectId: string }>();
  const [status, setStatus] = useState<RuntimeStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [iframeKey, setIframeKey] = useState(0); // Force iframe refresh

  const append = useRuntimeLogStore((s) => s.append);
  const clear = useRuntimeLogStore((s) => s.clear);
  const log = useRuntimeLogStore((s) => s.log);
  const bootedRef = useRef(false);

  // Register server-ready listener ONCE on mount before any boot attempt
  useEffect(() => {
    let cancelled = false;

    const registerListener = async () => {
      try {
        const wc = await ensureContainer();
        
        wc.on('server-ready', (_port: number, url: string) => {
          if (cancelled) return;
          console.log('[Preview] Server ready at:', url);
          setPreviewUrl(url);
          setStatus('running');
          setIframeKey(k => k + 1); // Force iframe to reload with new URL
        });
      } catch (err) {
        console.error('[Preview] Failed to register server-ready listener:', err);
      }
    };

    registerListener();
    return () => { cancelled = true; };
  }, []);

  // Auto-boot when projectId becomes available
  useEffect(() => {
    if (!projectId || bootedRef.current) return;
    boot();
  }, [projectId]);

  const boot = useCallback(async () => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    clear();
    const pid = projectId ?? 'demo';

    try {
      setStatus('booting');
      append('Booting WebContainer...\n');
      await ensureContainer();
      append('WebContainer ready.\n');

      setStatus('mounting');
      append(`Mounting project ${pid}...\n`);
      await mountProject(pid);
      append('Project files mounted.\n');

      setStatus('installing');
      append('Running npm install...\n');
      await ensureDependenciesInstalled(append);
      append('Dependencies installed.\n');

      setStatus('starting');
      append('Starting dev server...\n');
      await startDevServer(append);
      // Status transitions to 'running' via server-ready event handler above

    } catch (err) {
      bootedRef.current = false; // Allow retry
      const msg = err instanceof Error ? err.message : 'Unknown error';
      append(`\nError: ${msg}\n`);
      setStatus('error');
    }
  }, [projectId, append, clear]);

  const handleRestart = useCallback(() => {
    bootedRef.current = false;
    setPreviewUrl('');
    setStatus('idle');
    boot();
  }, [boot]);

  const handleOpenExternal = useCallback(() => {
    if (previewUrl) window.open(previewUrl, '_blank');
  }, [previewUrl]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Preview — {STATUS_LABELS[status]}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {previewUrl && (
            <button
              onClick={handleOpenExternal}
              title="Open in new tab"
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, color: 'inherit', padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
            >
              Open ↗
            </button>
          )}
          <button
            onClick={handleRestart}
            disabled={status === 'booting' || status === 'mounting' || status === 'installing' || status === 'starting'}
            title="Restart runtime"
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, color: 'inherit', padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            Restart
          </button>
        </div>
      </div>

      <div className={styles.panelBody} style={{ padding: 0, position: 'relative' }}>
        {previewUrl ? (
          <iframe
            key={iframeKey}
            title="Live Preview"
            src={previewUrl}
            style={{ width: '100%', height: '100%', border: 0 }}
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
          />
        ) : (
          <pre style={{
            margin: 0,
            padding: 12,
            height: '100%',
            overflow: 'auto',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: 'rgba(255,255,255,0.6)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {log || (status === 'idle' ? 'Runtime will start automatically when a project is loaded.' : 'Starting…')}
          </pre>
        )}

        {/* Loading overlay during boot */}
        {status !== 'idle' && status !== 'running' && status !== 'error' && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 12, pointerEvents: 'none',
          }}>
            <div style={{ width: 24, height: 24, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#58a6ff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{STATUS_LABELS[status]}</span>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
