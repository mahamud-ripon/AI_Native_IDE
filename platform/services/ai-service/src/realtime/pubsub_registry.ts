/**
 * PubSub Registry
 * 
 * Tracks WebSocket connections and their subscriptions.
 * Enables horizontal scaling by mapping userId/projectId to connectionIds.
 */

import Redis from 'ioredis';
import { config } from '../config.js';

// Redis client for pub/sub registry
const redis = new Redis(config.redisUrl);

// Key prefixes
const CONNECTION_KEY_PREFIX = 'pubsub:conn:';
const USER_CONNECTIONS_PREFIX = 'pubsub:user:';
const PROJECT_CONNECTIONS_PREFIX = 'pubsub:project:';
const CHANNEL_SUBSCRIPTIONS_PREFIX = 'pubsub:channel:';

// TTL for connection data (5 minutes)
const CONNECTION_TTL_SECONDS = 300;

// Types
export interface ConnectionInfo {
  connectionId: string;
  userId: string;
  projectId: string;
  connectedAt: number;
  lastActivityAt: number;
  metadata?: Record<string, unknown>;
}

export interface SubscriptionInfo {
  connectionId: string;
  channel: string;
  subscribedAt: number;
}

/**
 * PubSub Registry
 * 
 * Manages connection metadata and channel subscriptions.
 * Uses Redis for distributed state across multiple server instances.
 */
class PubSubRegistry {
  /**
   * Register a new connection
   */
  async registerConnection(
    connectionId: string,
    userId: string,
    projectId: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now();
    const connectionInfo: ConnectionInfo = {
      connectionId,
      userId,
      projectId,
      connectedAt: now,
      lastActivityAt: now,
      metadata,
    };

    // Store connection info
    const connectionKey = `${CONNECTION_KEY_PREFIX}${connectionId}`;
    await redis.setex(
      connectionKey,
      CONNECTION_TTL_SECONDS,
      JSON.stringify(connectionInfo)
    );

    // Add to user's connections set
    const userConnectionsKey = `${USER_CONNECTIONS_PREFIX}${userId}`;
    await redis.sadd(userConnectionsKey, connectionId);
    await redis.expire(userConnectionsKey, CONNECTION_TTL_SECONDS);

    // Add to project's connections set
    const projectConnectionsKey = `${PROJECT_CONNECTIONS_PREFIX}${projectId}`;
    await redis.sadd(projectConnectionsKey, connectionId);
    await redis.expire(projectConnectionsKey, CONNECTION_TTL_SECONDS);
  }

  /**
   * Unregister a connection
   */
  async unregisterConnection(connectionId: string): Promise<void> {
    // Get connection info first
    const connectionInfo = await this.getConnection(connectionId);
    if (!connectionInfo) {
      return;
    }

    // Remove connection info
    const connectionKey = `${CONNECTION_KEY_PREFIX}${connectionId}`;
    await redis.del(connectionKey);

    // Remove from user's connections
    const userConnectionsKey = `${USER_CONNECTIONS_PREFIX}${connectionInfo.userId}`;
    await redis.srem(userConnectionsKey, connectionId);

    // Remove from project's connections
    const projectConnectionsKey = `${PROJECT_CONNECTIONS_PREFIX}${connectionInfo.projectId}`;
    await redis.srem(projectConnectionsKey, connectionId);

    // Remove all subscriptions for this connection
    await this.clearConnectionSubscriptions(connectionId);
  }

  /**
   * Get connection info
   */
  async getConnection(connectionId: string): Promise<ConnectionInfo | null> {
    const connectionKey = `${CONNECTION_KEY_PREFIX}${connectionId}`;
    const data = await redis.get(connectionKey);
    
    if (!data) {
      return null;
    }

    return JSON.parse(data) as ConnectionInfo;
  }

