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

const connections = new Map<string, Connection>();
const userConnections = new Map<string, Set<string>>();

export const ConnectionManager = {
  async handleConnection(ws: WebSocket, token: string): Promise<string | null> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
      const userId = decoded.sub || decoded.userId;

      if (!userId) {
        ws.close(4001, 'Invalid token');
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

      ws.send(
        JSON.stringify({
          type: 'connected',
          connId,
          userId,
        })
      );

      return connId;
    } catch (error) {
      logger.error({ error }, 'WebSocket auth error');
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
          await this.subscribe(connId, data.channel!);
          break;
        case 'unsubscribe':
          await this.unsubscribe(connId, data.channel!);
          break;
        case 'ping':
          connection.lastPing = Date.now();
          connection.ws.send(JSON.stringify({ type: 'pong' }));
          break;
        case 'message':
          await this.routeMessage(connId, data);
          break;
        default:
          logger.debug({ type: data.type }, 'Unknown message type');
      }
    } catch (error) {
      logger.error({ error }, 'Error handling message');
    }
  },

  async subscribe(connId: string, channel: string): Promise<void> {
    const connection = connections.get(connId);
    if (!connection) return;

    connection.subscribedChannels.add(channel);
    logger.debug({ connId, channel }, 'Subscribed to channel');

    connection.ws.send(
      JSON.stringify({
        type: 'subscribed',
        channel,
      })
    );
  },

  async unsubscribe(connId: string, channel: string): Promise<void> {
    const connection = connections.get(connId);
    if (!connection) return;

    connection.subscribedChannels.delete(channel);
    logger.debug({ connId, channel }, 'Unsubscribed from channel');

    connection.ws.send(
      JSON.stringify({
        type: 'unsubscribed',
        channel,
      })
    );
  },

  async routeMessage(connId: string, data: ParsedMessage): Promise<void> {
    const connection = connections.get(connId);
    if (!connection) return;

    const channel = data.channel;
    if (!channel) {
      connection.ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Channel is required',
        })
      );
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

    await publish(`deploy:${deploymentId}`, {
      type: 'log',
      payload: data.payload,
    });
  },

  async routeToPresenceService(connection: Connection, data: ParsedMessage): Promise<void> {
    const channelParts = data.channel!.split(':');
    const projectId = channelParts[1];

    await publish(`presence:${projectId}`, {
      type: 'cursor',
      userId: connection.userId,
      payload: data.payload,
    });
  },

  async routeToPreviewService(connection: Connection, data: ParsedMessage): Promise<void> {
    const channelParts = data.channel!.split(':');
    const projectId = channelParts[1];

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
        await publish('user.offline', { userId, connId });
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
    connection.ws.send(msg);
    return true;
  },

  broadcastToChannel(channel: string, message: unknown): number {
    let count = 0;
    const msg = typeof message === 'string' ? message : JSON.stringify(message);

    connections.forEach((connection) => {
      if (connection.subscribedChannels.has(channel) && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(msg);
        count++;
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
