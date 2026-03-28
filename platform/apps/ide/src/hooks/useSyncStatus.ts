/**
 * useSyncStatus Hook - Monitor sync state and status
 * Returns current sync status, pending count, and last sync time
 */

import { useState, useEffect } from 'react';
import { syncEngine, type SyncState } from '@/sync/syncEngine';

export function useSyncStatus() {
  const [state, setState] = useState<SyncState>(syncEngine.getState());
  
  useEffect(() => {
    return syncEngine.subscribe((newState) => {
      setState(newState);
    });
  }, []);
  
  const syncNow = async (projectId: string) => {
    return syncEngine.syncNow(projectId);
  };
  
  const pullFromCloud = async (projectId: string) => {
    return syncEngine.pullFromCloud(projectId);
  };
  
  const clearError = () => {
    syncEngine.clearError();
  };
  
  return {
    ...state,
    isSynced: state.status === 'synced',
    isSyncing: state.status === 'syncing',
    isOffline: state.status === 'offline',
    hasError: state.status === 'error',
    hasConflict: state.status === 'conflict',
    syncNow,
    pullFromCloud,
    clearError,
  };
}

export default useSyncStatus;