  /**
   * Update connection activity (refresh TTL)
   */
  async updateActivity(connectionId: string): Promise<void> {
    const connectionInfo = await this.getConnection(connectionId);
    if (!connectionInfo) {
      return;
    }

    connectionInfo.lastActivityAt = Date.now();

    // Update connection data
    const connectionKey = `${CONNECTION_KEY_PREFIX}${connectionId}`;
    await redis.setex(
      connectionKey,
      CONNECTION_TTL_SECONDS,
      JSON.stringify(connectionInfo)
    );

    // Refresh TTL on user and project sets
    const userConnectionsKey = `${USER_CONNECTIONS_PREFIX}${connectionInfo.userId}`;
    const projectConnectionsKey = `${PROJECT_CONNECTIONS_PREFIX}${connectionInfo.projectId}`;
    
    await redis.expire(userConnectionsKey, CONNECTION_TTL_SECONDS);
    await redis.expire(projectConnectionsKey, CONNECTION_TTL_SECONDS);
  }

  /**
   * Subscribe connection to a channel
   */
  async subscribe(connectionId: string, channel: string): Promise<void> {
    const subscriptionKey = `${CHANNEL_SUBSCRIPTIONS_PREFIX}${channel}`;
    const now = Date.now();

    const subscriptionInfo: SubscriptionInfo = {
      connectionId,
      channel,
      subscribedAt: now,
    };

    await redis.hset(subscriptionKey, connectionId, JSON.stringify(subscriptionInfo));
  }

  /**
   * Unsubscribe connection from a channel
   */
  async unsubscribe(connectionId: string, channel: string): Promise<void> {
    const subscriptionKey = `${CHANNEL_SUBSCRIPTIONS_PREFIX}${channel}`;
    await redis.hdel(subscriptionKey, connectionId);
  }

  /**
   * Get all connections subscribed to a channel
   */
  async getChannelSubscribers(channel: string): Promise<SubscriptionInfo[]> {
    const subscriptionKey = `${CHANNEL_SUBSCRIPTIONS_PREFIX}${channel}`;
    const subscribers = await redis.hgetall(subscriptionKey);

    return Object.values(subscribers).map(data => JSON.parse(data) as SubscriptionInfo);
  }

  /**
   * Get all subscriptions for a connection
   */
  async getConnectionSubscriptions(connectionId: string): Promise<string[]> {
    // Scan for all channel subscriptions containing this connection
    const pattern = `${CHANNEL_SUBSCRIPTIONS_PREFIX}*`;
    const channels: string[] = [];

    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      for (const key of keys) {
        const exists = await redis.hexists(key, connectionId);
        if (exists) {
          // Extract channel name from key
          const channel = key.replace(CHANNEL_SUBSCRIPTIONS_PREFIX, '');
          channels.push(channel);
        }
      }
    } while (cursor !== '0');

    return channels;
  }

  /**
   * Clear all subscriptions for a connection
   */
  async clearConnectionSubscriptions(connectionId: string): Promise<void> {
    const channels = await this.getConnectionSubscriptions(connectionId);
    
    for (const channel of channels) {
      await this.unsubscribe(connectionId, channel);
    }
  }

  /**
   * Get all connections for a user
   */
  async getUserConnections(userId: string): Promise<string[]> {
    const userConnectionsKey = `${USER_CONNECTIONS_PREFIX}${userId}`;
    const connections = await redis.smembers(userConnectionsKey);
    return connections;
  }

  /**
   * Get all connections for a project
   */
  async getProjectConnections(projectId: string): Promise<string[]> {
    const projectConnectionsKey = `${PROJECT_CONNECTIONS_PREFIX}${projectId}`;
    const connections = await redis.smembers(projectConnectionsKey);
    return connections;
  }

  /**
   * Get connection count for a project
   */
  async getProjectConnectionCount(projectId: string): Promise<number> {
    const projectConnectionsKey = `${PROJECT_CONNECTIONS_PREFIX}${projectId}`;
    return redis.scard(projectConnectionsKey);
  }

  /**
   * Get total connection count
   */
  async getTotalConnectionCount(): Promise<number> {
    const pattern = `${CONNECTION_KEY_PREFIX}*`;
    let count = 0;

    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      count += keys.length;
    } while (cursor !== '0');

    return count;
  }

  /**
   * Get all active connections (for debugging/monitoring)
   */
  async getAllConnections(): Promise<ConnectionInfo[]> {
    const pattern = `${CONNECTION_KEY_PREFIX}*`;
    const connections: ConnectionInfo[] = [];

    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          connections.push(JSON.parse(data) as ConnectionInfo);
        }
      }
    } while (cursor !== '0');

    return connections;
  }
}

// Singleton instance
export const pubSubRegistry = new PubSubRegistry();
