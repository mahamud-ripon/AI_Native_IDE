# IDE Settings - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/settings/`  
> **Tech Stack:** React + Zustand + LocalStorage

---

## 1. Executive Summary

The Settings component manages global user preferences (theme, font size, keybindings) and programmatic API keys for external integrations.

---

## 2. Settings Store

### 2.1 useSettingsStore (src/settings/store.ts)

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: 'on' | 'off' | 'wordWrapColumn';
  minimap: boolean;
  lineNumbers: 'on' | 'off' | 'relative';
}

interface APIKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsed?: Date;
}

interface SettingsState {
  userSettings: UserSettings;
  apiKeys: APIKey[];
  
  updateSettings: (settings: Partial<UserSettings>) => void;
  addAPIKey: (name: string) => Promise<string>; // Returns the key (shown once)
  deleteAPIKey: (id: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      userSettings: {
        theme: 'dark',
        fontSize: 14,
        fontFamily: 'JetBrains Mono',
        tabSize: 2,
        wordWrap: 'on',
        minimap: true,
        lineNumbers: 'on'
      },
      apiKeys: [],
      
      updateSettings: (newSettings) => set(state => ({
        userSettings: { ...state.userSettings, ...newSettings }
      })),
      
      addAPIKey: async (name) => {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/api-keys`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${getToken()}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name })
          }
        );
        const data = await response.json();
        
        set(state => ({
          apiKeys: [...state.apiKeys, {
            id: data.id,
            name,
            prefix: 'sk-live-',
            createdAt: new Date()
          }]
        }));
        
        return data.key; // Only returned once!
      },
      
      deleteAPIKey: async (id) => {
        await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/api-keys/${id}`,
          { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` } }
        );
        
        set(state => ({
          apiKeys: state.apiKeys.filter(k => k.id !== id)
        }));
      }
    }),
    {
      name: 'ide-settings',
      partialize: (state) => ({ userSettings: state.userSettings })
    }
  )
);

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie.split('; ').find(r => r.startsWith('session-token='))?.split('=')[1] || '';
}
```

---

## 3. Settings Panel

### 3.1 SettingsPanel (src/settings/SettingsPanel.tsx)

```typescript
'use client';

import { useState } from 'react';
import { Moon, Sun, Monitor, Trash2, Plus, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { useSettingsStore } from './store';

export function SettingsPanel() {
  const { userSettings, updateSettings, apiKeys, addAPIKey, deleteAPIKey } = useSettingsStore();
  const [newKeyName, setNewKeyName] = useState('');
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleAddKey = async () => {
    if (newKeyName) {
      const key = await addAPIKey(newKeyName);
      setShowNewKey(key);
      setNewKeyName('');
    }
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      {/* Theme */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Appearance</h2>
        <div className="flex gap-4">
          {[
            { value: 'light', icon: Sun, label: 'Light' },
            { value: 'dark', icon: Moon, label: 'Dark' },
            { value: 'system', icon: Monitor, label: 'System' }
          ].map(option => (
            <button
              key={option.value}
              onClick={() => updateSettings({ theme: option.value as any })}
              className={`flex items-center gap-2 px-4 py-2 rounded border ${
                userSettings.theme === option.value 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-200'
              }`}
            >
              <option.icon className="w-4 h-4" />
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {/* Editor */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Editor</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label>Font Size</label>
            <input
              type="number"
              value={userSettings.fontSize}
              onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value) })}
              className="w-20 px-3 py-1 border rounded"
              min={10}
              max={24}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <label>Tab Size</label>
            <select
              value={userSettings.tabSize}
              onChange={(e) => updateSettings({ tabSize: parseInt(e.target.value) })}
              className="px-3 py-1 border rounded"
            >
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
            </select>
          </div>
          
          <div className="flex items-center justify-between">
            <label>Word Wrap</label>
            <select
              value={userSettings.wordWrap}
              onChange={(e) => updateSettings({ wordWrap: e.target.value as any })}
              className="px-3 py-1 border rounded"
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </div>
          
          <div className="flex items-center justify-between">
            <label>Minimap</label>
            <input
              type="checkbox"
              checked={userSettings.minimap}
              onChange={(e) => updateSettings({ minimap: e.target.checked })}
            />
          </div>
        </div>
      </section>

      {/* API Keys */}
      <section>
        <h2 className="text-lg font-semibold mb-4">API Keys</h2>
        
        {/* New key warning */}
        {showNewKey && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <p className="font-medium text-yellow-800 mb-2">⚠️ Copy this key now</p>
            <p className="text-sm text-yellow-600 mb-2">You will never see it again.</p>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 bg-white border rounded font-mono">
                {showNewKey}
              </code>
              <button
                onClick={() => copyKey(showNewKey)}
                className="px-3 py-2 border rounded hover:bg-gray-100"
              >
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
            <button
              onClick={() => setShowNewKey(null)}
              className="mt-2 text-sm text-yellow-700 underline"
            >
              I've copied the key
            </button>
          </div>
        )}
        
        {/* Add new key */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Key name (e.g., GitHub Actions)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 px-3 py-2 border rounded"
          />
          <button
            onClick={handleAddKey}
            disabled={!newKeyName}
            className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        
        {/* Key list */}
        <div className="space-y-2">
          {apiKeys.map(key => (
            <div key={key.id} className="flex items-center justify-between p-3 border rounded">
              <div>
                <div className="font-medium">{key.name}</div>
                <div className="text-sm text-gray-500">
                  {key.prefix}xxxx • Created {new Date(key.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => deleteAPIKey(key.id)}
                className="p-2 text-red-500 hover:bg-red-50 rounded"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

---

## 4. Implementation Status

| Component | Status |
|-----------|--------|
| Settings Store | ✅ Complete |
| LocalStorage Persist | ✅ Complete |
| Settings Panel | ✅ Complete |
| Theme Toggle | ✅ Complete |
| API Key Management | ✅ Complete |
| One-time Key Display | ✅ Complete |
