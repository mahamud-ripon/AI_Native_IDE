'use client';

interface ModeConfigProps {
  config: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
  disabled?: boolean;
}

export function ModeConfig({ config, onUpdate, disabled }: ModeConfigProps) {
  const userAllowed = (config['ai.mode_selection.user_allowed'] as boolean) ?? true;
  const defaultMode = (config['ai.mode_selection.default'] as string) ?? 'direct';
  const maxTurns = (config['ai.max_turns.direct'] as number) ?? 10;
  const availableModes = (config['ai.available_modes'] as string[]) ?? ['direct', 'plan_execute', 'multi_agent'];

  const allModes = [
    { key: 'direct', label: 'Chat', description: 'Simple tasks, 1 LLM call' },
    { key: 'plan_execute', label: 'Agent', description: 'Complex tasks, multi-step pipeline' },
    { key: 'multi_agent', label: 'Build', description: 'Full project building via Python agents' },
  ];

  const toggleMode = (modeKey: string) => {
    const current = availableModes || [];
    const updated = current.includes(modeKey)
      ? current.filter(m => m !== modeKey)
      : [...current, modeKey];
    onUpdate('ai.available_modes', updated);
  };

  return (
    <div className="space-y-5">
      {/* Allow user mode selection */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">Allow user mode selection</p>
          <p className="text-xs text-gray-500">Users can switch between Chat/Agent/Build in the IDE</p>
        </div>
        <button
          onClick={() => onUpdate('ai.mode_selection.user_allowed', !userAllowed)}
          disabled={disabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            userAllowed ? 'bg-primary-600' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            userAllowed ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {/* Default mode */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Default Mode</label>
        <select
          value={defaultMode}
          onChange={(e) => onUpdate('ai.mode_selection.default', e.target.value)}
          disabled={disabled}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {allModes.map(m => (
            <option key={m.key} value={m.key}>{m.label} — {m.description}</option>
          ))}
        </select>
      </div>

      {/* Max turns for direct mode */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">
          Max turns (Direct mode): {maxTurns}
        </label>
        <input
          type="range"
          min={3}
          max={30}
          value={maxTurns}
          onChange={(e) => onUpdate('ai.max_turns.direct', parseInt(e.target.value))}
          disabled={disabled}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>3 (fast)</span>
          <span>30 (thorough)</span>
        </div>
      </div>

      {/* Available modes checkboxes */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Available modes for users</p>
        <div className="space-y-2">
          {allModes.map(m => (
            <label key={m.key} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={availableModes.includes(m.key)}
                onChange={() => toggleMode(m.key)}
                disabled={disabled}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">{m.label}</span>
                <span className="text-xs text-gray-500 ml-2">{m.description}</span>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
