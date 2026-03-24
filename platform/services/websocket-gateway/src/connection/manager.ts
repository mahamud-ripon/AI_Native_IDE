import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config/index';
import { logger } from '../lib/logger';
import { publish } from '../lib/redis';

export interface Connection {
  ws: WebSocket;
  userId: string;
  connId: string;
  subscribedChannels: Set<string>;
  lastPing: number;
  createdAt: number;
}

interface ParsedMessage {
  type: string;
  channel?: string;
  messageId?: string;
  payload?: unknown;
}

// Allowed channel prefixes for security
const ALLOWED_CHANNEL_PREFIXES = [
  'collab:', 'terminal:', 'ai:', 'execution:', 'notifications:', 'deploy:', 'presence:', 'preview.hmr:', 'project:',
];

function validateChannel(channel: string): boolean {
  if (!channel || typeof channel !== 'string' || channel.length > 256) return false;
  if (channel.includes('\0') || channel.includes('\n')) return false;
  return ALLOWED_CHANNEL_PREFIXES.some(prefix => channel.startsWith(prefix));
}

const connections = new Map<string, Connection>();
const userConnections = new Map<string, Set<string>>();

export const ConnectionManager = {
  async handleConnection(ws: WebSocket, token: string): Promise<string | null> {
    try {
      let decoded: jwt.JwtPayload;
      const publicKey = process.env.JWT_PUBLIC_KEY || '';

      if (publicKey) {
        decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload;
      } else {
        // Dev fallback
        const devBypass = process.env.DEV_BYPASS_AUTH === 'true';
        if (devBypass || process.env.NODE_ENV !== 'production') {
          decoded = jwt.decode(token) as jwt.JwtPayload;
          if (!decoded) throw new Error('Invalid token');
        } else {
          // Should not happen in production without a public key
          throw new Error('Missing public key for verification');
        }
      }
      const userId = decoded.sub;

      if (!userId) {
        ws.close(4001, 'Invalid token: missing subject');
        return null;
      }

      const connId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const connection: Connection = {
        ws,
        userId,
        connId,
        subscribedChannels: new Set(),
        lastPing: Date.now(),
        createdAt: Date.now(),
      };

      connections.set(connId, connection);

      if (!userConnections.has(userId)) {
        userConnections.set(userId, new Set());
      }
      userConnections.get(userId)!.add(connId);

      logger.info({ connId, userId }, 'New WebSocket connection');

      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'connected',
              timestamp: Date.now(),
              connId,
              userId,
            })
          );
        } else {
          logger.warn({ state: ws.readyState, connId }, 'WS not open');
        }
      } catch (sendErr) {
        const error = sendErr as Error;
        logger.error(
          { 
            error: error?.message || 'Unknown error', 
            stack: error?.stack,
            connId 
          }, 
          'Failed to send connected message'
        );
        connections.delete(connId);
        const userConns = userConnections.get(userId);
        if (userConns) userConns.delete(connId);
        return null;
      }

      return connId;
    } catch (error) {
      const err = error as Error;
      logger.error({ 
        error: err?.message || 'Unknown error',
        stack: err?.stack
      }, 'WebSocket auth error');
      ws.close(4001, 'Authentication failed');
      return null;
    }
  },

  async handleMessage(connId: string, message: string | Buffer): Promise<void> {
    const connection = connections.get(connId);
    if (!connection) return;

    try {
      const data: ParsedMessage =
        typeof message === 'string'
          ? JSON.parse(message)
          : JSON.parse(message.toString());

      switch (data.type) {
        case 'subscribe':
          if (data.channel && validateChannel(data.channel)) {
            await this.subscribe(connId, data.channel);
          } else {
            this.sendToConnection(connId, { type: 'error', message: 'Invalid channel' });
          }
          break;
        case 'unsubscribe':
          if (data.channel && validateChannel(data.channel)) {
            await this.unsubscribe(connId, data.channel);
          }
          break;
        case 'ping':
          connection.lastPing = Date.now();
          this.sendToConnection(connId, { type: 'pong' });
          break;
        case 'message':
          await this.routeMessage(connId, data);
          break;
        default:
          logger.debug({ type: data.type }, 'Unknown message type');
      }
    } catch (error) {
      const err = error as Error;
      logger.error({ 
        error: err?.message || 'Unknown error',
        stack: err?.stack,
        connId 
      }, 'Error handling message');
    }
  },

  async subscribe(connId: string, channel: string): Promise<void> {
    const connection = connections.get(connId);
    if (!connection) return;

    connection.subscribedChannels.add(channel);
    logger.debug({ connId, channel }, 'Subscribed to channel');

    if (connection.ws.readyState === WebSocket.OPEN) {
      this.sendToConnection(connId, {
        type: 'subscribed',
        channel,
      });
    }
  },

  async unsubscribe(connId: string, channel: string): Promise<void> {
    const connection = connections.get(connId);
    if (!connection) return;

    connection.subscribedChannels.delete(channel);
    logger.debug({ connId, channel }, 'Unsubscribed from channel');

    if (connection.ws.readyState === WebSocket.OPEN) {
      this.sendToConnection(connId, {
        type: 'unsubscribed',
        channel,
      });
    }
  },

  async routeMessage(connId: string, data: ParsedMessage): Promise<void> {
    const connection = connections.get(connId);
    if (!connection) return;

    const channel = data.channel;
    if (!channel || !validateChannel(channel)) {
      this.sendToConnection(connId, {
        type: 'error',
        message: 'Valid channel is required',
      });
      return;
    }

    // Idempotency check for mutating messages
    if (data.messageId) {
      const redis = await import('../lib/redis').then((m) => m.getRedis());
      if (redis) {
        const key = `msg:${data.messageId}`;
        const exists = await redis.setnx(key, '1');
        if (!exists) {
          logger.debug({ messageId: data.messageId }, 'Duplicate message, dropping');
          return;
        }
        await redis.expire(key, 60);
      }
    }

    // Route based on channel prefix
    if (channel.startsWith('collab:')) {
      await this.routeToCollabService(connection, data);
    } else if (channel.startsWith('terminal:')) {
      await this.routeToExecutionService(connection, data);
    } else if (channel.startsWith('ai:')) {
      await this.routeToAIService(connection, data);
    } else if (channel.startsWith('notifications:')) {
      await this.routeToNotificationService(connection, data);
    } else if (channel.startsWith('deploy:')) {
      await this.routeToDeployService(connection, data);
    } else if (channel.startsWith('presence:')) {
      await this.routeToPresenceService(connection, data);
    } else if (channel.startsWith('preview.hmr:')) {
      await this.routeToPreviewService(connection, data);
    }
  },

  async routeToCollabService(connection: Connection, data: ParsedMessage): Promise<void> {
    const channelParts = data.channel!.split(':');
    const projectId = channelParts[1];
    const fileId = channelParts[2];

    if (!projectId || !fileId) {
      this.sendToConnection(connection.connId, { type: 'error', message: 'Invalid collab channel format' });
      return;
    }

    await publish(`collab:${projectId}:${fileId}`, {
      type: data.payload ? 'update' : 'sync',
      connId: connection.connId,
      userId: connection.userId,
      payload: data.payload,
    });
  },

  async routeToExecutionService(connection: Connection, data: ParsedMessage): Promise<void> {
    const channelParts = data.channel!.split(':');
    const sessionId = channelParts[1];

    if (!sessionId) {
      this.sendToConnection(connection.connId, { type: 'error', message: 'Invalid terminal channel format' });
      return;
    }

    await publish(`terminal:${sessionId}`, {
      type: 'input',
      connId: connection.connId,
      userId: connection.userId,
      payload: data.payload,
    });
  },

  async routeToAIService(connection: Connection, data: ParsedMessage): Promise<void> {
    const channelParts = data.channel!.split(':');
    const conversationId = channelParts[1];

    if (!conversationId) {
      this.sendToConnection(connection.connId, { type: 'error', message: 'Invalid AI channel format' });
      return;
    }

    await publish(`ai:${conversationId}`, {
      type: 'request',
      connId: connection.connId,
      userId: connection.userId,
      payload: data.payload,
      messageId: data.messageId,
    });
  },

  async routeToNotificationService(connection: Connection, data: ParsedMessage): Promise<void> {
    await publish(`notifications:${connection.userId}`, {
      type: 'notification',
      payload: data.payload,
    });
  },

  async routeToDeployService(connection: Connection, data: ParsedMessage): Promise<void> {
    const channelParts = data.channel!.split(':');
    const deploymentId = channelParts[1];

    if (!deploymentId) {
      this.sendToConnection(connection.connId, { type: 'error', message: 'Invalid deploy channel format' });
      return;
    }

    await publish(`deploy:${deploymentId}`, {
      type: 'log',
      payload: data.payload,
    });
  },

  async routeToPresenceService(connection: Connection, data: ParsedMessage): Promise<void> {
    const channelParts = data.channel!.split(':');
    const projectId = channelParts[1];

    if (!projectId) {
      this.sendToConnection(connection.connId, { type: 'error', message: 'Invalid presence channel format' });
      return;
    }

    await publish(`presence:${projectId}`, {
      type: 'cursor',
      userId: connection.userId,
      payload: data.payload,
    });
  },

  async routeToPreviewService(connection: Connection, data: ParsedMessage): Promise<void> {
    const channelParts = data.channel!.split(':');
    const projectId = channelParts[1];

    if (!projectId) {
      this.sendToConnection(connection.connId, { type: 'error', message: 'Invalid preview channel format' });
      return;
    }

    await publish(`preview.hmr:${projectId}`, {
      type: 'update',
      payload: data.payload,
    });
  },

  async handleDisconnect(connId: string): Promise<void> {
    const connection = connections.get(connId);
    if (!connection) return;

    const { userId, subscribedChannels } = connection;

    // Remove from user connections
    const userConns = userConnections.get(userId);
    if (userConns) {
      userConns.delete(connId);
      if (userConns.size === 0) {
        userConnections.delete(userId);

        // Publish user offline event
        try {
          await publish('user.offline', { userId, connId });
        } catch (error) {
          const err = error as Error;
          logger.error({ 
            error: err?.message || 'Unknown error',
            stack: err?.stack,
            userId 
          }, 'Failed to publish user offline event');
        }
        logger.info({ userId }, 'User went offline');
      }
    }

    // Cleanup
    connections.delete(connId);
    logger.info({ connId, userId, channels: subscribedChannels.size }, 'Connection closed');
  },

  sendToConnection(connId: string, message: unknown): boolean {
    const connection = connections.get(connId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    try {
      connection.ws.send(msg);
      return true;
    } catch {
      return false;
    }
  },

  broadcastToChannel(channel: string, message: unknown): number {
    let count = 0;
    const msg = typeof message === 'string' ? message : JSON.stringify(message);

    connections.forEach((connection) => {
      if (connection.subscribedChannels.has(channel) && connection.ws.readyState === WebSocket.OPEN) {
        try {
          connection.ws.send(msg);
          count++;
        } catch {
          // Connection may have closed between readyState check and send
        }
      }
    });

    return count;
  },

  getConnection(connId: string): Connection | undefined {
    return connections.get(connId);
  },

  getUserConnections(userId: string): string[] {
    const conns = userConnections.get(userId);
    return conns ? Array.from(conns) : [];
  },

  getActiveConnectionCount(): number {
    return connections.size;
  },

  getActiveUserCount(): number {
    return userConnections.size;
  },

  getConnections(): Map<string, Connection> {
    return connections;
  },
};

export default ConnectionManager;
