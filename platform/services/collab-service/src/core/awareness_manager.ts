import * as Y from 'yjs';
import { redis, RedisKeys } from '../lib/redis.js';
import { config } from '../config.js';
import type { User, UserPresence, CursorPosition } from '../lib/types.js';

// Import awareness from y-protocols (CommonJS module)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Awareness } = require('y-protocols/awareness');

// In-memory awareness states per file
const awarenessStates = new Map<string, Map<number, UserPresence>>();
// Use any for awareness instances since it's a runtime class from CommonJS
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const awarenessInstances = new Map<string, any>();

// User colors for cursor display
const CURSOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F39C12',
  '#9B59B6', '#1ABC9C', '#E74C3C', '#3498DB'
];

function generateColor(userId: string): string {
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

export const AwarenessManager = {
  /**
   * Get or create awareness for a file
   */
  getAwareness(fileId: string) {
    if (awarenessInstances.has(fileId)) {
      return awarenessInstances.get(fileId)!;
    }

    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    
    awareness.on('change', () => {
      const states = awareness.getStates();
      const userStates = new Map<number, UserPresence>();
      
      states.forEach((state: any, clientId: number) => {
        if (state.user) {
          userStates.set(clientId, {
            ...state as UserPresence,
            lastActive: Date.now()
          });
        }
      });
      
      awarenessStates.set(fileId, userStates);
    });

    awarenessInstances.set(fileId, awareness);
    return awareness;
  },

  /**
   * Set local user state (called when user joins or moves cursor)
   */
  setLocalState(
    fileId: string,
    clientId: number,
    user: User,
    cursor?: CursorPosition
  ): void {
    const awareness = AwarenessManager.getAwareness(fileId);
    const color = generateColor(user.id);
    
    awareness.setLocalState({
      user: {
        id: user.id,
        name: user.name || user.email,
        avatar: user.avatar
      },
      cursor,
      color,
      lastActive: Date.now()
    });

    // Store in Redis for persistence
    const state = awareness.getLocalState();
    if (state) {
      redis.hset(
        RedisKeys.awareness(fileId),
        clientId.toString(),
        JSON.stringify(state)
      );
    }
  },

  /**
   * Update user cursor position
   */
  updateCursor(
    fileId: string,
    clientId: number,
    cursor: CursorPosition
  ): void {
    const awareness = AwarenessManager.getAwareness(fileId);
    const currentState = awareness.getLocalState();
    
    awareness.setLocalState({
      ...currentState,
      cursor,
      lastActive: Date.now()
    });
  },

  /**
   * Get all users viewing a file
   */
  getFileUsers(fileId: string): UserPresence[] {
    const states = awarenessStates.get(fileId);
    if (!states) return [];
    
    const now = Date.now();
    const activeUsers: UserPresence[] = [];
    
    states.forEach((presence) => {
      // Filter out stale users (no heartbeat for 15s)
      if (now - presence.lastActive < config.awarenessTtl) {
        activeUsers.push(presence);
      }
    });
    
    return activeUsers;
  },

  /**
   * Remove user from awareness (when they leave)
   */
  removeUser(fileId: string, clientId: number): void {
    const awareness = awarenessInstances.get(fileId);
    if (awareness) {
      awareness.setLocalState(null);
    }

    const states = awarenessStates.get(fileId);
    if (states) {
      states.delete(clientId);
    }

    redis.hdel(RedisKeys.awareness(fileId), clientId.toString());
  },

  /**
   * Get awareness as encoded binary (for network sync)
   */
  getEncodedAwareness(fileId: string): Uint8Array | null {
    const awareness = awarenessInstances.get(fileId);
    if (!awareness) return null;
    
    const { encodeAwarenessUpdate } = require('y-protocols/awareness');
    return encodeAwarenessUpdate(awareness, [awareness.clientId]);
  },

  /**
   * Apply awareness update from remote
   */
  applyAwarenessUpdate(fileId: string, update: Uint8Array): void {
    const awareness = awarenessInstances.get(fileId);
    if (!awareness) return;

    const { applyAwarenessUpdate } = require('y-protocols/awareness');
    applyAwarenessUpdate(awareness, update);
  },

  /**
   * Cleanup stale awareness entries (run periodically)
   */
  cleanupStale(): void {
    const now = Date.now();
    
    awarenessStates.forEach((states, fileId) => {
      states.forEach((presence, clientId) => {
        if (now - presence.lastActive > config.awarenessTtl) {
          states.delete(clientId);
          console.log(`[Awareness] Cleaned up stale user in ${fileId}`);
        }
      });
      
      if (states.size === 0) {
        awarenessStates.delete(fileId);
        awarenessInstances.delete(fileId);
      }
    });
  },

  /**
   * Get total awareness instances
   */
  getActiveAwarenessCount(): number {
    return awarenessInstances.size;
  },

  /**
   * Clear all awareness for a file (file deleted)
   */
  clearFileAwareness(fileId: string): void {
    awarenessStates.delete(fileId);
    awarenessInstances.delete(fileId);
    redis.del(RedisKeys.awareness(fileId));
  }
};
