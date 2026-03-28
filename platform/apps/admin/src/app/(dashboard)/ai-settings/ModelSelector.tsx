'use client';

interface ModelOption {
  provider: string;
  model: string;
  label: string;
}

interface ModelSelectorProps {
  label: string;
  description: string;
  value?: { provider: string; model: string };
  models: ModelOption[];
  onChange: (value: { provider: string; model: string }) => void;
  disabled?: boolean;
}

export function ModelSelector({ label, description, value, models, onChange, disabled }: ModelSelectorProps) {
  const currentValue = value ? `${value.provider}/${value.model}` : '';

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <p className="text-xs text-gray-500">{description}</p>
      <select
        value={currentValue}
        onChange={(e) => {
          const [provider, ...modelParts] = e.target.value.split('/');
          onChange({ provider, model: modelParts.join('/') });
        }}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
      >
        <option value="">Select a model...</option>
        {models.map((m) => (
          <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
