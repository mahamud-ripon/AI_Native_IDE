/**
 * New Project Modal - Choose between browser (local) and cloud projects
 */

import * as React from 'react';
import { X, HardDrive, Cloud, Laptop, Globe, Info } from 'lucide-react';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (name: string, type: 'browser' | 'cloud') => void;
}

export function NewProjectModal({
  isOpen,
  onClose,
  onCreateProject,
}: NewProjectModalProps) {
  const [projectName, setProjectName] = React.useState('');
  const [selectedType, setSelectedType] = React.useState<'browser' | 'cloud'>('browser');
  const [isLoading, setIsLoading] = React.useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim() || isLoading) return;

    setIsLoading(true);
    await onCreateProject(projectName.trim(), selectedType);
    setIsLoading(false);
    setProjectName('');
    onClose();
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>Create New Project</h2>
          <button onClick={onClose} style={closeButtonStyle}>
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={formStyle}>
            {/* Project Name Input */}
            <div style={inputGroupStyle}>
              <label style={labelStyle}>Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-awesome-project"
                style={inputStyle}
                autoFocus
              />
            </div>

            {/* Project Type Selection */}
            <div style={inputGroupStyle}>
              <label style={labelStyle}>Storage Type</label>
              
              <div style={optionsContainerStyle}>
                {/* Browser Project Option */}
                <button
                  type="button"
                  onClick={() => setSelectedType('browser')}
                  style={selectedType === 'browser' ? selectedOptionStyle : optionStyle}
                >
                  <div style={optionHeaderStyle}>
                    <div style={optionIconStyle('browser')}>
                      <Laptop size={20} />
                    </div>
                    <div style={optionTitleStyle}>
                      Browser Project
                      <span style={recommendedBadgeStyle}>Recommended</span>
                    </div>
                  </div>
                  
                  <ul style={featuresListStyle}>
                    <li><HardDrive size={14} /> Works offline</li>
                    <li><Laptop size={14} /> Fast local editing</li>
                    <li><Cloud size={14} /> Auto-sync to cloud</li>
                    <li><Info size={14} /> 100MB limit (Free)</li>
                  </ul>
                </button>

                {/* Cloud Project Option */}
                <button
                  type="button"
                  onClick={() => setSelectedType('cloud')}
                  style={selectedType === 'cloud' ? selectedOptionStyle : optionStyle}
                >
                  <div style={optionHeaderStyle}>
                    <div style={optionIconStyle('cloud')}>
                      <Cloud size={20} />
                    </div>
                    <div style={optionTitleStyle}>Cloud Project</div>
                  </div>
                  
                  <ul style={featuresListStyle}>
                    <li><Globe size={14} /> Access from any device</li>
                    <li><Cloud size={14} /> Persistent cloud storage</li>
                    <li><HardDrive size={14} /> Team collaboration</li>
                    <li><Info size={14} /> 1GB limit (Free)</li>
                  </ul>
                </button>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={actionsStyle}>
            <button
              type="button"
              onClick={onClose}
              style={cancelButtonStyle}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!projectName.trim() || isLoading}
              style={submitButtonStyle}
            >
              {isLoading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Styles
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  backgroundColor: '#18181b',
  borderRadius: '12px',
  width: '520px',
  maxWidth: '95vw',
  border: '1px solid rgba(255, 255, 255, 0.1)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '20px 24px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  color: '#f4f4f5',
  fontSize: '18px',
  fontWeight: 600,
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#a1a1aa',
  cursor: 'pointer',
  padding: '4px',
};

const formStyle: React.CSSProperties = {
  padding: '24px',
};

const inputGroupStyle: React.CSSProperties = {
  marginBottom: '20px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  color: '#a1a1aa',
  fontSize: '13px',
  fontWeight: 500,
  marginBottom: '8px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  backgroundColor: '#0d1117',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '8px',
  color: '#f4f4f5',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
};

const optionsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const optionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '16px',
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '10px',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'all 0.2s',
};

const selectedOptionStyle: React.CSSProperties = {
  ...optionStyle,
  backgroundColor: 'rgba(59, 130, 246, 0.1)',
  borderColor: '#3b82f6',
};

const optionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '12px',
};

const optionIconStyle = (type: 'browser' | 'cloud'): React.CSSProperties => ({
  width: '40px',
  height: '40px',
  borderRadius: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: type === 'browser' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)',
  color: type === 'browser' ? '#10b981' : '#3b82f6',
});

const optionTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  color: '#f4f4f5',
  fontSize: '15px',
  fontWeight: 600,
};

const recommendedBadgeStyle: React.CSSProperties = {
  backgroundColor: '#10b981',
  color: '#fff',
  fontSize: '10px',
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: '4px',
  textTransform: 'uppercase',
};

const featuresListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '8px',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  padding: '20px 24px',
  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  backgroundColor: 'transparent',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: '8px',
  color: '#a1a1aa',
  fontSize: '14px',
  cursor: 'pointer',
};

const submitButtonStyle: React.CSSProperties = {
  padding: '10px 24px',
  backgroundColor: '#3b82f6',
  border: 'none',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};

export default NewProjectModal;
