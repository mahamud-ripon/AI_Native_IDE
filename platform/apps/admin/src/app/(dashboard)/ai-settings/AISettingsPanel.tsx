'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModelSelector } from './ModelSelector';
import { ModeConfig } from './ModeConfig';
import { CustomModelsSection } from './CustomModelsSection';

interface AIConfig {
  [key: string]: unknown;
}

interface ModelOption {
  provider: string;
  model: string;
  label: string;
}

interface ProviderHealth {
  groq: boolean;
  openai: boolean;
  anthropic: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export function AISettingsPanel() {
  const [config, setConfig] = useState<AIConfig>({});
  const [models, setModels] = useState<ModelOption[]>([]);
  const [health, setHealth] = useState<ProviderHealth>({ groq: false, openai: false, anthropic: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const [configRes, modelsRes, healthRes] = await Promise.all([
        fetch(`${API_BASE}/admin/ai/config`),
        fetch(`${API_BASE}/admin/ai/models`),
        fetch(`${API_BASE}/admin/ai/health`),
      ]);

      const configData = await configRes.json();
      const modelsData = await modelsRes.json();
      const healthData = await healthRes.json();

      if (configData.success) setConfig(configData.data);
      if (modelsData.success) setModels(modelsData.data);
      if (healthData.success) setHealth(healthData.data.providers);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load AI configuration' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const updateConfig = async (key: string, value: unknown) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/ai/config/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(prev => ({ ...prev, [key]: value }));
        setMessage({ type: 'success', text: `${key} updated successfully` });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error while updating config' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Status message */}
      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          message.type === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Section 1: Custom Models Management */}
      <CustomModelsSection
        models={models}
        apiBase={API_BASE}
        onModelsChange={loadConfig}
        saving={saving}
      />

      {/* Section 2: Model Configuration */}
      <section className="rounded-lg border bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">AI Model Configuration</h2>
        <p className="text-sm text-gray-500 mb-6">
          Select which LLM model to use for each agent mode.
        </p>

        <div className="space-y-6">
          <ModelSelector
            label="Mode 1 — Direct Chat"
            description="Simple tasks: create/edit/delete files, explain code. Fast and cheap."
            value={config['ai.mode1.model'] as { provider: string; model: string } | undefined}
            models={models}
            onChange={(val) => updateConfig('ai.mode1.model', val)}
            disabled={saving}
          />

          <ModelSelector
            label="Mode 2 — Plan & Execute"
            description="Complex tasks: refactoring, multi-file changes, migrations."
            value={config['ai.mode2.model'] as { provider: string; model: string } | undefined}
            models={models}
            onChange={(val) => updateConfig('ai.mode2.model', val)}
            disabled={saving}
          />
        </div>

        {/* Provider health */}
        <div className="mt-6 flex items-center gap-6 text-sm">
          <span className="text-gray-500">Provider Status:</span>
          {Object.entries(health).map(([provider, connected]) => (
            <span key={provider} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-400'}`} />
              <span className="capitalize text-gray-700">{provider}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Section 3: Mode Control */}
      <section className="rounded-lg border bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Mode Control</h2>
        <p className="text-sm text-gray-500 mb-6">
          Control how users interact with AI modes in the IDE.
        </p>

        <ModeConfig
          config={config}
          onUpdate={updateConfig}
          disabled={saving}
        />
      </section>

      {/* Section 4: Fallback Behavior */}
      <section className="rounded-lg border bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Fallback Behavior</h2>
        <p className="text-sm text-gray-500 mb-6">
          Configure what happens when the Python AI agents service is unavailable.
        </p>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Mode 3 (Multi-Agent) Enabled</p>
              <p className="text-xs text-gray-500">Allow project building via Python agents</p>
            </div>
            <button
              onClick={() => updateConfig('ai.mode3.enabled', !(config['ai.mode3.enabled'] ?? true))}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                (config['ai.mode3.enabled'] ?? true) ? 'bg-primary-600' : 'bg-gray-300'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                (config['ai.mode3.enabled'] ?? true) ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              If Python agents unavailable
            </label>
            <select
              value={(config['ai.mode3.fallback'] as string) ?? 'mode2'}
              onChange={(e) => updateConfig('ai.mode3.fallback', e.target.value)}
              disabled={saving}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="mode2">Fall back to Mode 2 (Plan & Execute)</option>
              <option value="error">Return error to user</option>
            </select>
          </div>
        </div>
      </section>

      {/* Refresh button */}
      <div className="flex justify-end">
        <button
          onClick={loadConfig}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Refresh from Database
        </button>
      </div>
    </div>
  );
}
