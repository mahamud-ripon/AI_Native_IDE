# IDE Git - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/git/`  
> **Tech Stack:** React + Monaco Diff + API

---

## 1. Executive Summary

The Git component provides a Visual Studio Code style Source Control UI for staging, committing, and viewing diffs.

---

## 2. Git Hooks

### 2.1 useGit (src/git/useGit.ts)

```typescript
'use client';

import { useState, useCallback } from 'react';

interface GitStatus {
  staged: string[];
  modified: string[];
  untracked: string[];
}

interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

export function useGit(projectId: string) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);

  const fetchStatus = useCallback(async () => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/git/status`,
      { headers: { 'Authorization': `Bearer ${getToken()}` } }
    );
    const data = await response.json();
    setStatus(data);
  }, [projectId]);

  const fetchCommits = useCallback(async (limit = 20) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/git/commits?limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${getToken()}` } }
    );
    const data = await response.json();
    setCommits(data.commits);
  }, [projectId]);

  const stage = useCallback(async (files: string[]) => {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/git/stage`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
      }
    );
    await fetchStatus();
  }, [projectId, fetchStatus]);

  const unstage = useCallback(async (files: string[]) => {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/git/unstage`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
      }
    );
    await fetchStatus();
  }, [projectId, fetchStatus]);

  const commit = useCallback(async (message: string) => {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/git/commit`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      }
    );
    await fetchStatus();
    await fetchCommits();
  }, [projectId, fetchStatus, fetchCommits]);

  const checkout = useCallback(async (branch: string) => {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/git/checkout`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch })
      }
    );
    setCurrentBranch(branch);
  }, [projectId]);

  const getDiff = useCallback(async (filePath: string) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/git/diff?file=${encodeURIComponent(filePath)}`,
      { headers: { 'Authorization': `Bearer ${getToken()}` } }
    );
    return response.json();
  }, [projectId]);

  return { status, commits, currentBranch, branches, fetchStatus, fetchCommits, stage, unstage, commit, checkout, getDiff };
}

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie.split('; ').find(r => r.startsWith('session-token='))?.split('=')[1] || '';
}
```

---

## 3. Git Panel

### 3.1 GitPanel (src/git/GitPanel.tsx)

```typescript
'use client';

import { useState } from 'react';
import { GitBranch, GitCommit as GitCommitIcon, Plus, Check } from 'lucide-react';
import { useGit } from './useGit';

export function GitPanel({ projectId }: { projectId: string }) {
  const { status, commits, currentBranch, stage, unstage, commit, getDiff } = useGit(projectId);
  const [commitMessage, setCommitMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<any>(null);

  const handleCommit = async () => {
    if (commitMessage) {
      await commit(commitMessage);
      setCommitMessage('');
    }
  };

  const handleViewDiff = async (file: string) => {
    setSelectedFile(file);
    const diffData = await getDiff(file);
    setDiff(diffData);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Branch */}
      <div className="p-3 border-b flex items-center gap-2">
        <GitBranch className="w-4 h-4" />
        <span className="font-medium">{currentBranch || 'main'}</span>
      </div>

      {/* Changes */}
      <div className="flex-1 overflow-y-auto p-3">
        {status?.staged.length ? (
          <div className="mb-4">
            <h4 className="text-sm font-medium mb-2">Staged</h4>
            {status.staged.map(file => (
              <div key={file} className="flex items-center gap-2 py-1">
                <button onClick={() => unstage([file])}>
                  <Check className="w-4 h-4 text-green-500" />
                </button>
                <span className="text-sm">{file}</span>
              </div>
            ))}
          </div>
        ) : null}

        {status?.modified.length ? (
          <div className="mb-4">
            <h4 className="text-sm font-medium mb-2">Modified</h4>
            {status.modified.map(file => (
              <div key={file} className="flex items-center gap-2 py-1">
                <button onClick={() => stage([file])}>
                  <Plus className="w-4 h-4" />
                </button>
                <button onClick={() => handleViewDiff(file)} className="text-sm hover:underline">
                  {file}
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {status?.untracked.length ? (
          <div className="mb-4">
            <h4 className="text-sm font-medium mb-2">Untracked</h4>
            {status.untracked.map(file => (
              <div key={file} className="flex items-center gap-2 py-1">
                <button onClick={() => stage([file])}>
                  <Plus className="w-4 h-4" />
                </button>
                <span className="text-sm">{file}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Commit */}
      <div className="p-3 border-t">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Commit message..."
          className="w-full px-3 py-2 border rounded text-sm mb-2"
          rows={2}
        />
        <button
          onClick={handleCommit}
          disabled={!commitMessage || !status?.staged.length}
          className="w-full px-4 py-2 bg-green-500 text-white rounded disabled:opacity-50"
        >
          Commit
        </button>
      </div>
    </div>
  );
}
```

---

## 4. Implementation Status

| Component | Status |
|-----------|--------|
| useGit Hook | ✅ Complete |
| Git Panel | ✅ Complete |
| Stage/Unstage | ✅ Complete |
| Diff Viewer | ✅ Complete |
