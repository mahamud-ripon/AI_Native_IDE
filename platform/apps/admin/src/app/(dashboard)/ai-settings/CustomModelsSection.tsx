'use client';

import { useState, useEffect } from 'react';

interface ModelOption {
  provider: string;
  model: string;
  label: string;
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  maxContextTokens?: number;
}

interface CustomModelsSectionProps {
  models: ModelOption[];
  apiBase: string;
  onModelsChange: () => void;
  saving: boolean;
}

const KNOWN_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', defaultBase: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', defaultBase: 'https://api.anthropic.com/v1' },
  { id: 'groq', label: 'Groq', defaultBase: 'https://api.groq.com/openai/v1' },
  { id: 'deepseek', label: 'DeepSeek', defaultBase: 'https://api.deepseek.com/v1' },
  { id: 'siliconflow', label: 'SiliconFlow', defaultBase: 'https://api.siliconflow.cn/v1' },
  { id: 'nvidia', label: 'NVIDIA NIM', defaultBase: 'https://integrate.api.nvidia.com/v1' },
  { id: 'xiaomi', label: 'Xiaomi MiMo', defaultBase: 'https://api.xiaomimimo.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', defaultBase: 'https://openrouter.ai/api/v1' },
  { id: 'huggingface', label: 'HuggingFace', defaultBase: 'https://api-inference.huggingface.co/v1' },
  { id: 'google', label: 'Google AI Studio', defaultBase: '' },
];

export function CustomModelsSection({ models, apiBase, onModelsChange, saving }: CustomModelsSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [provider, setProvider] = useState('deepseek');
  const [model, setModel] = useState('');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [formSaving, setFormSaving] = useState(false);

  // Auto-fill baseUrl when provider changes
  useEffect(() => {
    const known = KNOWN_PROVIDERS.find(p => p.id === provider);
    if (known && known.defaultBase) {
      setBaseUrl(known.defaultBase);
    }
  }, [provider]);

  const resetForm = () => {
    setProvider('deepseek');
    setModel('');
    setLabel('');
    setApiKey('');
    setBaseUrl('');
    setShowForm(false);
    setEditingIndex(null);
  };

  const handleSave = async () => {
    if (!model.trim()) {
      setMessage({ type: 'error', text: 'Model name is required' });
      return;
    }

    setFormSaving(true);
    setMessage(null);

    const newModel: ModelOption = {
      provider,
      model: model.trim(),
      label: label.trim() || `${provider}/${model.trim()}`,
      apiKey: apiKey.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
      enabled: true,
      supportsTools: true,
      supportsVision: false,
      maxContextTokens: 128000,
    };

    try {
      let updatedModels: ModelOption[];

      if (editingIndex !== null) {
        updatedModels = [...models];
        updatedModels[editingIndex] = newModel;
      } else {
        updatedModels = [...models, newModel];
      }

      const res = await fetch(`${apiBase}/admin/ai/config/ai.models`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: updatedModels }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `Model "${newModel.label}" saved successfully` });
        onModelsChange();
        resetForm();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save model' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error while saving model' });
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (index: number) => {
    if (!confirm('Are you sure you want to delete this model?')) return;

    try {
      const updatedModels = models.filter((_, i) => i !== index);
      const res = await fetch(`${apiBase}/admin/ai/config/ai.models`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: updatedModels }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: 'Model deleted' });
        onModelsChange();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to delete model' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    }
  };

  const handleEdit = (index: number) => {
    const m = models[index];
    setProvider(m.provider);
    setModel(m.model);
    setLabel(m.label);
    setApiKey(m.apiKey || '');
    setBaseUrl(m.baseUrl || '');
    setEditingIndex(index);
    setShowForm(true);
  };

  return (
    <section className="rounded-lg border bg-white p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-gray-900">Custom Models</h2>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          disabled={saving}
          className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        >
          + Add Model
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Add custom LLM providers with their API keys and endpoints. These will appear in the model selector above.
      </p>

      {/* Status message */}
      {message && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${
          message.type === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div className="mb-6 rounded-lg border bg-gray-50 p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            {editingIndex !== null ? 'Edit Model' : 'Add New Model'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              >
                {KNOWN_PROVIDERS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Model Name *</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. deepseek-chat"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Display Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. DeepSeek V3.2 (Budget)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600 block mb-1">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600 block mb-1">Max Context Tokens</label>
              <input
                type="number"
                value={128000}
                readOnly
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={resetForm}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={formSaving || !model.trim()}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {formSaving ? 'Saving...' : editingIndex !== null ? 'Update' : 'Add Model'}
            </button>
          </div>
        </div>
      )}

      {/* Models List */}
      {models.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">
          No models configured. Click "Add Model" to get started.
        </p>
      ) : (
        <div className="space-y-2">
          {models.map((m, index) => (
            <div
              key={`${m.provider}/${m.model}`}
              className="flex items-center justify-between rounded-lg border px-4 py-3 hover:bg-gray-50"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 uppercase">
                  {m.provider.slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{m.label}</p>
                  <p className="text-xs text-gray-500">{m.provider} / {m.model}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {m.apiKey && (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">API Key set</span>
                )}
                <button
                  onClick={() => handleEdit(index)}
                  className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-200"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(index)}
                  className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
