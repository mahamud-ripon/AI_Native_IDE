# IDE Secrets - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/secrets/`  
> **Tech Stack:** React + API + Vault Integration

---

## 1. Executive Summary

The Secrets component manages environment variables securely. It prevents users from hardcoding API keys in files, instead storing them in HashiCorp Vault.

---

## 2. Secrets Hook

### 2.1 useSecrets (src/secrets/useSecrets.ts)

```typescript
'use client';

import { useState, useCallback } from 'react';

interface Secret {
  id: string;
  key: string;
  vaultReferenceId: string;
  lastUpdated: Date;
}

interface UseSecretsReturn {
  secrets: Secret[];
  isLoading: boolean;
  fetchSecrets: () => Promise<void>;
  addSecret: (key: string, value: string) => Promise<void>;
  deleteSecret: (id: string) => Promise<void>;
  syncToVM: () => Promise<void>;
}

export function useSecrets(projectId: string): UseSecretsReturn {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSecrets = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/secrets`,
        { headers: { 'Authorization': `Bearer ${getToken()}` } }
      );
      const data = await response.json();
      setSecrets(data.secrets);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const addSecret = useCallback(async (key: string, value: string) => {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/secrets`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key, value })
      }
    );
    await fetchSecrets();
  }, [projectId, fetchSecrets]);

  const deleteSecret = useCallback(async (id: string) => {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/secrets/${id}`,
      { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` } }
    );
    await fetchSecrets();
  }, [projectId, fetchSecrets]);

  const syncToVM = useCallback(async () => {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/secrets/sync`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${getToken()}` } }
    );
  }, [projectId]);

  return { secrets, isLoading, fetchSecrets, addSecret, deleteSecret, syncToVM };
}

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie.split('; ').find(r => r.startsWith('session-token='))?.split('=')[1] || '';
}
```

---

## 3. Secrets Manager

### 3.1 SecretsManager (src/secrets/SecretsManager.tsx)

```typescript
'use client';

import { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, RefreshCw, Lock } from 'lucide-react';
import { useSecrets } from './useSecrets';

export function SecretsManager({ projectId }: { projectId: string }) {
  const { secrets, addSecret, deleteSecret, syncToVM, fetchSecrets } = useSecrets(projectId);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [visibleValues, setVisibleValues] = useState<Set<string>>(new Set());

  const toggleVisibility = (id: string) => {
    setVisibleValues(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (newKey && newValue) {
      await addSecret(newKey, newValue);
      setNewKey('');
      setNewValue('');
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Environment Variables</h2>
        <button
          onClick={syncToVM}
          className="flex items-center gap-2 px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          <RefreshCw className="w-4 h-4" />
          Sync to VM
        </button>
      </div>

      {/* Add new secret */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="KEY_NAME"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toUpperCase())}
          className="flex-1 px-3 py-2 border rounded"
        />
        <input
          type="password"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="flex-1 px-3 py-2 border rounded"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Secrets list */}
      <div className="space-y-2">
        {secrets.map((secret) => (
          <div key={secret.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded">
            <Lock className="w-4 h-4 text-gray-400" />
            <span className="font-mono text-sm">{secret.key}</span>
            <span className="flex-1 text-gray-400">= </span>
            <span className="font-mono text-sm">
              {visibleValues.has(secret.id) ? '••••••••' : '********************'}
            </span>
            <button
              onClick={() => toggleVisibility(secret.id)}
              className="p-1 hover:bg-gray-200 rounded"
            >
              {visibleValues.has(secret.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              onClick={() => deleteSecret(secret.id)}
              className="p-1 hover:bg-red-100 rounded text-red-500"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 4. Implementation Status

| Component | Status |
|-----------|--------|
| useSecrets Hook | ✅ Complete |
| Secrets Manager | ✅ Complete |
| Masked Input | ✅ Complete |
| Sync to VM | ✅ Complete |
