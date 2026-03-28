/**
 * Conflict Resolution Modal - Simple UI for resolving file conflicts
 * Shows side-by-side comparison with resolution options
 */

import * as React from 'react';
import { X, GitMerge, Cloud, HardDrive } from 'lucide-react';
import type { ConflictInfo } from '@/sync/syncEngine';

interface ConflictResolutionModalProps {
  isOpen: boolean;
  conflicts: ConflictInfo[];
  projectName: string;
  onResolve: (conflictIndex: number, resolution: 'local' | 'cloud' | 'merge', mergedContent?: string) => void;
  onClose: () => void;
}

export function ConflictResolutionModal({
  isOpen,
  conflicts,
  projectName,
  onResolve,
  onClose,
}: ConflictResolutionModalProps) {
  const [selectedConflict, setSelectedConflict] = React.useState(0);
  const [viewMode, setViewMode] = React.useState<'split' | 'local' | 'cloud'>('split');

  if (!isOpen || conflicts.length === 0) return null;

  const currentConflict = conflicts[selectedConflict];

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={titleStyle}>
            <GitMerge size={20} />
            <span>Sync Conflict Detected</span>
          </div>
          <button onClick={onClose} style={closeButtonStyle}>
            <X size={20} />
          </button>
        </div>

        {/* Progress */}
        <div style={progressStyle}>
          <span>Conflict {selectedConflict + 1} of {conflicts.length}</span>
          <div style={progressBarStyle}>
            <div
              style={{
                ...progressFillStyle,
                width: `${((selectedConflict + 1) / conflicts.length) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Conflict Details */}
        <div style={contentStyle}>
          <div style={filePathStyle}>{currentConflict.path}</div>

          {/* View Toggle */}
          <div style={toggleStyle}>
            <button
              onClick={() => setViewMode('split')}
              style={viewMode === 'split' ? activeToggleStyle : toggleButtonStyle}
            >
              Side by Side
            </button>
            <button
              onClick={() => setViewMode('local')}
              style={viewMode === 'local' ? activeToggleStyle : toggleButtonStyle}
            >
              Local Only
            </button>
            <button
              onClick={() => setViewMode('cloud')}
              style={viewMode === 'cloud' ? activeToggleStyle : toggleButtonStyle}
            >
              Cloud Only
            </button>
          </div>

          {/* Diff View */}
          <div style={diffContainerStyle}>
            {(viewMode === 'split' || viewMode === 'local') && (
              <div style={panelStyle}>
                <div style={panelHeaderStyle('local')}>
                  <HardDrive size={14} />
                  <span>Local Version</span>
                  <span style={timestampStyle}>
                    {new Date(currentConflict.localModifiedAt).toLocaleString()}
                  </span>
                </div>
                <pre style={codeBlockStyle}>{currentConflict.localContent}</pre>
              </div>
            )}

            {(viewMode === 'split' || viewMode === 'cloud') && (
              <div style={panelStyle}>
                <div style={panelHeaderStyle('cloud')}>
                  <Cloud size={14} />
                  <span>Cloud Version</span>
                  <span style={timestampStyle}>
                    {new Date(currentConflict.cloudModifiedAt).toLocaleString()}
                  </span>
                </div>
                <pre style={codeBlockStyle}>{currentConflict.cloudContent}</pre>
              </div>
            )}
          </div>
        </div>

        {/* Resolution Actions */}
        <div style={actionsStyle}>
          <button
            onClick={() => onResolve(selectedConflict, 'local')}
            style={resolveButtonStyle('local')}
          >
            <HardDrive size={16} />
            Keep Local
          </button>

          <button
            onClick={() => onResolve(selectedConflict, 'merge', currentConflict.localContent)}
            style={mergeButtonStyle}
          >
            <GitMerge size={16} />
            Merge Changes
          </button>

          <button
            onClick={() => onResolve(selectedConflict, 'cloud')}
            style={resolveButtonStyle('cloud')}
          >
            <Cloud size={16} />
            Use Cloud
          </button>
        </div>

        {/* Navigation */}
        <div style={navigationStyle}>
          <button
            onClick={() => setSelectedConflict(Math.max(0, selectedConflict - 1))}
            disabled={selectedConflict === 0}
            style={navButtonStyle}
          >
            Previous
          </button>
          <span style={navTextStyle}>
            {selectedConflict + 1} / {conflicts.length}
          </span>
          <button
            onClick={() => setSelectedConflict(Math.min(conflicts.length - 1, selectedConflict + 1))}
            disabled={selectedConflict === conflicts.length - 1}
            style={navButtonStyle}
          >
            Next
          </button>
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
  width: '900px',
  maxWidth: '95vw',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid rgba(255, 255, 255, 0.1)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
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

const progressStyle: React.CSSProperties = {
  padding: '12px 20px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  color: '#a1a1aa',
  fontSize: '13px',
};

const progressBarStyle: React.CSSProperties = {
  width: '100%',
  height: '4px',
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  borderRadius: '2px',
  marginTop: '8px',
};

const progressFillStyle: React.CSSProperties = {
  height: '100%',
  backgroundColor: '#3b82f6',
  borderRadius: '2px',
  transition: 'width 0.3s ease',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  padding: '20px',
  overflow: 'auto',
};

const filePathStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#f4f4f5',
  fontFamily: 'monospace',
  marginBottom: '16px',
  padding: '8px 12px',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  borderRadius: '6px',
};

const toggleStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '16px',
};

const toggleButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '6px',
  color: '#a1a1aa',
  fontSize: '13px',
  cursor: 'pointer',
};

const activeToggleStyle: React.CSSProperties = {
  ...toggleButtonStyle,
  backgroundColor: '#3b82f6',
  color: '#fff',
  borderColor: '#3b82f6',
};

const diffContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  height: '400px',
};

const panelStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: '8px',
  overflow: 'hidden',
  border: '1px solid rgba(255, 255, 255, 0.1)',
};

const panelHeaderStyle = (type: 'local' | 'cloud'): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 14px',
  backgroundColor: type === 'local' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
  color: type === 'local' ? '#10b981' : '#3b82f6',
  fontSize: '13px',
  fontWeight: 500,
});

const timestampStyle: React.CSSProperties = {
  marginLeft: 'auto',
  color: '#71717a',
  fontSize: '11px',
};

const codeBlockStyle: React.CSSProperties = {
  flex: 1,
  margin: 0,
  padding: '12px',
  backgroundColor: '#0d1117',
  color: '#c9d1d9',
  fontSize: '12px',
  fontFamily: "'JetBrains Mono', monospace",
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  padding: '16px 20px',
  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
  justifyContent: 'center',
};

const resolveButtonStyle = (type: 'local' | 'cloud'): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 20px',
  backgroundColor: type === 'local' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
  border: `1px solid ${type === 'local' ? '#10b981' : '#3b82f6'}`,
  borderRadius: '8px',
  color: type === 'local' ? '#10b981' : '#3b82f6',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
});

const mergeButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 20px',
  backgroundColor: '#3b82f6',
  border: '1px solid #3b82f6',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};

const navigationStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: '16px',
  padding: '12px 20px',
  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
};

const navButtonStyle: React.CSSProperties = {
  padding: '6px 16px',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '6px',
  color: '#f4f4f5',
  fontSize: '13px',
  cursor: 'pointer',
};

const navTextStyle: React.CSSProperties = {
  color: '#71717a',
  fontSize: '13px',
};

export default ConflictResolutionModal;
