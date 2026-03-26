/**
 * SettingsPanel - Project settings UI
 */

import * as React from 'react';
import { Settings } from 'lucide-react';
import { useIDEStore } from '@/stores/ideStore';

const colors = {
  bgMain: '#0e0e11',
  bgPanel: '#18181b',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  accentColor: '#3b82f6',
  successColor: '#10b981',
};

function ToggleSwitch({ defaultChecked }: { defaultChecked: boolean }) {
  const [checked, setChecked] = React.useState(defaultChecked);

  return (
    <button
      onClick={() => setChecked(!checked)}
      style={{
        position: 'relative',
        width: '44px',
        height: '24px',
        backgroundColor: checked ? colors.accentColor : colors.bgMain,
        border: `1px solid ${checked ? colors.accentColor : colors.borderColor}`,
        borderRadius: '24px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          height: '18px',
          width: '18px',
          left: checked ? '22px' : '2px',
          bottom: '2px',
          backgroundColor: checked ? 'white' : colors.textSecondary,
          borderRadius: '50%',
          transition: 'all 0.2s',
        }}
      />
    </button>
  );
}

export function SettingsPanel({ projectId }: { projectId: string }) {
  const { projectName } = useIDEStore();
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div
      className="flex flex-col h-full overflow-auto"
      style={{ flex: 1, backgroundColor: colors.bgMain }}
    >
      <div
        className="flex items-center gap-3 flex-shrink-0"
        style={{
          height: '64px',
          padding: '0 24px',
          borderBottom: `1px solid ${colors.borderColor}`,
          backgroundColor: colors.bgMain,
        }}
      >
        <Settings className="h-6 w-6" style={{ color: colors.accentColor }} />
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: colors.textPrimary }}>Project Settings</h2>
      </div>

      <div style={{ padding: '24px', maxWidth: '800px' }}>
        {[
          {
            title: 'General',
            items: [
              { label: 'Project Name', desc: projectId, value: projectName, type: 'text' as const },
              { label: 'Description', desc: 'A beautiful todo application', value: 'A beautiful todo application', type: 'text' as const },
            ],
          },
          {
            title: 'Environment',
            items: [
              { label: 'Node Version', desc: '18.19.0', value: '18.19.0', type: 'select' as const, options: ['18.19.0', '20.10.0', '21.6.0'] },
              { label: 'Package Manager', desc: 'npm', value: 'npm', type: 'select' as const, options: ['npm', 'yarn', 'pnpm'] },
            ],
          },
          {
            title: 'Build & Deploy',
            items: [
              { label: 'Build Command', desc: 'Command to build the project', value: 'npm run build', type: 'text' as const },
              { label: 'Output Directory', desc: 'Directory to store build output', value: 'dist', type: 'text' as const },
            ],
          },
        ].map((section) => (
          <div
            key={section.title}
            className="rounded-xl mb-6"
            style={{
              backgroundColor: colors.bgPanel,
              border: `1px solid ${colors.borderColor}`,
              padding: '20px',
            }}
          >
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: colors.textPrimary, marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {section.title}
            </h3>
            {section.items.map((item, i) => (
              <div
                key={item.label}
                className="flex items-center justify-between"
                style={{
                  padding: '14px 0',
                  borderBottom: i < section.items.length - 1 ? `1px solid ${colors.borderColor}` : 'none',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: colors.textPrimary }}>{item.label}</div>
                  <div style={{ fontSize: '12px', color: colors.textSecondary }}>{item.desc}</div>
                </div>
                {item.type === 'select' ? (
                  <select
                    defaultValue={item.value}
                    style={{
                      width: '180px',
                      backgroundColor: colors.bgMain,
                      border: `1px solid ${colors.borderColor}`,
                      borderRadius: '6px',
                      padding: '7px 12px',
                      color: colors.textPrimary,
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  >
                    {(item as any).options?.map((opt: string) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    defaultValue={item.value}
                    style={{
                      width: '180px',
                      backgroundColor: colors.bgMain,
                      border: `1px solid ${colors.borderColor}`,
                      borderRadius: '6px',
                      padding: '7px 12px',
                      color: colors.textPrimary,
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Advanced Toggles */}
        <div
          className="rounded-xl mb-6"
          style={{
            backgroundColor: colors.bgPanel,
            border: `1px solid ${colors.borderColor}`,
            padding: '20px',
          }}
        >
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: colors.textPrimary, marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Advanced
          </h3>
          {[
            { label: 'TypeScript', desc: 'Enable TypeScript support', checked: true },
            { label: 'ESLint', desc: 'Enable code linting', checked: true },
            { label: 'Auto Save', desc: 'Automatically save changes', checked: true },
          ].map((item, i) => (
            <div
              key={item.label}
              className="flex items-center justify-between"
              style={{
                padding: '14px 0',
                borderBottom: i < 2 ? `1px solid ${colors.borderColor}` : 'none',
              }}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: colors.textPrimary }}>{item.label}</div>
                <div style={{ fontSize: '12px', color: colors.textSecondary }}>{item.desc}</div>
              </div>
              <ToggleSwitch defaultChecked={item.checked} />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            style={{
              padding: '8px 16px',
              backgroundColor: colors.bgPanel,
              color: colors.textPrimary,
              border: `1px solid ${colors.borderColor}`,
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 16px',
              backgroundColor: saved ? colors.successColor : colors.textPrimary,
              color: colors.bgMain,
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {saved ? '✓ Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
