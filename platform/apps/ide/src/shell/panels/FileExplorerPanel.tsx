import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import type { WorkspaceFileEntry } from '../../workspace/fileRegistry';
import { workspaceService } from '../../workspace/workspaceService';
import { workspaceSocket } from '../../services/workspaceSocket';
import { editorModelManager } from '../../core/editor/modelManager';
import styles from './Panel.module.css';

export function FileExplorerPanel() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadFiles = useCallback(async () => {
    const pid = projectId ?? 'demo';
    const result = await workspaceService.listFiles(pid);
    setFiles(result);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    loadFiles().then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [loadFiles, refreshKey]);

  // Subscribe to workspace file events for real-time updates
  useEffect(() => {
    if (!projectId) return;

    const pid = projectId ?? 'demo';
    
    // Connect to workspace WebSocket
    workspaceSocket.connect(pid).catch(console.error);

    // Subscribe to file events
    const unsubscribe = workspaceSocket.subscribe((event) => {
      if (event.projectId === pid) {
        console.log('File event received:', event.eventType, event.filePath);
        
        // Refresh file tree for all file events
        setRefreshKey(k => k + 1);
        
        // Reload Monaco model if file was modified and is currently open
        if (event.eventType === 'file.modified' && event.filePath) {
          editorModelManager.reloadModel(pid, event.filePath).catch(console.error);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [projectId]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>File Explorer</div>
      <div className={styles.panelBody}>
        <div>
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: 8,
                color: 'inherit',
                cursor: 'pointer'
              }}
              onClick={() => {
                const pid = projectId ?? 'demo';
                navigate(`/p/${encodeURIComponent(pid)}/f/${f.path}`);
              }}
            >
              {f.path}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
