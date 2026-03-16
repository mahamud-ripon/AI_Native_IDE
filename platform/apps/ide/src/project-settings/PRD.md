# IDE Project Settings - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/project-settings/`  
> **Tech Stack:** React + API + Radix UI

---

## 1. Executive Summary

The Project Settings component manages project-specific configuration including custom domains and project deletion.

---

## 2. Project Settings Hook

### 2.1 useProjectSettings (src/project-settings/useProjectSettings.ts)

```typescript
'use client';

import { useState, useCallback } from 'react';

interface CustomDomain {
  domain: string;
  verified: boolean;
  aRecord?: string;
  cnameRecord?: string;
}

interface ProjectSettings {
  id: string;
  name: string;
  customDomains: CustomDomain[];
}

export function useProjectSettings(projectId: string) {
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}`,
        { headers: { 'Authorization': `Bearer ${getToken()}` } }
      );
      const data = await response.json();
      setSettings(data);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const updateName = useCallback(async (name: string) => {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      }
    );
    await fetchSettings();
  }, [projectId, fetchSettings]);

  const addCustomDomain = useCallback(async (domain: string) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/domains`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ domain })
      }
    );
    return response.json();
  }, [projectId]);

  const verifyDomain = useCallback(async (domain: string) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}/domains/verify?domain=${domain}`,
      { headers: { 'Authorization': `Bearer ${getToken()}` } }
    );
    return response.json();
  }, [projectId]);

  const deleteProject = useCallback(async (projectName: string) => {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/projects/${projectId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ confirmName: projectName })
      }
    );
  }, [projectId]);

  return { settings, isLoading, fetchSettings, updateName, addCustomDomain, verifyDomain, deleteProject };
}

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie.split('; ').find(r => r.startsWith('session-token='))?.split('=')[1] || '';
}
```

---

## 3. Settings Panel

### 3.1 ProjectSettingsPanel (src/project-settings/ProjectSettingsPanel.tsx)

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, AlertTriangle, CheckCircle } from 'lucide-react';
import { useProjectSettings } from './useProjectSettings';

export function ProjectSettingsPanel({ projectId }: { projectId: string }) {
  const { settings, updateName, addCustomDomain, verifyDomain, deleteProject, fetchSettings } = useProjectSettings(projectId);
  const [newDomain, setNewDomain] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const router = useRouter();

  const handleAddDomain = async () => {
    if (newDomain) {
      await addCustomDomain(newDomain);
      setNewDomain('');
      await fetchSettings();
    }
  };

  const handleDelete = async () => {
    if (deleteConfirm === settings?.name) {
      await deleteProject(deleteConfirm);
      router.push('/dashboard');
    }
  };

  if (!settings) return <div>Loading...</div>;

  return (
    <div className="p-6 space-y-8">
      {/* Project Name */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Project Name</h2>
        <input
          type="text"
          defaultValue={settings.name}
          onBlur={(e) => updateName(e.target.value)}
          className="w-full px-3 py-2 border rounded"
        />
      </section>

      {/* Custom Domains */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Custom Domains
        </h2>
        
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="www.example.com"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            className="flex-1 px-3 py-2 border rounded"
          />
          <button
            onClick={handleAddDomain}
            className="px-4 py-2 bg-blue-500 text-white rounded"
          >
            Add Domain
          </button>
        </div>

        {settings.customDomains.map((domain) => (
          <div key={domain.domain} className="p-4 border rounded mb-2">
            <div className="flex items-center justify-between">
              <span>{domain.domain}</span>
              {domain.verified ? (
                <span className="flex items-center gap-1 text-green-500">
                  <CheckCircle className="w-4 h-4" /> Verified
                </span>
              ) : (
                <button
                  onClick={() => verifyDomain(domain.domain)}
                  className="text-blue-500 hover:underline"
                >
                  Verify
                </button>
              )}
            </div>
            {!domain.verified && (
              <div className="mt-2 text-sm text-gray-500">
                <p>Add these DNS records:</p>
                <pre className="bg-gray-100 p-2 mt-1 rounded">
                  Type: CNAME, Name: @, Value: {domain.cnameRecord}
                </pre>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Danger Zone */}
      <section className="border-t pt-8">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-500">
          <AlertTriangle className="w-5 h-5" />
          Danger Zone
        </h2>
        
        <button
          onClick={() => setShowDeleteModal(true)}
          className="px-4 py-2 border border-red-500 text-red-500 rounded hover:bg-red-50"
        >
          Delete Project
        </button>
      </section>

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md">
            <h3 className="text-xl font-bold text-red-500 mb-4">Delete Project?</h3>
            <p className="mb-4">This action cannot be undone. Type the project name to confirm:</p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={settings.name}
              className="w-full px-3 py-2 border rounded mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-2 border rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirm !== settings.name}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded disabled:opacity-50"
              >
                Delete
              </button>
            </div>
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
| useProjectSettings Hook | ✅ Complete |
| Settings Panel | ✅ Complete |
| Custom Domains | ✅ Complete |
| Danger Zone Delete | ✅ Complete |
