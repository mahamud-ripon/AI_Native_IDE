import * as Y from 'yjs';
import { redis, RedisKeys } from '../lib/redis.js';
import { config } from '../config.js';

const YJS_DOC_PREFIX = 'yjs:doc:';

export const RedisPersistence = {
  /**
   * Save document state to Redis
   */
  async saveDoc(fileId: string, state: Uint8Array): Promise<void> {
    const key = RedisKeys.yjsDoc(fileId);
    await redis.set(
      key,
      Buffer.from(state).toString('base64'),
      'EX',
      config.docTtl
    );
  },

  /**
   * Load document state from Redis
   */
  async loadDoc(fileId: string): Promise<Uint8Array | null> {
    const key = RedisKeys.yjsDoc(fileId);
    const data = await redis.get(key);
    
    if (!data) return null;
    
    const buffer = Buffer.from(data, 'base64');
    return new Uint8Array(buffer);
  },

  /**
   * Append update to document (merge with existing state)
   */
  async appendUpdate(fileId: string, update: Uint8Array): Promise<void> {
    const existingDoc = await RedisPersistence.loadDoc(fileId);
    
    const ydoc = new Y.Doc();
    
    if (existingDoc) {
      Y.applyUpdate(ydoc, existingDoc);
    }
    
    Y.applyUpdate(ydoc, update);
    const newState = Y.encodeStateAsUpdate(ydoc);
    
    await RedisPersistence.saveDoc(fileId, newState);
  },

  /**
   * Delete document from Redis
   */
  async deleteDoc(fileId: string): Promise<void> {
    await redis.del(RedisKeys.yjsDoc(fileId));
    await redis.del(RedisKeys.fileUsers(fileId));
    await redis.del(RedisKeys.awareness(fileId));
  },

  /**
   * Get all active document IDs
   */
  async getActiveDocs(): Promise<string[]> {
    const keys = await redis.keys(`${YJS_DOC_PREFIX}*`);
    return keys.map(k => k.replace(YJS_DOC_PREFIX, ''));
  },

  /**
   * Check if document exists
   */
  async docExists(fileId: string): Promise<boolean> {
    const exists = await redis.exists(RedisKeys.yjsDoc(fileId));
    return exists === 1;
  },

  /**
   * Get document size in bytes
   */
  async getDocSize(fileId: string): Promise<number> {
    const data = await redis.get(RedisKeys.yjsDoc(fileId));
    if (!data) return 0;
    return Buffer.byteLength(data, 'base64');
  }
};
