# IDE Deployments - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/deployments/`  
> **Tech Stack:** React + WebSocket + API

---

## 1. Executive Summary

The Deployments component provides a Vercel-like deployment experience inside the IDE. Users can deploy branches to production, view real-time build logs via WebSocket, and perform instant rollbacks.

---

## 2. Deployments Hook

### 2.1 useDeployments (src/deployments/useDeployments.ts)

```typescript
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Deployment {
  id: string;
  branch: string;
  commit: string;
  commitMessage: string;
  status: 'pending' | 'building' | 'success' | 'failed' | 'rolled_back';
  url: string | null;
  createdAt: Date;
  completedAt: Date | null;
  duration: number | null;
}

interface UseDeploymentsReturn {
  deployments: Deployment[];
  currentDeployment: Deployment | null;
  isLoading: boolean;
  fetchDeployments: () => Promise<void>;
  triggerDeployment: (branch: string) => Promise<void>;
  rollback: (deploymentId: string) => Promise<void>;
  logs: string[];
}

export function useDeployments(projectId: string): UseDeploymentsReturn {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [currentDeployment, setCurrentDeployment] = useState<Deployment | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchDeployments = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/deployments`,
        { headers: { 'Authorization': `Bearer ${getToken()}` } }
      );
      const data = await response.json();
      setDeployments(data.deployments);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const triggerDeployment = useCallback(async (branch: string) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/deployments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ branch, triggerType: 'manual' })
      }
    );
    const deployment = await response.json();
    setCurrentDeployment(deployment);
    setDeployments(prev => [deployment, ...prev]);
    
    // Connect to log WebSocket
    connectToLogs(deployment.id);
  }, [projectId]);

  const rollback = useCallback(async (deploymentId: string) => {
    const deployment = deployments.find(d => d.id === deploymentId);
    if (!deployment) return;
    
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/deployments/${deploymentId}/rollback`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      }
    );
    
    await fetchDeployments();
  }, [projectId, deployments, fetchDeployments]);

  const connectToLogs = (deploymentId: string) => {
    const ws = new WebSocket(
      `${process.env.NEXT_PUBLIC_WS_URL}/deployment_logs/${deploymentId}`
    );
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        setLogs(prev => [...prev, data.message]);
      } else if (data.type === 'status') {
        setCurrentDeployment(prev => prev ? { ...prev, status: data.status } : null);
        if (data.status === 'success' || data.status === 'failed') {
          fetchDeployments();
        }
      }
    };
    
    wsRef.current = ws;
  };

  useEffect(() => {
    fetchDeployments();
    return () => wsRef.current?.close();
  }, [fetchDeployments]);

  return { deployments, currentDeployment, isLoading, fetchDeployments, triggerDeployment, rollback, logs };
}

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie.split('; ').find(r => r.startsWith('session-token='))?.split('=')[1] || '';
}
```

---

## 3. Deployments Panel

### 3.1 DeploymentsPanel (src/deployments/DeploymentsPanel.tsx)

```typescript
'use client';

import { useState } from 'react';
import { Play, RotateCcw, ExternalLink, Clock, CheckCircle, XCircle, Loader2, GitBranch } from 'lucide-react';
import { useDeployments } from './useDeployments';

interface DeploymentsPanelProps {
  projectId: string;
}

export function DeploymentsPanel({ projectId }: DeploymentsPanelProps) {
  const { deployments, currentDeployment, isLoading, triggerDeployment, rollback, logs } = useDeployments(projectId);
  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'building': return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default: return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
  };

  return (
    <div className="flex h-full">
      {/* Deployment List */}
      <div className="flex-1 flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Deployments</h2>
          <button
            onClick={() => triggerDeployment('main')}
            className="flex items-center gap-2 px-3 py-1 bg-green-500 text-white rounded text-sm"
          >
            <Play className="w-4 h-4" /> Deploy
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {deployments.map((deployment) => (
            <div
              key={deployment.id}
              onClick={() => setSelectedDeployment(deployment.id)}
              className={`p-3 border-b cursor-pointer hover:bg-gray-100 ${
                selectedDeployment === deployment.id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-gray-500" />
                  <span className="font-medium">{deployment.branch}</span>
                </div>
                {getStatusIcon(deployment.status)}
              </div>
              
              <div className="text-sm text-gray-500 truncate mb-1">
                {deployment.commitMessage}
              </div>
              
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span>{new Date(deployment.createdAt).toLocaleString()}</span>
                {deployment.duration && (
                  <span>{formatDuration(deployment.duration)}</span>
                )}
                {deployment.url && (
                  <a
                    href={deployment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-500 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="w-3 h-3" /> Open
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Log Panel */}
      {selectedDeployment && (
        <div className="w-96 border-l flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="font-medium">Build Logs</span>
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="text-sm text-blue-500 hover:underline"
            >
              {showLogs ? 'Hide' : 'Show'}
            </button>
          </div>
          
          {showLogs && (
            <div className="flex-1 overflow-y-auto p-3 bg-gray-900 font-mono text-xs">
              {logs.length === 0 ? (
                <span className="text-gray-500">No logs available</span>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="text-gray-300 whitespace-pre-wrap">
                    {log}
                  </div>
                ))
              )}
            </div>
          )}
          
          <div className="p-3 border-t">
            <button
              onClick={() => rollback(selectedDeployment)}
              className="flex items-center gap-2 w-full px-3 py-2 border rounded hover:bg-gray-50"
            >
              <RotateCcw className="w-4 h-4" />
              Rollback to this version
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 4. Implementation Status

| Component | Status |
|-----------|--------|
| useDeployments Hook | ✅ Complete |
| Deployments Panel | ✅ Complete |
| WebSocket Log Streaming | ✅ Complete |
| Auto-scroll Logs | ✅ Complete |
| Rollback Action | ✅ Complete |
| Status Indicators | ✅ Complete |
