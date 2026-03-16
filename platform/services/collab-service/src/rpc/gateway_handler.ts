import * as Y from 'yjs';
import Redis from 'ioredis';
import { redis, RedisKeys, createSubscriber } from '../lib/redis.js';
import { YjsManager } from '../core/yjs_manager.js';
import { AwarenessManager } from '../core/awareness_manager.js';
import { PostgresSync } from '../persistence/postgres_sync.js';
import type { JoinPayload, UpdatePayload, AwarenessPayload, LeavePayload, UserPresence } from '../lib/types.js';

// Track subscribers per file
const fileSubscribers = new Map<string, Redis>();

export const GatewayHandler = {
  /**
   * Handle user joining a file
   * Returns full document state for initial sync
   */
  async onUserJoinFile(data: JoinPayload): Promise<{ state: Uint8Array; awareness: UserPresence[] }> {
    console.log(`[Gateway] User ${data.userId} joining file ${data.fileId}`);
    
    // Load Y.Doc
    const ydoc = await YjsManager.getYDoc(data.fileId);
    
    // Add user to Redis set for this file
    await redis.sadd(RedisKeys.fileUsers(data.fileId), data.userId);
    
    // Setup awareness for this user
    const clientId = Date.now(); // Generate a unique client ID
    AwarenessManager.setLocalState(data.fileId, clientId, data.user);
    
    // Subscribe to broadcast channel for this file
    await GatewayHandler.subscribeToFile(data.fileId);
    
    // Return full document state
    const state = Y.encodeStateAsUpdate(ydoc);
    
    // Get current active users
    const activeUsers = AwarenessManager.getFileUsers(data.fileId);
    
    return { state, awareness: activeUsers };
  },

  /**
   * Handle Yjs update from a user
   * Broadcasts to other users via Redis pub/sub
   */
  async onYjsUpdate(data: UpdatePayload): Promise<void> {
    // Apply update to local document
    await YjsManager.applyUpdate(data.fileId, data.update);
    
    // Get other users in this file
    const otherUsers = await redis.smembers(RedisKeys.fileUsers(data.fileId));
    const otherUserIds = otherUsers.filter(u => u !== data.userId);
    
    if (otherUserIds.length > 0) {
      // Broadcast to other users via Redis Pub/Sub
      await redis.publish(
        RedisKeys.collabBroadcast(data.fileId),
        JSON.stringify({
          type: 'update',
          update: Buffer.from(data.update).toString('base64'),
          from: data.userId
        })
      );
    }
  },

  /**
   * Handle awareness update (cursor movement, selection)
   */
  async onAwarenessUpdate(data: AwarenessPayload): Promise<void> {
    // Get other users in this file
    const otherUsers = await redis.smembers(RedisKeys.fileUsers(data.fileId));
    const otherUserIds = otherUsers.filter(u => u !== data.userId);
    
    if (otherUserIds.length > 0) {
      // Broadcast awareness to other users
      await redis.publish(
        RedisKeys.collabBroadcast(data.fileId),
        JSON.stringify({
          type: 'awareness',
          userId: data.userId,
          awareness: data.awareness
        })
      );
    }
  },

  /**
   * Handle user leaving a file
   */
  async onUserLeaveFile(data: LeavePayload): Promise<void> {
    console.log(`[Gateway] User ${data.userId} leaving file ${data.fileId}`);
    
    // Remove from Redis set
    await redis.srem(RedisKeys.fileUsers(data.fileId), data.userId);
    
    // Broadcast user left to others
    await redis.publish(
      RedisKeys.collabBroadcast(data.fileId),
      JSON.stringify({
        type: 'user_left',
        userId: data.userId
      })
    );
    
    // Check if any users remain
    const remaining = await redis.scard(RedisKeys.fileUsers(data.fileId));
    
    if (remaining === 0) {
      // Sync to Postgres and unload
      await PostgresSync.syncOnDisconnect(data.fileId, data.userId);
      
      // Unsubscribe from broadcast channel
      await GatewayHandler.unsubscribeFromFile(data.fileId);
    }
  },

  /**
   * Subscribe to broadcast channel for a file
   */
  async subscribeToFile(fileId: string): Promise<void> {
    if (fileSubscribers.has(fileId)) return;
    
    const subscriber = createSubscriber();
    await subscriber.subscribe(RedisKeys.collabBroadcast(fileId));
    
    subscriber.on('message', (channel, message) => {
      // This would be forwarded to WebSocket clients via the gateway
      // The collab-service just handles the business logic
      console.log(`[Gateway] Broadcast on ${channel}:`, message.substring(0, 100));
    });
    
    fileSubscribers.set(fileId, subscriber);
  },

  /**
   * Unsubscribe from broadcast channel
   */
  async unsubscribeFromFile(fileId: string): Promise<void> {
    const subscriber = fileSubscribers.get(fileId);
    if (subscriber) {
      await subscriber.unsubscribe(RedisKeys.collabBroadcast(fileId));
      await subscriber.quit();
      fileSubscribers.delete(fileId);
    }
  },

  /**
   * Get active user count for a file
   */
  async getActiveUserCount(fileId: string): Promise<number> {
    return await redis.scard(RedisKeys.fileUsers(fileId));
  },

  /**
   * Get all active users for a file
   */
  async getActiveUsers(fileId: string): Promise<string[]> {
    return await redis.smembers(RedisKeys.fileUsers(fileId));
  },

  /**
   * Cleanup all subscribers (on shutdown)
   */
  async cleanup(): Promise<void> {
    for (const [fileId, subscriber] of fileSubscribers) {
      await subscriber.quit();
    }
    fileSubscribers.clear();
  }
};
