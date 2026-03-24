import * as Y from 'yjs';
import { redis, RedisKeys } from '../lib/redis.js';
import { config } from '../config.js';

// In-memory document cache
const DOC_CACHE = new Map<string, Y.Doc>();
const DOC_UPDATE_COUNT = new Map<string, number>();

// GC threshold - compact every 1000 updates
const GC_THRESHOLD = 1000;

export const YjsManager = {
  /**
   * Get or create a Y.Doc for a file
   * Loads from Redis if not in memory
   */
  async getYDoc(fileId: string): Promise<Y.Doc> {
    // Check memory cache first
    if (DOC_CACHE.has(fileId)) {
      return DOC_CACHE.get(fileId)!;
    }

    // Check Redis for persisted state
    const persistedState = await redis.get(RedisKeys.yjsDoc(fileId));
    
    const ydoc = new Y.Doc();
    
    if (persistedState) {
      try {
        const update = Buffer.from(persistedState, 'base64');
        Y.applyUpdate(ydoc, new Uint8Array(update));
        console.log(`[YjsManager] Loaded doc ${fileId} from Redis`);
      } catch (error: any) {
        console.warn(`[YjsManager] Failed to load doc ${fileId}:`, error.message);
      }
    }

    // Manage cache size
    if (DOC_CACHE.size >= config.maxCachedDocs) {
      const oldestKey = DOC_CACHE.keys().next().value;
      if (oldestKey) {
        await YjsManager.unloadDoc(oldestKey);
      }
    }
    
    DOC_CACHE.set(fileId, ydoc);
    DOC_UPDATE_COUNT.set(fileId, 0);

    return ydoc;
  },

  /**
   * Get current state as binary
   */
  async getYDocState(fileId: string): Promise<Buffer | null> {
    const ydoc = await YjsManager.getYDoc(fileId);
    const state = Y.encodeStateAsUpdate(ydoc);
    return Buffer.from(state);
  },

  /**
   * Get document text content (for Monaco editor)
   */
  async getYDocText(fileId: string): Promise<string> {
    const ydoc = await YjsManager.getYDoc(fileId);
    return ydoc.getText('monaco').toString();
  },

  /**
   * Apply an update to a document
   */
  async applyUpdate(fileId: string, update: Uint8Array): Promise<void> {
    const ydoc = await YjsManager.getYDoc(fileId);
    Y.applyUpdate(ydoc, update);
    
    // Track update count for GC
    const count = (DOC_UPDATE_COUNT.get(fileId) || 0) + 1;
    DOC_UPDATE_COUNT.set(fileId, count);
    
    // Persist to Redis
    const state = Y.encodeStateAsUpdate(ydoc);
    await redis.set(
      RedisKeys.yjsDoc(fileId),
      Buffer.from(state).toString('base64'),
      'EX',
      config.docTtl
    );

    // Run GC if threshold reached
    if (count >= GC_THRESHOLD) {
      await YjsManager.runGarbageCollection(fileId);
    }
  },

  /**
   * Flush document to PostgreSQL (called by PostgresSync)
   */
  async flushToPostgres(fileId: string): Promise<string> {
    const ydoc = await YjsManager.getYDoc(fileId);
    const text = ydoc.getText('monaco').toString();
    return text;
  },

  /**
   * Run CRDT garbage collection
   * Squashes history to keep binary size under control while preserving event observers
   */
  async runGarbageCollection(fileId: string): Promise<void> {
    const ydoc = DOC_CACHE.get(fileId);
    if (!ydoc) return;

    // Capture all event observers from the old doc before replacing it
    const textObservers = (ydoc.getText('monaco') as any)._eH?.l || [];
    const docObservers = (ydoc as any)._eH?.l || [];

    // Encode current state (this squashes all history)
    const state = Y.encodeStateAsUpdate(ydoc);
    
    // Create new doc with just the current state
    const newDoc = new Y.Doc();
    Y.applyUpdate(newDoc, state);
    
    // Re-attach observers to the new doc's text type to preserve awareness synchronization
    const newText = newDoc.getText('monaco');
    for (const observer of textObservers) {
      newText.observe(observer);
    }
    for (const observer of docObservers) {
      newDoc.on('update', observer);
    }
    
    // Replace in cache
    DOC_CACHE.set(fileId, newDoc);
    DOC_UPDATE_COUNT.set(fileId, 0);
    
    // Persist compacted state
    await redis.set(
      RedisKeys.yjsDoc(fileId),
      Buffer.from(state).toString('base64'),
      'EX',
      config.docTtl
    );

    console.log(`[YjsManager] GC completed for ${fileId}, size: ${state.length} bytes, observers preserved: ${textObservers.length + docObservers.length}`);
  },

  /**
   * Remove document from memory (when all users leave)
   */
  async unloadDoc(fileId: string): Promise<void> {
    const ydoc = DOC_CACHE.get(fileId);
    if (ydoc) {
      // Persist final state
      const state = Y.encodeStateAsUpdate(ydoc);
      await redis.set(
        RedisKeys.yjsDoc(fileId),
        Buffer.from(state).toString('base64'),
        'EX',
        config.docTtl
      );
      
      DOC_CACHE.delete(fileId);
      DOC_UPDATE_COUNT.delete(fileId);
      console.log(`[YjsManager] Unloaded doc ${fileId}`);
    }
  },

  /**
   * Delete document completely (file deleted)
   */
  async deleteDoc(fileId: string): Promise<void> {
    DOC_CACHE.delete(fileId);
    DOC_UPDATE_COUNT.delete(fileId);
    await redis.del(RedisKeys.yjsDoc(fileId));
    await redis.del(RedisKeys.fileUsers(fileId));
    console.log(`[YjsManager] Deleted doc ${fileId}`);
  },

  /**
   * Get active document count
   */
  getActiveDocCount(): number {
    return DOC_CACHE.size;
  },

  /**
   * Get all cached file IDs
   */
  getCachedFileIds(): string[] {
    return Array.from(DOC_CACHE.keys());
  },

  /**
   * Get document size in bytes
   */
  getDocSize(fileId: string): number {
    const ydoc = DOC_CACHE.get(fileId);
    if (!ydoc) return 0;
    const state = Y.encodeStateAsUpdate(ydoc);
    return state.length;
  }
};
