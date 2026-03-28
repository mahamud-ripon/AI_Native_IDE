/**
 * Export to Cloud Modal - Upgrade browser project to cloud storage
 */

import * as React from 'react';
import { X, Cloud, ArrowRight, Check, Loader2 } from 'lucide-react';

interface ExportToCloudModalProps {
  isOpen: boolean;
  projectName: string;
  onClose: () => void;
  onExport: () => Promise<void>;
}

export function ExportToCloudModal({
  isOpen,
  projectName,
  onClose,
  onExport,
}: ExportToCloudModalProps) {
  const [step, setStep] = React.useState<'confirm' | 'exporting' | 'success' | 'error'>('confirm');
  const [error, setError] = React.useState('');

  if (!isOpen) return null;

  const handleExport = async () => {
    setStep('exporting');
    try {
      await onExport();
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      setStep('error');
    }
  };

  const handleClose = () => {
    setStep('confirm');
    setError('');
    onClose();
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={titleStyle}>
            <Cloud size={20} />
            <span>Export to Cloud</span>
          </div>
          <button onClick={handleClose} style={closeButtonStyle}>
            <X size={20} />
          </button>
        </div>

        <div style={contentStyle}>
          {step === 'confirm' && (
            <>
              <p style={descriptionStyle}>
                Export <strong>{projectName}</strong> to cloud storage for persistent
                access across devices.
              </p>

              <div style={benefitsStyle}>
                <h4 style={benefitsTitleStyle}>What you'll get:</h4>
                <ul style={benefitsListStyle}>
                  <li>
                    <Check size={16} />
                    Access from any device
                  </li>
                  <li>
                    <Check size={16} />
                    Persistent cloud storage
                  </li>
                  <li>
                    <Check size={16} />
                    Team collaboration features
                  </li>
                  <li>
                    <Check size={16} />
                    Automatic backups
                  </li>
                </ul>
              </div>

              <div style={actionsStyle}>
                <button onClick={handleClose} style={secondaryButtonStyle}>
                  Cancel
                </button>
                <button onClick={handleExport} style={primaryButtonStyle}>
                  Export to Cloud
                  <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}

          {step === 'exporting' && (
            <div style={centeredStyle}>
              <Loader2 size={48} style={{ ...iconStyle, animation: 'spin 1s linear infinite' }} />
              <p style={statusTextStyle}>Exporting to cloud...</p>
              <p style={subTextStyle}>This may take a moment</p>
            </div>
          )}

          {step === 'success' && (
            <div style={centeredStyle}>
              <div style={successIconStyle}>
                <Check size={32} />
              </div>
              <p style={statusTextStyle}>Successfully exported!</p>
              <p style={subTextStyle}>Your project is now stored in the cloud</p>
              <button onClick={handleClose} style={primaryButtonStyle}>
                Done
              </button>
            </div>
          )}

          {step === 'error' && (
            <div style={centeredStyle}>
              <div style={errorIconStyle}><X /></div>
              <p style={errorTextStyle}>{error}</p>
              <div style={actionsStyle}>
                <button onClick={() => setStep('confirm')} style={secondaryButtonStyle}>
                  Try Again
                </button>
                <button onClick={handleClose} style={primaryButtonStyle}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
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
  width: '480px',
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
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: '#f4f4f5',
  fontSize: '16px',
  fontWeight: 600,
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#a1a1aa',
  cursor: 'pointer',
  padding: '4px',
};

const contentStyle: React.CSSProperties = {
  padding: '24px',
};

const descriptionStyle: React.CSSProperties = {
  color: '#a1a1aa',
  fontSize: '14px',
  lineHeight: '1.6',
  marginBottom: '20px',
};

const benefitsStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '20px',
};

const benefitsTitleStyle: React.CSSProperties = {
  color: '#f4f4f5',
  fontSize: '13px',
  fontWeight: 600,
  marginBottom: '12px',
};

const benefitsListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  marginTop: '20px',
};

const primaryButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 24px',
  backgroundColor: '#3b82f6',
  border: 'none',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  backgroundColor: 'transparent',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: '8px',
  color: '#a1a1aa',
  fontSize: '14px',
  cursor: 'pointer',
};

const centeredStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
  textAlign: 'center',
};

const iconStyle: React.CSSProperties = {
  color: '#3b82f6',
  marginBottom: '16px',
};

const statusTextStyle: React.CSSProperties = {
  color: '#f4f4f5',
  fontSize: '16px',
  fontWeight: 500,
  marginBottom: '8px',
};

const subTextStyle: React.CSSProperties = {
  color: '#71717a',
  fontSize: '13px',
};

const successIconStyle: React.CSSProperties = {
  width: '64px',
  height: '64px',
  borderRadius: '50%',
  backgroundColor: 'rgba(16, 185, 129, 0.2)',
  color: '#10b981',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '16px',
};

const errorIconStyle: React.CSSProperties = {
  width: '64px',
  height: '64px',
  borderRadius: '50%',
  backgroundColor: 'rgba(239, 68, 68, 0.2)',
  color: '#ef4444',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '16px',
};

const errorTextStyle: React.CSSProperties = {
  color: '#ef4444',
  fontSize: '14px',
};

export default ExportToCloudModal;
