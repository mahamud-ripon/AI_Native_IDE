/**
 * Storage Layer - IndexedDB-based file storage for browser projects
 * Exports all storage modules for easy imports
 */

export { indexedDBClient, default as db } from './indexedDBClient';
export { fileSystemDB, default as fs, SIZE_LIMITS } from './fileSystemDB';
export { syncQueue, default as queue } from './syncQueue';

export type {
  ProjectRecord,
  FileRecord,
  SyncQueueItem,
} from './indexedDBClient';
