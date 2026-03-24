/**
 * Preview Generators
 *
 * Generate HTML preview content from various file types.
 * Used by the PreviewPanel to render file content in an iframe.
 */

export function generateMarkdownPreview(content: string): string {
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

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #cdd6f4; padding: 24px; line-height: 1.6; max-width: 800px; margin: 0 auto; }
    pre { background: #2d2d2d; border-radius: 8px; padding: 16px; overflow-x: auto; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 14px; }
    a { color: #61afef; }
  </style>
</head>
<body>${html}</body>
</html>`;
}

export function generateCSSPreview(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>${content}</style>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #cdd6f4; padding: 24px; }
    .demo-box { background: #2d2d2d; border-radius: 8px; padding: 24px; margin: 16px 0; }
    .demo-element { padding: 16px; margin: 8px; background: #3d3d5c; border-radius: 6px; }
  </style>
</head>
<body>
  <h2 style="color:#e06c75;margin-bottom:16px;">CSS Preview</h2>
  <div class="demo-box">
    <p>This preview shows how your CSS affects elements:</p>
    <div class="demo-element">Demo Element 1</div>
    <div class="demo-element">Demo Element 2</div>
    <div class="demo-element">Demo Element 3</div>
    <button style="margin-top:12px;padding:8px 16px;background:#61afef;color:#1a1a2e;border:none;border-radius:4px;cursor:pointer;">Button</button>
  </div>
</body>
</html>`;
}

export function generateJSONPreview(content: string): string {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    formatted = content;
  }

  const highlighted = formatted
    .replace(/"([^"]+)":/g, '<span style="color:#e06c75;">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span style="color:#98c379;">"$1"</span>')
    .replace(/: (\d+)/g, ': <span style="color:#d19a66;">$1</span>')
    .replace(/: (true|false)/g, ': <span style="color:#56b6c2;">$1</span>')
    .replace(/: (null)/g, ': <span style="color:#56b6c2;">$1</span>');

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'JetBrains Mono', monospace; background: #1a1a2e; color: #cdd6f4; padding: 24px; line-height: 1.6; font-size: 13px; }
    pre { margin: 0; white-space: pre-wrap; }
  </style>
</head>
<body><pre>${highlighted}</pre></body>
</html>`;
}

export function generateJSPreview(content: string, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const isTS = ext === 'ts' || ext === 'tsx';

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #cdd6f4; padding: 24px; }
    .info-box { background: #2d2d2d; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .code-preview { background: #1e1e2e; border-radius: 8px; padding: 16px; overflow: auto; max-height: 400px; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    h3 { color: #61afef; margin: 0 0 12px; }
    .tag { display: inline-block; background: #3d3d5c; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-right: 8px; }
  </style>
</head>
<body>
  <div class="info-box">
    ${isTS ? '<span class="tag">TypeScript</span>' : '<span class="tag">JavaScript</span>'}
    <span class="tag">${filePath.split('/').pop()}</span>
    <h3>JavaScript/TypeScript Preview</h3>
    <p style="color:#a0a0a0;font-size:13px;margin:8px 0;">This is a code file. In a full IDE, this would need a build step to run in the browser.</p>
  </div>
  <div class="code-preview">
    <pre><code>${escapeHtml(content)}</code></pre>
  </div>
</body>
</html>`;
}

export function generateCodePreview(content: string, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'JetBrains Mono', monospace; background: #1a1a2e; color: #cdd6f4; padding: 24px; line-height: 1.6; font-size: 13px; }
    .header { color: #e06c75; margin-bottom: 16px; font-size: 14px; border-bottom: 1px solid #3d3d5c; padding-bottom: 12px; }
    pre { margin: 0; white-space: pre-wrap; word-wrap: break-word; }
  </style>
</head>
<body>
  <div class="header">${filePath}</div>
  <pre>${escapeHtml(content)}</pre>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
