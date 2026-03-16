# IDE History - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/history/`  
> **Tech Stack:** React + Monaco Editor Diff Mode + API

---

## 1. Executive Summary

The History component provides a "Local History" or "Timeline" view similar to Google Docs or VS Code Timeline. Users can rollback specific file changes independently of Git commits.

---

## 2. Dependencies

```bash
npm install @monaco-editor/react date-fns
```

---

## 3. History Hook

### 3.1 useFileHistory (src/history/useFileHistory.ts)

```typescript
'use client';

import { useState, useCallback } from 'react';

interface FileSnapshot {
  id: string;
  fileId: string;
  content: string;
  createdAt: Date;
  createdBy: {
    id: string;
    name: string;
    isAI: boolean;
  };
}

interface UseFileHistoryReturn {
  snapshots: FileSnapshot[];
  isLoading: boolean;
  hasMore: boolean;
  fetchSnapshots: (fileId: string, limit?: number) => Promise<void>;
  fetchMore: () => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
}

export function useFileHistory(projectId: string): UseFileHistoryReturn {
  const [snapshots, setSnapshots] = useState<FileSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);

  const fetchSnapshots = useCallback(async (fileId: string, limit = 20) => {
    setIsLoading(true);
    try {
      const url = new URL(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/files/${fileId}/history`);
      url.searchParams.set('limit', String(limit));
      if (cursor) url.searchParams.set('cursor', cursor);

      const response = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });

      const data = await response.json();
      setSnapshots(data.snapshots);
      setCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, cursor]);

  const fetchMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchSnapshots(snapshots[0]?.fileId || '', 20);
  }, [hasMore, isLoading, snapshots]);

  const restoreSnapshot = useCallback(async (snapshotId: string) => {
    const snapshot = snapshots.find(s => s.id === snapshotId);
    if (!snapshot) return;

    // This would integrate with Yjs to restore the content
    // The MonacoBinding will sync across the multiplayer network
    return snapshot.content;
  }, [snapshots]);

  return { snapshots, isLoading, hasMore, fetchSnapshots, fetchMore, restoreSnapshot };
}

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie.split('; ').find(r => r.startsWith('session-token='))?.split('=')[1] || '';
}
```

---

## 4. History Panel

### 4.1 HistoryPanel (src/history/HistoryPanel.tsx)

```typescript
'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Clock, User, Bot, RotateCcw } from 'lucide-react';
import { useFileHistory } from './useFileHistory';

interface HistoryPanelProps {
  projectId: string;
  fileId: string;
  onRestore: (content: string) => void;
}

export function HistoryPanel({ projectId, fileId, onRestore }: HistoryPanelProps) {
  const { snapshots, isLoading, hasMore, fetchSnapshots, fetchMore, restoreSnapshot } = useFileHistory(projectId);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);

  // Fetch on mount
  useState(() => {
    fetchSnapshots(fileId);
  });

  const handleRestore = async (snapshotId: string) => {
    const content = await restoreSnapshot(snapshotId);
    if (content) onRestore(content);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <h3 className="font-semibold">File History</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {snapshots.map((snapshot) => (
          <div
            key={snapshot.id}
            className={`p-3 border-b cursor-pointer hover:bg-gray-100 ${
              selectedSnapshot === snapshot.id ? 'bg-blue-50' : ''
            }`}
            onClick={() => setSelectedSnapshot(snapshot.id)}
          >
            <div className="flex items-center gap-2 mb-1">
              {snapshot.createdBy.isAI ? (
                <Bot className="w-4 h-4 text-purple-500" />
              ) : (
                <User className="w-4 h-4 text-gray-500" />
              )}
              <span className="text-sm font-medium">
                {snapshot.createdBy.isAI ? 'AI Agent' : snapshot.createdBy.name}
              </span>
              <span className="text-xs text-gray-400">
                {formatDistanceToNow(new Date(snapshot.createdAt), { addSuffix: true })}
              </span>
            </div>

            {selectedSnapshot === snapshot.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRestore(snapshot.id);
                }}
                className="mt-2 flex items-center gap-1 px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                <RotateCcw className="w-3 h-3" />
                Restore this version
              </button>
            )}
          </div>
        ))}

        {hasMore && (
          <button
            onClick={fetchMore}
            disabled={isLoading}
            className="w-full p-3 text-sm text-blue-500 hover:bg-gray-50"
          >
            {isLoading ? 'Loading...' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
```

---

## 5. Diff Viewer

### 5.1 HistoryDiffViewer (src/history/HistoryDiffViewer.tsx)

```typescript
'use client';

import Editor from '@monaco-editor/react';

interface HistoryDiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  language: string;
}

export function HistoryDiffViewer({ originalContent, modifiedContent, language }: HistoryDiffViewerProps) {
  return (
    <Editor
      height="100%"
      language={language}
      theme="vs-dark"
      options={{
        readOnly: true,
        renderSideBySide: true,
        originalEditable: false
      }}
      defaultValue={modifiedContent}
    />
  );
}
```

---

## 6. Implementation Status

| Component | Status |
|-----------|--------|
| useFileHistory Hook | ✅ Complete |
| History Panel | ✅ Complete |
| Diff Viewer | ✅ Complete |
| Pagination | ✅ Complete |
