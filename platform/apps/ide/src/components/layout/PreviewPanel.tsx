/**
 * PreviewPanel - WebContainer-backed live preview
 */

import * as React from 'react';
import { Eye, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';

import { useIDEStore } from '@/stores/ideStore';
import { restartPreviewServer, startPreviewServer } from '@/core/runtime/webcontainerManager';
import { useRuntimeLogStore } from '@/state/runtimeLogStore';

const colors = {
  bgMain: '#0e0e11',
  bgPanel: '#18181b',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  accentColor: '#3b82f6',
  warningColor: '#f59e0b',
  errorColor: '#ef4444',
};

const STATUS_LABELS = {
  idle: 'Idle',
  booting: 'Booting WebContainer',
  mounted: 'Mounted',
  'shell-ready': 'Shell Ready',
  installing: 'Installing',
  running: 'Running',
  unsupported: 'Unsupported',
  error: 'Error',
} as const;

export function PreviewPanel() {
  const {
    projectId,
    previewUrl,
    previewIsLoading,
    runtimeStatus,
    runtimeMessage,
    setPreviewLoading,
  } = useIDEStore();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const append = useRuntimeLogStore((s) => s.append);
  const clear = useRuntimeLogStore((s) => s.clear);
  const log = useRuntimeLogStore((s) => s.log);

  const bootPreview = React.useCallback(async (forceRestart = false) => {
    if (!projectId) return;

    setPreviewLoading(true);
    if (forceRestart) {
      clear();
    }

    try {
      if (forceRestart) {
        await restartPreviewServer(projectId, append);
      } else {
        await startPreviewServer(projectId, append);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start preview.';
      append(`\n${message}\n`);
    } finally {
      setPreviewLoading(false);
    }
  }, [append, clear, projectId, setPreviewLoading]);

  React.useEffect(() => {
    bootPreview().catch((error) => {
      console.error('Preview boot failed:', error);
    });
  }, [bootPreview]);

  const handleRestart = () => {
    bootPreview(true).catch((error) => {
      console.error('Preview restart failed:', error);
    });
  };

  const handleOpenExternal = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const isUnavailable = runtimeStatus === 'unsupported' || runtimeStatus === 'error';
  const showLogs = Boolean(log.trim()) && (previewIsLoading || isUnavailable || runtimeStatus === 'mounted');

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        flex: 1,
        backgroundColor: colors.bgMain,
        borderLeft: `1px solid ${colors.borderColor}`,
      }}
    >
      <div
        className="flex items-center gap-2 flex-shrink-0"
        style={{
          height: '44px',
          padding: '0 12px',
          backgroundColor: colors.bgPanel,
          borderBottom: `1px solid ${colors.borderColor}`,
        }}
      >
        <Eye className="h-4 w-4" style={{ color: colors.textMuted }} />
        <span style={{ fontSize: '12px', color: colors.textSecondary }}>
          Preview - {STATUS_LABELS[runtimeStatus]}
        </span>
        <div style={{ flex: 1 }} />
        {previewUrl && (
          <input
            value={previewUrl}
            readOnly
            style={{
              flex: 1,
              maxWidth: '320px',
              backgroundColor: colors.bgMain,
              border: `1px solid ${colors.borderColor}`,
              borderRadius: '6px',
              padding: '4px 10px',
              color: colors.textPrimary,
              fontSize: '12px',
              outline: 'none',
            }}
          />
        )}
        {previewUrl && (
          <button
            onClick={handleOpenExternal}
            className="flex items-center gap-1 rounded-md"
            style={{
              padding: '6px 10px',
              backgroundColor: 'transparent',
              border: `1px solid ${colors.borderColor}`,
              color: colors.textSecondary,
              cursor: 'pointer',
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </button>
        )}
        <button
          onClick={handleRestart}
          className="flex items-center gap-1 rounded-md"
          style={{
            padding: '6px 10px',
            backgroundColor: 'transparent',
            border: `1px solid ${colors.borderColor}`,
            color: colors.textSecondary,
            cursor: 'pointer',
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Restart
        </button>
      </div>

      <div className="flex-1 overflow-hidden" style={{ backgroundColor: colors.bgMain }}>
        {previewUrl && runtimeStatus === 'running' ? (
          <iframe
            ref={iframeRef}
            key={previewUrl}
            src={previewUrl}
            title="Preview"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              backgroundColor: '#fff',
            }}
            sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
          />
        ) : (
          <div
            className="flex h-full flex-col items-center justify-center"
            style={{ color: colors.textMuted, padding: '24px' }}
          >
            <AlertCircle
              className="h-8 w-8 mb-3"
              style={{ color: isUnavailable ? colors.errorColor : colors.warningColor }}
            />
            <div style={{ fontSize: '14px', color: colors.textPrimary, marginBottom: '8px' }}>
              {previewIsLoading ? 'Starting preview runtime...' : STATUS_LABELS[runtimeStatus]}
            </div>
            <div style={{ fontSize: '12px', maxWidth: '640px', textAlign: 'center', color: colors.textMuted }}>
              {runtimeMessage || 'Preview will appear here when the WebContainer dev server is ready.'}
            </div>
            {showLogs && (
              <pre
                style={{
                  marginTop: '16px',
                  width: '100%',
                  maxWidth: '760px',
                  maxHeight: '220px',
                  overflow: 'auto',
                  padding: '12px',
                  borderRadius: '8px',
                  border: `1px solid ${colors.borderColor}`,
                  backgroundColor: colors.bgPanel,
                  color: colors.textSecondary,
                  fontSize: '12px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {log}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
