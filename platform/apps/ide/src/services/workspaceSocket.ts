import { logger } from '../lib/logger';

export interface WorkspaceFileEvent {
  type: 'workspace.file.event';
  data: {
    eventType: 'file.created' | 'file.modified' | 'file.deleted';
    projectId: string;
    filePath?: string;
    timestamp: number;
  };
}

export type WorkspaceEventHandler = (event: WorkspaceFileEvent['data']) => void;

class WorkspaceSocketService {
  private ws: WebSocket | null = null;
  private url: string = '';
  private handlers: Set<WorkspaceEventHandler> = new Set();
  private currentProjectId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(projectId: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && this.currentProjectId === projectId) {
      return;
    }

    this.currentProjectId = projectId;
    
    // Get token from localStorage
    const token = localStorage.getItem('auth_token');
    if (!token) {
      logger.warn('No auth token found for workspace socket');
      return;
    }

    // Get WebSocket URL from environment or use default
    const wsUrl = import.meta.env.VITE_WS_GATEWAY_URL || 'ws://localhost:8001';
    this.url = `${wsUrl}/gateway?token=${token}`;

    this.disconnect();

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          logger.info({ projectId }, 'Workspace WebSocket connected');
          this.reconnectAttempts = 0;
          
          // Subscribe to project channel
          this.send({
            type: 'subscribe',
            channel: `project:${projectId}`
          });
          
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            logger.error({ error }, 'Failed to parse WebSocket message');
          }
        };

        this.ws.onclose = () => {
          logger.info('Workspace WebSocket disconnected');
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          logger.error({ error }, 'Workspace WebSocket error');
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private handleMessage(message: { type: string; data?: WorkspaceFileEvent['data'] }): void {
    switch (message.type) {
      case 'workspace.file.event':
        if (message.data) {
          this.handlers.forEach(handler => handler(message.data!));
        }
        break;
      
      case 'subscribed':
        logger.debug({ channel: (message as any).channel }, 'Subscribed to channel');
        break;
      
      case 'connected':
        logger.debug({ connId: (message as any).connId }, 'WebSocket connected');
        break;
      
      default:
        logger.debug({ type: message.type }, 'Unknown WebSocket message type');
    }
  }

  private send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.warn('Max reconnection attempts reached');
      return;
    }

    if (!this.currentProjectId) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    logger.info({ 
      attempt: this.reconnectAttempts, 
      maxAttempts: this.maxReconnectAttempts,
      delay 
    }, 'Attempting to reconnect workspace socket');

    setTimeout(() => {
      if (this.currentProjectId) {
        this.connect(this.currentProjectId).catch((error) => {
          logger.error({ error }, 'Failed to reconnect');
        });
      }
    }, delay);
  }

  subscribe(handler: WorkspaceEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export const workspaceSocket = new WorkspaceSocketService();
