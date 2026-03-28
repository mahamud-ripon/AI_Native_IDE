/**
 * Sync Queue - Manages offline operations queue
 * Queues file changes when offline, processes them when online
 */

import indexedDBClient, { SyncQueueItem } from './indexedDBClient';

type SyncStatus = 'idle' | 'syncing' | 'error';

interface SyncState {
  status: SyncStatus;
  lastSyncAt?: number;
  pendingCount: number;
  error?: string;
}

class SyncQueue {
  private listeners: Set<(state: SyncState) => void> = new Set();
  private currentState: SyncState = {
    status: 'idle',
    pendingCount: 0,
  };

  // Subscribe to sync state changes
  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.currentState));
  }

  private updateState(updates: Partial<SyncState>): void {
    this.currentState = { ...this.currentState, ...updates };
    this.notifyListeners();
  }

  // Generate unique ID
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Queue a file operation
  async queueOperation(
    projectId: string,
    operation: 'create' | 'update' | 'delete',
    path: string,
    content?: string
  ): Promise<void> {
    // Check if there's already a pending operation for this file
    const existingItems = await indexedDBClient.getSyncQueue(projectId);
    const existingItem = existingItems.find(item => item.path === path);

    if (existingItem) {
      // Update existing item
      if (operation === 'delete') {
        // If deleting, remove any previous operations
        await indexedDBClient.removeFromSyncQueue(existingItem.id);
      } else {
        // Update the existing operation
        const updatedItem: SyncQueueItem = {
          ...existingItem,
          operation,
          content,
          timestamp: Date.now(),
        };
        await indexedDBClient.addToSyncQueue(updatedItem);
      }
    }

    // Add new operation
    const item: SyncQueueItem = {
      id: this.generateId(),
      projectId,
      operation,
      path,
      content,
      timestamp: Date.now(),
      retryCount: 0,
    };

    await indexedDBClient.addToSyncQueue(item);
    
    // Update state
    const pendingItems = await indexedDBClient.getSyncQueue();
    this.updateState({ pendingCount: pendingItems.length });
  }

  // Get pending operations for a project
  async getPendingOperations(projectId?: string): Promise<SyncQueueItem[]> {
    return indexedDBClient.getSyncQueue(projectId);
  }

  // Mark operation as complete (remove from queue)
  async completeOperation(id: string): Promise<void> {
    await indexedDBClient.removeFromSyncQueue(id);
    
    const pendingItems = await indexedDBClient.getSyncQueue();
    this.updateState({ 
      pendingCount: pendingItems.length,
      status: pendingItems.length > 0 ? 'syncing' : 'idle',
    });
  }

  // Increment retry count
  async incrementRetry(id: string): Promise<void> {
    const items = await indexedDBClient.getSyncQueue();
    const item = items.find(i => i.id === id);
    
    if (item) {
      const updatedItem: SyncQueueItem = {
        ...item,
        retryCount: item.retryCount + 1,
      };
      await indexedDBClient.addToSyncQueue(updatedItem);
    }
  }

  // Clear all pending operations
  async clearQueue(projectId?: string): Promise<void> {
    await indexedDBClient.clearSyncQueue(projectId);
    this.updateState({ pendingCount: 0, status: 'idle' });
  }

  // Get queue stats
  async getStats(): Promise<{ total: number; byProject: Record<string, number> }> {
    const items = await indexedDBClient.getSyncQueue();
    const byProject: Record<string, number> = {};
    
    for (const item of items) {
      byProject[item.projectId] = (byProject[item.projectId] || 0) + 1;
    }
    
    return {
      total: items.length,
      byProject,
    };
  }

  // Set syncing state
  setSyncing(isSyncing: boolean): void {
    this.updateState({ 
      status: isSyncing ? 'syncing' : (this.currentState.pendingCount > 0 ? 'idle' : 'idle'),
    });
  }

  // Set error state
  setError(error: string): void {
    this.updateState({ status: 'error', error });
  }

  // Clear error
  clearError(): void {
    this.updateState({ status: 'idle', error: undefined });
  }

  // Get current state
  getState(): SyncState {
    return this.currentState;
  }
}

// Singleton instance
export const syncQueue = new SyncQueue();

export default syncQueue;
