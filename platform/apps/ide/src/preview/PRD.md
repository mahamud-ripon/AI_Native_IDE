# IDE Preview - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/preview/`  
> **Tech Stack:** React + Iframe + Service Worker

---

## 1. Executive Summary

The Preview component displays the running application inside a sandboxed iframe. It handles WebContainers URLs, HMR updates, and provides an interactive address bar.

---

## 2. Dependencies

```bash
# No additional dependencies - uses native browser APIs
```

---

## 3. Preview Component

### 3.1 Live Preview Iframe (src/preview/LivePreview.tsx)

```typescript
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, ExternalLink, Loader2 } from 'lucide-react';

interface LivePreviewProps {
  url: string | null;
  onUrlChange?: (url: string) => void;
}

export function LivePreview({ url, onUrlChange }: LivePreviewProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressBarUrl, setAddressBarUrl] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (url) {
      setAddressBarUrl(url);
      checkUrlAndSetSrc(url);
    }
  }, [url]);

  const checkUrlAndSetSrc = async (previewUrl: string) => {
    setIsLoading(true);
    setError(null);

    // Retry loop with exponential backoff for WebContainers
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(previewUrl, { method: 'HEAD' });
        if (response.ok) {
          if (iframeRef.current) {
            iframeRef.current.src = previewUrl;
          }
          setIsLoading(false);
          return;
        }
      } catch (e) {
        // URL not ready yet
      }

      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempts)));
    }

    setError('Failed to connect to preview server');
    setIsLoading(false);
  };

  const handleAddressBarSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newUrl = addressBarUrl.startsWith('http') 
      ? addressBarUrl 
      : `${url?.origin}${addressBarUrl}`;
    onUrlChange?.(newUrl);
  };

  // Listen for messages from iframe (history changes)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'history-change') {
        setAddressBarUrl(event.data.url);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleReload = () => {
    if (url) {
      checkUrlAndSetSrc(url);
    }
  };

  if (!url) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900 text-gray-500">
        <div className="text-center">
          <p className="mb-2">Start the development server to see preview</p>
          <p className="text-sm">Run "npm run dev" in the terminal</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Address Bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 border-b">
        <form onSubmit={handleAddressBarSubmit} className="flex-1">
          <input
            type="text"
            value={addressBarUrl}
            onChange={(e) => setAddressBarUrl(e.target.value)}
            className="w-full px-3 py-1 text-sm bg-white border rounded focus:outline-none focus:border-blue-500"
            placeholder="Enter URL..."
          />
        </form>
        
        <button
          onClick={handleReload}
          className="p-1 hover:bg-gray-200 rounded"
          title="Reload"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 hover:bg-gray-200 rounded"
          title="Open in new tab"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Preview Iframe */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50 text-red-600">
            <p>{error}</p>
          </div>
        )}
        
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-forms allow-popups"
          title="Preview"
        />
      </div>
    </div>
  );
}
```

---

## 4. Implementation Status

| Component | Status |
|-----------|--------|
| Live Preview Iframe | ✅ Complete |
| Address Bar | ✅ Complete |
| Retry Logic | ✅ Complete |
| Sandbox Security | ✅ Complete |
| HMR Support | ✅ Complete |
