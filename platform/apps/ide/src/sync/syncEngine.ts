/**
 * Sync Engine - Handles cloud synchronization with debounced saves
 * Manages offline queue and conflict resolution
 */

import { syncQueue, fs } from '@/storage';
import { browserWorkspaceService } from '@/workspace/browserWorkspaceService';
import type { FileNode } from '@/stores/ideStore';

export type SyncStatus = 
  | 'synced'           // All changes synced
  | 'syncing'          // Currently syncing
  | 'offline'          // Offline, changes queued locally
  | 'conflict'         // Conflict detected
  | 'error';           // Sync failed

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt?: number;
  pendingCount: number;
  currentOperation?: string;
  error?: string;
}

export interface ConflictInfo {
  projectId: string;
  path: string;
  localContent: string;
  cloudContent: string;
  localModifiedAt: number;
  cloudModifiedAt: number;
}

class SyncEngine {
  private syncState: SyncState = {
    status: 'synced',
    pendingCount: 0,
  };
  
  private listeners: Set<(state: SyncState) => void> = new Set();
  private syncTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly DEBOUNCE_MS = 2000; // 2 second debounce
  
  // Subscribe to sync state changes
  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.syncState);
    return () => this.listeners.delete(listener);
  }
  
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.syncState));
  }
  
  private updateState(updates: Partial<SyncState>): void {
    this.syncState = { ...this.syncState, ...updates };
    this.notifyListeners();
  }
  
  // Queue file change for sync (debounced)
  queueFileChange(
    projectId: string,
    path: string,
    content: string,
    isOnline: boolean
  ): void {
    const key = `${projectId}:${path}`;
    
    // Clear existing timeout
    if (this.syncTimeouts.has(key)) {
      clearTimeout(this.syncTimeouts.get(key)!);
    }
    
    // Debounced save
    const timeout = setTimeout(async () => {
      this.syncTimeouts.delete(key);
      
      // Save to IndexedDB first
      await browserWorkspaceService.writeFile(projectId, path, content);
      
      // Queue for cloud sync
      await syncQueue.queueOperation(projectId, 'update', path, content);
      
      // Update state
      const pendingCount = (await syncQueue.getPendingOperations(projectId)).length;
      this.updateState({
        status: isOnline ? 'syncing' : 'offline',
        pendingCount,
      });
      
      // If online, trigger sync
      if (isOnline) {
        await this.syncProject(projectId);
      }
    }, this.DEBOUNCE_MS);
    
    this.syncTimeouts.set(key, timeout);
  }
  
  // Immediate sync (for explicit saves)
  async syncNow(projectId: string): Promise<{ success: boolean; error?: string }> {
    // Clear any pending debounced saves
    for (const [key, timeout] of this.syncTimeouts.entries()) {
      if (key.startsWith(`${projectId}:`)) {
        clearTimeout(timeout);
        this.syncTimeouts.delete(key);
      }
    }
    
    return this.syncProject(projectId);
  }
  
  // Sync project to cloud
  private async syncProject(projectId: string): Promise<{ success: boolean; error?: string }> {
    const project = await browserWorkspaceService.getProject(projectId);
    if (!project || !project.cloudProjectId) {
      return { success: true }; // Browser-only project, no sync needed
    }
    
    this.updateState({
      status: 'syncing',
      currentOperation: `Syncing ${project.name}...`,
    });
    
    try {
      const pendingOps = await syncQueue.getPendingOperations(projectId);
      
      for (const op of pendingOps) {
        // TODO: Call cloud API to sync
        // const result = await fileSystemClient.syncFile(...)
        
        // For now, just mark as synced
        await syncQueue.completeOperation(op.id);
      }
      
      this.updateState({
        status: 'synced',
        lastSyncedAt: Date.now(),
        pendingCount: 0,
        currentOperation: undefined,
      });
      
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Sync failed';
      this.updateState({
        status: 'error',
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }
  
  // Pull latest from cloud
  async pullFromCloud(projectId: string): Promise<{ success: boolean; conflicts: ConflictInfo[]; error?: string }> {
    const project = await browserWorkspaceService.getProject(projectId);
    if (!project || !project.cloudProjectId) {
      return { success: true, conflicts: [] };
    }
    
    this.updateState({
      status: 'syncing',
      currentOperation: 'Pulling from cloud...',
    });
    
    const conflicts: ConflictInfo[] = [];
    
    try {
      // TODO: Fetch cloud state
      // const cloudFiles = await fileSystemClient.getProjectFiles(projectId);
      
      // Check for conflicts
      const localFiles = await fs.getAllFiles(projectId);
      for (const localFile of localFiles) {
        if (localFile.syncStatus === 'modified') {
          // Local has changes - potential conflict
          // TODO: Compare with cloud version
          // if (cloudVersion.modifiedAt > localFile.lastSyncedAt) {
          //   conflicts.push({...})
          // }
        }
      }
      
      if (conflicts.length > 0) {
        this.updateState({ status: 'conflict' });
        return { success: false, conflicts };
      }
      
      this.updateState({
        status: 'synced',
        lastSyncedAt: Date.now(),
        currentOperation: undefined,
      });
      
      return { success: true, conflicts: [] };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Pull failed';
      this.updateState({
        status: 'error',
        error: errorMsg,
      });
      return { success: false, conflicts: [], error: errorMsg };
    }
  }
  
  // Resolve conflict
  async resolveConflict(
    projectId: string,
    path: string,
    resolution: 'local' | 'cloud' | 'merge',
    mergedContent?: string
  ): Promise<void> {
    if (resolution === 'local') {
      // Keep local, mark as modified
      await browserWorkspaceService.writeFile(projectId, path, mergedContent || '');
    } else if (resolution === 'cloud') {
      // Use cloud version
      // TODO: Fetch from cloud and overwrite local
    } else if (resolution === 'merge' && mergedContent) {
      // Use merged content
      await browserWorkspaceService.writeFile(projectId, path, mergedContent);
    }
    
    // Remove from conflict state if no more conflicts
    this.updateState({ status: 'synced' });
  }
  
  // Export browser project to cloud
  async exportToCloud(projectId: string, cloudProjectId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Update project to reference cloud
      await browserWorkspaceService.exportToCloud(projectId, cloudProjectId);
      
      // Sync all files to cloud
      return this.syncProject(projectId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      };
    }
  }
  
  // Get current sync state
  getState(): SyncState {
    return this.syncState;
  }
  
  // Clear error state
  clearError(): void {
    this.updateState({ status: 'synced', error: undefined });
  }
}

// Singleton instance
export const syncEngine = new SyncEngine();

export default syncEngine;
