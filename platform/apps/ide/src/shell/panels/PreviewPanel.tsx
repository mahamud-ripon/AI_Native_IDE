import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { ensureContainer, mountDemoProject, ensureDependenciesInstalled, startDevServer } from '../../core/runtime/webcontainerManager';
import type { WebContainer } from '@webcontainer/api';
import { useRuntimeLogStore } from '../../state/runtimeLogStore';
import styles from './Panel.module.css';

export function PreviewPanel() {
  const { projectId } = useParams();
  const [status, setStatus] = useState<'idle' | 'booting' | 'installing' | 'running' | 'error'>('idle');
  const [url, setUrl] = useState<string>('');
  const logTail = useRuntimeLogStore((s) => s.log);
  const append = useRuntimeLogStore((s) => s.append);
  const clear = useRuntimeLogStore((s) => s.clear);
  const subscribedRef = useRef(false);

  const appendLog = useCallback((chunk: string) => {
    append(chunk);
  }, [append]);

  useEffect(() => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    const subscribe = async () => {
      try {
        const wc: WebContainer = await ensureContainer();
        wc.on('server-ready', (_port: number, serverUrl: string) => {
          setUrl(serverUrl);
          setStatus('running');
        });
      } catch {
        setStatus('error');
      }
    };
    subscribe();
  }, []);

  const start = useCallback(async () => {
    try {
      clear();
      setStatus('booting');
      await ensureContainer();

      setStatus('installing');
      const pid = projectId ?? 'demo';
      await mountDemoProject(pid);
      await ensureDependenciesInstalled(appendLog);

      setStatus('running');
      await startDevServer(appendLog);
    } catch (e) {
      appendLog(`\n${e instanceof Error ? e.message : 'Unknown error'}\n`);
      setStatus('error');
    }
  }, [appendLog, clear, projectId]);

  const headerRight = useMemo(() => {
    if (status === 'running') return 'Running';
    if (status === 'installing') return 'Installing…';
    if (status === 'booting') return 'Booting…';
    if (status === 'error') return 'Error';
    return 'Idle';
  }, [status]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader} style={{ justifyContent: 'space-between' }}>
        <span>Preview</span>
        <span>{headerRight}</span>
      </div>
      <div className={styles.panelBody} style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={start}
            disabled={status === 'booting' || status === 'installing'}
            style={{
              background: 'transparent',
              color: 'inherit',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 8,
              padding: '6px 10px',
              cursor: 'pointer'
            }}
          >
            Start Runtime
          </button>
          <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
            WebContainers (demo project) — local-only Phase 3
          </span>
        </div>

        {url ? (
          <iframe
            title="preview"
            src={url}
            style={{ width: '100%', height: '100%', border: 0, borderRadius: 10 }}
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          />
        ) : (
          <pre
            style={{
              margin: 0,
              height: '100%',
              overflow: 'auto',
              padding: 10,
              border: '1px dashed rgba(255,255,255,0.18)',
              borderRadius: 10,
              color: 'rgba(255,255,255,0.65)'
            }}
          >
            {logTail || 'Click “Start Runtime” to boot WebContainers, install deps, and start a dev server.'}
          </pre>
        )}
      </div>
    </div>
  );
}
