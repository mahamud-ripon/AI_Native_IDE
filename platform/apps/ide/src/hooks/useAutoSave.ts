/**
 * useAutoSave Hook - Debounced auto-save with 2 second delay
 * Automatically saves file changes to IndexedDB
 */

import { useCallback, useRef } from 'react';
import { syncEngine } from '@/sync/syncEngine';
import { useNetworkStatus } from './useNetworkStatus';

export interface AutoSaveOptions {
  projectId: string;
  filePath: string;
  debounceMs?: number;
}

export interface AutoSaveState {
  isSaving: boolean;
  lastSavedAt?: number;
  error?: string;
}

export function useAutoSave() {
  const { isOnline } = useNetworkStatus();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContentRef = useRef<string>('');
  
  const queueSave = useCallback((
    projectId: string,
    filePath: string,
    content: string,
    debounceMs: number = 2000
  ): void => {
    // Don't save if content hasn't changed
    if (content === lastContentRef.current) {
      return;
    }
    lastContentRef.current = content;
    
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Debounced save
    saveTimeoutRef.current = setTimeout(() => {
      syncEngine.queueFileChange(projectId, filePath, content, isOnline);
    }, debounceMs);
  }, [isOnline]);
  
  const saveImmediately = useCallback(async (
    projectId: string
  ): Promise<{ success: boolean; error?: string }> => {
    // Clear pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    
    return syncEngine.syncNow(projectId);
  }, []);
  
  const cancelPendingSave = useCallback((): void => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  }, []);
  
  return {
    queueSave,
    saveImmediately,
    cancelPendingSave,
  };
}

export default useAutoSave;
