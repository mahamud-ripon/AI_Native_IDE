import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectClient, type ProjectTemplate } from '../api/projectClient';

// Built-in template definitions for offline/demo mode
const BUILT_IN_TEMPLATES: ProjectTemplate[] = [
  { id: 'react', name: 'React + Vite', slug: 'react', description: 'Modern React app with Vite bundler and TypeScript', category: 'Frontend', language: 'typescript', framework: 'React', thumbnailUrl: null, useCount: 0 },
  { id: 'nextjs', name: 'Next.js 15', slug: 'nextjs', description: 'Full-stack React framework with App Router', category: 'Full-stack', language: 'typescript', framework: 'Next.js', thumbnailUrl: null, useCount: 0 },
  { id: 'fastapi', name: 'FastAPI', slug: 'fastapi', description: 'Python REST API with automatic OpenAPI docs', category: 'Backend', language: 'python', framework: 'FastAPI', thumbnailUrl: null, useCount: 0 },
  { id: 'express', name: 'Express API', slug: 'express', description: 'Node.js REST API with TypeScript and Prisma', category: 'Backend', language: 'typescript', framework: 'Express', thumbnailUrl: null, useCount: 0 },
  { id: 'blank', name: 'Blank Project', slug: 'blank', description: 'Start from scratch', category: 'Other', language: 'typescript', framework: null, thumbnailUrl: null, useCount: 0 },
];

export function NewProjectRoute() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('react');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) { setError('Project name is required'); return; }
    
    setCreating(true);
    setError(null);

    try {
      const project = await projectClient.createProject({
        name: name.trim(),
        template: selectedTemplate !== 'blank' ? selectedTemplate : undefined,
        visibility,
      });

      // Navigate to the new project's IDE
      navigate(`/p/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setCreating(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#c9d1d9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 680 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8, color: '#f0f6fc' }}>New project</h1>
        <p style={{ color: '#8b949e', marginBottom: 32 }}>Choose a template and start building.</p>

        {/* Template grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
          {BUILT_IN_TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedTemplate(t.id)}
              style={{
                background: selectedTemplate === t.id ? 'rgba(56,139,253,0.15)' : '#161b22',
                border: `1px solid ${selectedTemplate === t.id ? '#388bfd' : '#30363d'}`,
                borderRadius: 8,
                padding: '14px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                color: '#c9d1d9',
                transition: 'border-color 0.15s',
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4, color: '#f0f6fc' }}>{t.name}</div>
              <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.4 }}>{t.description}</div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#58a6ff' }}>{t.language} · {t.category}</div>
            </button>
          ))}
        </div>

        {/* Project name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#8b949e', marginBottom: 6 }}>Project name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="my-awesome-app"
            autoFocus
            style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: '10px 12px', color: '#f0f6fc', fontSize: 14, boxSizing: 'border-box' }}
          />
        </div>

        {/* Visibility */}
        <div style={{ marginBottom: 24, display: 'flex', gap: 12 }}>
          {(['private', 'public'] as const).map(v => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#c9d1d9' }}>
              <input type="radio" checked={visibility === v} onChange={() => setVisibility(v)} />
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </label>
          ))}
        </div>

        {error && <div style={{ color: '#f85149', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          style={{
            background: creating || !name.trim() ? '#21262d' : '#238636',
            border: '1px solid rgba(240,246,252,0.1)',
            borderRadius: 6,
            padding: '10px 20px',
            color: '#c9d1d9',
            fontSize: 14,
            cursor: creating || !name.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {creating ? 'Creating…' : `Create ${selectedTemplate !== 'blank' ? BUILT_IN_TEMPLATES.find(t=>t.id===selectedTemplate)?.name : 'blank'} project`}
        </button>
      </div>
    </div>
  );
}
