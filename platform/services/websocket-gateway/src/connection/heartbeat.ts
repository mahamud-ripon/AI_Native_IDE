import { ConnectionManager, Connection } from './manager';
import { config } from '../config/index';
import { logger } from '../lib/logger';

let intervalId: NodeJS.Timeout | null = null;

export const HeartbeatManager = {
  start(): void {
    if (intervalId) {
      return;
    }

    // Check connections every 10 seconds
    intervalId = setInterval(() => {
      HeartbeatManager.checkConnections();
    }, 10000);

    logger.info('Heartbeat manager started');
  },

  stop(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      logger.info('Heartbeat manager stopped');
    }
  },

  checkConnections(): void {
    const now = Date.now();
    const timeout = config.heartbeat.pingTimeout;
    const connections = ConnectionManager.getConnections();
    let staleCount = 0;

    connections.forEach((connection: Connection, connId: string) => {
      if (now - connection.lastPing > timeout) {
        staleCount++;
        logger.warn({ connId, lastPing: connection.lastPing }, 'Connection timed out, closing');

        connection.ws.close(4002, 'Connection timeout');
        ConnectionManager.handleDisconnect(connId).catch((err) => {
          logger.error({ err, connId }, 'Error handling disconnect');
        });
      }
    });

    if (staleCount > 0) {
      logger.debug({ staleCount, total: connections.size }, 'Stale connections cleaned up');
    }
  },

  // Called when receiving pong from client
  updatePing(connId: string): void {
    const connection = ConnectionManager.getConnection(connId);
    if (connection) {
      connection.lastPing = Date.now();
    }
  },
};

export default HeartbeatManager;
