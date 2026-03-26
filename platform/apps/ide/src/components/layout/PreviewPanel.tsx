/**
 * PreviewPanel - Live preview with file/url modes
 */

import * as React from 'react';
import { Eye, RefreshCw, ExternalLink, Lock } from 'lucide-react';
import { useIDEStore } from '@/stores/ideStore';

const colors = {
  bgMain: '#0e0e11',
  bgPanel: '#18181b',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  accentColor: '#3b82f6',
};

function generateMarkdownPreview(content: string): string {
  let html = content
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre style="background:#2d2d2d;padding:12px;border-radius:6px;overflow-x:auto;"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background:#2d2d2d;padding:2px 6px;border-radius:4px;">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#e06c75;margin:16px 0 8px;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#e06c75;margin:20px 0 10px;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="color:#e06c75;margin:24px 0 12px;">$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#61afef;">$1</a>')
    .replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#cdd6f4;padding:24px;line-height:1.6;max-width:800px;margin:0 auto}pre{background:#2d2d2d;border-radius:8px;padding:16px;overflow-x:auto}code{font-family:'JetBrains Mono',monospace;font-size:14px}a{color:#61afef}</style></head><body>${html}</body></html>`;
}

function generateCSSPreview(content: string): string {
  return `<!DOCTYPE html><html><head><style>${content}</style><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#cdd6f4;padding:24px}.demo-box{background:#2d2d2d;border-radius:8px;padding:24px;margin:16px 0}.demo-element{padding:16px;margin:8px;background:#3d3d5c;border-radius:6px}</style></head><body><h2 style="color:#e06c75;margin-bottom:16px">CSS Preview</h2><div class="demo-box"><p>This preview shows how your CSS affects elements:</p><div class="demo-element">Demo Element 1</div><div class="demo-element">Demo Element 2</div><div class="demo-element">Demo Element 3</div><button style="margin-top:12px;padding:8px 16px;background:#61afef;color:#1a1a2e;border:none;border-radius:4px;cursor:pointer">Button</button></div></body></html>`;
}

function generateJSONPreview(content: string): string {
  let formatted: string;
  try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { formatted = content; }
  const highlighted = formatted
    .replace(/"([^"]+)":/g, '<span style="color:#e06c75">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span style="color:#98c379">"$1"</span>')
    .replace(/: (\d+)/g, ': <span style="color:#d19a66">$1</span>')
    .replace(/: (true|false)/g, ': <span style="color:#56b6c2">$1</span>');
  return `<!DOCTYPE html><html><head><style>body{font-family:'JetBrains Mono',monospace;background:#1a1a2e;color:#cdd6f4;padding:24px;line-height:1.6;font-size:13px}pre{margin:0;white-space:pre-wrap}</style></head><body><pre>${highlighted}</pre></body></html>`;
}

function generateJSPreview(content: string, filePath: string): string {
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#cdd6f4;padding:24px}.info-box{background:#2d2d2d;border-radius:8px;padding:20px;margin-bottom:16px}.code-preview{background:#1e1e2e;border-radius:8px;padding:16px;overflow:auto;max-height:400px}code{font-family:'JetBrains Mono',monospace;font-size:12px}h3{color:#61afef;margin:0 0 12px}.tag{display:inline-block;background:#3d3d5c;padding:2px 8px;border-radius:4px;font-size:11px;margin-right:8px}</style></head><body><div class="info-box"><span class="tag">${filePath.split('/').pop()}</span><h3>Code Preview</h3><p style="color:#a0a0a0;font-size:13px;margin:8px 0">This file requires a build step to run in the browser.</p></div><div class="code-preview"><pre><code>${escaped}</code></pre></div></body></html>`;
}

function generateCodePreview(content: string, filePath: string): string {
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><head><style>body{font-family:'JetBrains Mono',monospace;background:#1a1a2e;color:#cdd6f4;padding:24px;line-height:1.6;font-size:13px}.header{color:#e06c75;margin-bottom:16px;font-size:14px;border-bottom:1px solid #3d3d5c;padding-bottom:12px}pre{margin:0;white-space:pre-wrap;word-wrap:break-word}</style></head><body><div class="header">${filePath}</div><pre>${escaped}</pre></body></html>`;
}

export function PreviewPanel() {
  const {
    previewUrl,
    previewIsLoading,
    setPreviewUrl,
    setPreviewLoading,
    openTabs,
    activeTabPath,
    fileContents,
  } = useIDEStore();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [inputUrl, setInputUrl] = React.useState(previewUrl);
  const [previewSource, setPreviewSource] = React.useState<string | null>(null);
  const [previewMode, setPreviewMode] = React.useState<'file' | 'url'>('file');

  const activeContent = activeTabPath ? fileContents.get(activeTabPath) : undefined;

  React.useEffect(() => {
    if (previewMode !== 'file' || !activeTabPath || !activeContent) {
      setPreviewSource(null);
      return;
    }

    const ext = activeTabPath.split('.').pop()?.toLowerCase();
    let src = '';

    if (ext === 'html' || ext === 'htm') {
      src = activeContent;
    } else if (ext === 'md' || ext === 'markdown') {
      src = generateMarkdownPreview(activeContent);
    } else if (ext === 'css') {
      src = generateCSSPreview(activeContent);
    } else if (ext === 'json') {
      src = generateJSONPreview(activeContent);
    } else if (ext === 'svg') {
      src = `<!DOCTYPE html><html><head><style>body{display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e}</style></head><body>${activeContent}</body></html>`;
    } else if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) {
      src = generateJSPreview(activeContent, activeTabPath);
    } else {
      src = generateCodePreview(activeContent, activeTabPath);
    }
    setPreviewSource(src);
  }, [activeContent, activeTabPath, previewMode]);

  const handleNavigate = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputUrl.trim()) {
      setPreviewUrl(inputUrl);
      setPreviewMode('url');
    }
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        flex: 1,
        backgroundColor: colors.bgMain,
        borderLeft: `1px solid ${colors.borderColor}`,
      }}
    >
      {/* Preview Header */}
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
        <span style={{ fontSize: '12px', color: colors.textSecondary }}>Preview</span>
        <div style={{ flex: 1 }} />
        <input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={handleNavigate}
          placeholder="Enter URL to preview..."
          style={{
            flex: 1,
            maxWidth: '300px',
            backgroundColor: colors.bgMain,
            border: `1px solid ${colors.borderColor}`,
            borderRadius: '6px',
            padding: '4px 10px',
            color: colors.textPrimary,
            fontSize: '12px',
            outline: 'none',
          }}
        />
      </div>

      {/* Preview Content */}
      <div className="flex-1 overflow-hidden">
        {previewMode === 'file' && previewSource ? (
          <iframe
            ref={iframeRef}
            srcDoc={previewSource}
            title="Preview"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              backgroundColor: '#1a1a2e',
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : previewMode === 'url' && previewUrl ? (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            title="Preview"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              backgroundColor: '#fff',
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div
            className="flex flex-col items-center justify-center h-full"
            style={{ color: colors.textMuted }}
          >
            <Eye className="h-8 w-8 mb-2" />
            <span style={{ fontSize: '13px' }}>Open a file to preview</span>
          </div>
        )}
      </div>
    </div>
  );
}
