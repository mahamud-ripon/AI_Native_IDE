/**
 * IndexedDB Client - Low-level database operations
 * Handles database versioning, connection management, and CRUD operations
 */

const DB_NAME = 'AI_IDE_Storage';
const DB_VERSION = 1;

export interface ProjectRecord {
  id: string;
  name: string;
  type: 'browser' | 'cloud';
  cloudProjectId?: string;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt?: number;
  syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface FileRecord {
  projectId: string;
  path: string;
  content: string;
  size: number;
  modifiedAt: number;
  hash: string;
  syncStatus: 'synced' | 'modified' | 'deleted';
}

export interface SyncQueueItem {
  id: string;
  projectId: string;
  operation: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
  timestamp: number;
  retryCount: number;
}

class IndexedDBClient {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Projects store
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectStore.createIndex('byType', 'type', { unique: false });
          projectStore.createIndex('bySyncStatus', 'syncStatus', { unique: false });
        }

        // Files store - composite key: [projectId, path]
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: ['projectId', 'path'] });
          fileStore.createIndex('byProject', 'projectId', { unique: false });
          fileStore.createIndex('bySyncStatus', 'syncStatus', { unique: false });
        }

        // Sync queue store
        if (!db.objectStoreNames.contains('syncQueue')) {
          const queueStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
          queueStore.createIndex('byProject', 'projectId', { unique: false });
          queueStore.createIndex('byTimestamp', 'timestamp', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  private async ensureDB(): Promise<IDBDatabase> {
    await this.init();
    if (!this.db) {
      throw new Error('IndexedDB not initialized');
    }
    return this.db;
  }

  // Generic CRUD operations
  async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll<T>(storeName: string, indexName?: string, key?: IDBValidKey): Promise<T[]> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const target = indexName ? store.index(indexName) : store;
      const request = key ? target.getAll(key) : target.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put<T>(storeName: string, value: T): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName: string, key: IDBValidKey): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName: string): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Project-specific operations
  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    return this.get<ProjectRecord>('projects', projectId);
  }

  async saveProject(project: ProjectRecord): Promise<void> {
    return this.put('projects', project);
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['projects', 'files', 'syncQueue'], 'readwrite');
    
    // Delete project
    transaction.objectStore('projects').delete(projectId);
    
    // Delete all files for this project
    const fileStore = transaction.objectStore('files');
    const fileIndex = fileStore.index('byProject');
    const fileRequest = fileIndex.openCursor(projectId);
    
    fileRequest.onsuccess = () => {
      const cursor = fileRequest.result;
      if (cursor) {
        fileStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    // Delete sync queue items for this project
    const queueStore = transaction.objectStore('syncQueue');
    const queueIndex = queueStore.index('byProject');
    const queueRequest = queueIndex.openCursor(projectId);
    
    queueRequest.onsuccess = () => {
      const cursor = queueRequest.result;
      if (cursor) {
        queueStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // File operations
  async getFile(projectId: string, path: string): Promise<FileRecord | undefined> {
    return this.get<FileRecord>('files', [projectId, path]);
  }

  async saveFile(file: FileRecord): Promise<void> {
    return this.put('files', file);
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    return this.delete('files', [projectId, path]);
  }

  async getProjectFiles(projectId: string): Promise<FileRecord[]> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const index = store.index('byProject');
      const request = index.getAll(projectId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Sync queue operations
  async addToSyncQueue(item: SyncQueueItem): Promise<void> {
    return this.put('syncQueue', item);
  }

  async removeFromSyncQueue(id: string): Promise<void> {
    return this.delete('syncQueue', id);
  }

  async getSyncQueue(projectId?: string): Promise<SyncQueueItem[]> {
    if (projectId) {
      const db = await this.ensureDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['syncQueue'], 'readonly');
        const store = transaction.objectStore('syncQueue');
        const index = store.index('byProject');
        const request = index.getAll(projectId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.getAll<SyncQueueItem>('syncQueue');
  }

  async clearSyncQueue(projectId?: string): Promise<void> {
    if (projectId) {
      const items = await this.getSyncQueue(projectId);
      for (const item of items) {
        await this.removeFromSyncQueue(item.id);
      }
    } else {
      await this.clear('syncQueue');
    }
  }
}

// Singleton instance
export const indexedDBClient = new IndexedDBClient();

export default indexedDBClient;
