import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useGitStore, type FileStatus } from '../../state/gitStore';
import { DiffPanel } from './DiffPanel';
import styles from './Panel.module.css';

function statusIcon(status: FileStatus): string {
  switch (status) {
    case 'modified':
      return 'M';
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'untracked':
      return 'U';
    default:
      return '?';
  }
}

function statusColor(status: FileStatus): string {
  switch (status) {
    case 'modified':
      return '#d4a017';
    case 'added':
      return '#4ecdc4';
    case 'deleted':
      return '#ff6b6b';
    case 'untracked':
      return '#888';
    default:
      return '#888';
  }
}

export function SourceControlPanel() {
  const { projectId } = useParams();
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranch, setShowNewBranch] = useState(false);

  const {
    isRepo,
    branch,
    branches,
    changes,
    commitMessage,
    loading,
    error,
    diff,
    diffLoading,
    refresh,
    setCommitMessage,
    stageFile,
    stageAll,
    commit,
    checkoutBranch,
    createBranch,
    loadDiff,
    closeDiff,
    clearError,
  } = useGitStore();

  const dir = useMemo(() => (projectId ? `/${projectId}` : '/'), [projectId]);

  // Refresh git status on mount and when project changes
  useEffect(() => {
    refresh(dir);
  }, [dir, refresh]);

  const stagedChanges = useMemo(() => changes.filter(c => c.staged), [changes]);
  const unstagedChanges = useMemo(() => changes.filter(c => !c.staged), [changes]);

  const handleCommit = async () => {
    const sha = await commit(dir);
    if (sha) {
      console.log('Committed:', sha);
    }
  };

  const handleCreateBranch = async () => {
    if (newBranchName.trim()) {
      await createBranch(dir, newBranchName.trim());
      setNewBranchName('');
      setShowNewBranch(false);
    }
  };

  if (!isRepo) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>Source Control</div>
        <div className={styles.panelBody}>
          <div style={{ padding: 16, color: '#888' }}>
            <p>No Git repository detected.</p>
            <p style={{ fontSize: 12, marginTop: 8 }}>
              Clone a repository or initialize one to enable source control.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        Source Control — {branch || 'unknown'}
      </div>
      <div className={styles.panelBody} style={{ padding: 8, overflowY: 'auto' }}>
        {/* Error display */}
        {error && (
          <div
            style={{
              background: '#ff6b6b22',
              border: '1px solid #ff6b6b',
              borderRadius: 4,
              padding: 8,
              marginBottom: 8,
              fontSize: 12,
            }}
          >
            {error}
            <button
              onClick={clearError}
              style={{ marginLeft: 8, background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Branch selector */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Branches</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {branches.map(b => (
              <button
                key={b.name}
                onClick={() => b.current ? null : checkoutBranch(dir, b.name)}
                style={{
                  background: b.current ? '#4ecdc4' : '#333',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 11,
                  color: b.current ? '#000' : '#fff',
                  cursor: b.current ? 'default' : 'pointer',
                }}
              >
                {b.name}
              </button>
            ))}
            <button
              onClick={() => setShowNewBranch(!showNewBranch)}
              style={{
                background: '#333',
                border: '1px dashed #555',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 11,
                color: '#888',
                cursor: 'pointer',
              }}
            >
              + New
            </button>
          </div>
          {showNewBranch && (
            <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
              <input
                type="text"
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                placeholder="branch name"
                style={{
                  flex: 1,
                  background: '#222',
                  border: '1px solid #444',
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 11,
                  color: '#fff',
                }}
              />
              <button
                onClick={handleCreateBranch}
                style={{
                  background: '#4ecdc4',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 11,
                  color: '#000',
                  cursor: 'pointer',
                }}
              >
                Create
              </button>
            </div>
          )}
        </div>

        {/* Commit message and button */}
        <div style={{ marginBottom: 12 }}>
          <textarea
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            placeholder="Commit message..."
            style={{
              width: '100%',
              background: '#222',
              border: '1px solid #444',
              borderRadius: 4,
              padding: 8,
              fontSize: 12,
              color: '#fff',
              resize: 'vertical',
              minHeight: 60,
            }}
          />
          <button
            onClick={handleCommit}
            disabled={stagedChanges.length === 0 || !commitMessage.trim() || loading}
            style={{
              width: '100%',
              marginTop: 4,
              background: stagedChanges.length > 0 && commitMessage.trim() ? '#4ecdc4' : '#333',
              border: 'none',
              borderRadius: 4,
              padding: 8,
              fontSize: 12,
              color: stagedChanges.length > 0 && commitMessage.trim() ? '#000' : '#888',
              cursor: stagedChanges.length > 0 && commitMessage.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Commit ({stagedChanges.length} staged)
          </button>
        </div>

        {/* Staged changes */}
        {stagedChanges.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>Staged Changes</span>
            </div>
            {stagedChanges.map(change => (
              <div
                key={change.path}
                onClick={() => loadDiff(dir, change.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px 8px',
                  background: '#1a1a1a',
                  borderRadius: 4,
                  marginBottom: 2,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 2,
                    background: statusColor(change.status),
                    color: '#000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 'bold',
                    marginRight: 8,
                  }}
                >
                  {statusIcon(change.status)}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {change.path}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Unstaged changes */}
        {unstagedChanges.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>Changes</span>
              <button
                onClick={() => stageAll(dir)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#4ecdc4',
                  cursor: 'pointer',
                  fontSize: 10,
                }}
              >
                Stage All
              </button>
            </div>
            {unstagedChanges.map(change => (
              <div
                key={change.path}
                onClick={() => loadDiff(dir, change.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px 8px',
                  background: '#1a1a1a',
                  borderRadius: 4,
                  marginBottom: 2,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 2,
                    background: statusColor(change.status),
                    color: '#000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 'bold',
                    marginRight: 8,
                  }}
                >
                  {statusIcon(change.status)}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {change.path}
                </span>
                <button
                  onClick={() => stageFile(dir, change.path)}
                  style={{
                    background: '#333',
                    border: 'none',
                    borderRadius: 2,
                    padding: '2px 6px',
                    fontSize: 10,
                    color: '#4ecdc4',
                    cursor: 'pointer',
                  }}
                >
                  Stage
                </button>
              </div>
            ))}
          </div>
        )}

        {/* No changes */}
        {changes.length === 0 && !loading && (
          <div style={{ textAlign: 'center', color: '#888', fontSize: 12, padding: 16 }}>
            No changes detected
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div style={{ textAlign: 'center', color: '#888', fontSize: 12, padding: 16 }}>
            Loading...
          </div>
        )}
      </div>

      {/* Diff Panel overlay */}
      {diff && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: '#1a1a1a',
          zIndex: 10,
        }}>
          <DiffPanel
            originalContent={diff.original}
            modifiedContent={diff.modified}
            filename={diff.path}
            isBinary={diff.isBinary}
            isLarge={diff.isLarge}
            onClose={closeDiff}
          />
        </div>
      )}

      {/* Diff loading overlay */}
      {diffLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}>
          <div style={{ color: '#888', fontSize: 12 }}>Loading diff...</div>
        </div>
      )}
    </div>
  );
}
