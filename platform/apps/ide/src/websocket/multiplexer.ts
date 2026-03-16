/**
 * WebSocket Multiplexer - Single Connection Manager
 * 
 * Maintains a single WebSocket connection to the websocket-gateway
 * and multiplexes multiple logical channels over it.
 * 
 * Channels:
 * - collab:{projectId}:{fileId} — Yjs CRDT sync
 * - terminal:{sessionId} — Terminal I/O stream
 * - lsp:{projectId}:{language} — Language Server Protocol
 * - ai:{conversationId} — AI streaming responses
 * - preview:{projectId} — HMR reload events
 * - presence:{projectId} — Cursor positions, awareness
 * - notifications — Push alerts, AI complete
 * 
 * Architecture:
 * - Single WS connection per user session
 * - Channel-based subscription/unsubscription
 * - Automatic reconnection with exponential backoff
 * - Message queuing during disconnection
 * 
 * Usage:
 *   const ws = useWebSocket();
 *   ws.connect(token);
 *   ws.subscribe('collab:proj123:file456', handler);
 *   ws.send('collab:proj123:file456', message);
 */

import { useState, useEffect } from 'react';

type ChannelHandler = (data: any) => void;

interface WSMessage {
  type: 'subscribe' | 'unsubscribe' | 'message' | 'ack' | 'error' | 'pong' | 'ping';
  channel?: string;
  payload?: any;
  error?: string;
}

interface QueuedMessage {
  channel: string;
  payload: any;
  timestamp: number;
}

interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  reconnectAttempts: number;
}

class WebSocketMultiplexer {
  private ws: WebSocket | null = null;
  private channels: Map<string, Set<ChannelHandler>> = new Map();
  private messageQueue: QueuedMessage[] = [];
  private state: WebSocketState = {
    connected: false,
    connecting: false,
    error: null,
    reconnectAttempts: 0,
  };
  
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start at 1s
  private maxReconnectDelay = 30000; // Max 30s
  private heartbeatInterval = 30000; // 30s
  private heartbeatTimeout = 90000; // 90s
  private lastPongTime = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Connect to WebSocket gateway
   */
  connect(wsUrl: string, token?: string): Promise<void> {
    if (this.state.connected || this.state.connecting) {
      return Promise.resolve();
    }

    this.state.connecting = true;
    this.notifyStateChange();

    const url = token 
      ? `${wsUrl}?token=${encodeURIComponent(token)}`
      : wsUrl;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        // Connection timeout
        this.connectionTimeout = setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            this.ws?.close();
            this.handleDisconnect(false);
            reject(new Error('Connection timeout'));
          }
        }, 10000);

        this.ws.onopen = () => {
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
          }
          
          this.state.connected = true;
          this.state.connecting = false;
          this.state.reconnectAttempts = 0;
          this.state.error = null;
          this.lastPongTime = Date.now();
          
          console.log('[WS] Connected to gateway');
          
          // Resubscribe to all channels
          this.resubscribeAll();
          
          // Flush message queue
          this.flushQueue();
          
          // Start heartbeat
          this.startHeartbeat();
          
          this.notifyStateChange();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          console.log('[WS] Disconnected', { 
            code: event.code, 
            reason: event.reason 
          });
          this.handleDisconnect(true);
        };

        this.ws.onerror = (error) => {
          console.error('[WS] Error:', error);
          this.state.error = 'WebSocket connection error';
          this.notifyStateChange();
        };
      } catch (error) {
        this.state.connecting = false;
        this.state.error = error instanceof Error ? error.message : 'Unknown error';
        this.notifyStateChange();
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket gateway
   */
  disconnect(): void {
    this.stopHeartbeat();
    
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.state.connected = false;
    this.state.connecting = false;
    this.notifyStateChange();
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string, handler: ChannelHandler): () => void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }

    this.channels.get(channel)!.add(handler);

    // Send subscribe message if connected
    if (this.state.connected) {
      this.sendSubscribe(channel);
    }

    // Return unsubscribe function
    return () => {
      this.unsubscribe(channel, handler);
    };
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string, handler: ChannelHandler): void {
    const handlers = this.channels.get(channel);
    if (!handlers) return;

    handlers.delete(handler);

    // Remove channel if no more handlers
    if (handlers.size === 0) {
      this.channels.delete(channel);
      
      // Send unsubscribe if connected
      if (this.state.connected) {
        this.sendUnsubscribe(channel);
      }
    }
  }

  /**
   * Send message to a channel
   */
  send(channel: string, payload: any): void {
    const message: WSMessage = {
      type: 'message',
      channel,
      payload,
    };

    if (this.state.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for later
      this.messageQueue.push({
        channel,
        payload,
        timestamp: Date.now(),
      });
      
      // Limit queue size
      if (this.messageQueue.length > 100) {
        this.messageQueue.shift();
      }
    }
  }

  /**
   * Get current connection state
   */
  getState(): WebSocketState {
    return { ...this.state };
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(callback: (state: WebSocketState) => void): () => void {
    stateChangeListeners.add(callback);
    
    return () => {
      stateChangeListeners.delete(callback);
    };
  }

  // ========================================
  // Private Methods
  // ========================================

  private handleMessage(rawData: string | ArrayBuffer): void {
    try {
      const message: WSMessage = JSON.parse(rawData as string);
      
      switch (message.type) {
        case 'ack':
          // Subscription acknowledged
          console.log('[WS] ACK for channel:', message.channel);
          break;
          
        case 'error':
          console.error('[WS] Error:', message.error);
          this.state.error = message.error || 'Unknown error';
          this.notifyStateChange();
          break;
          
        case 'message':
          // Route to channel handlers
          if (message.channel) {
            const handlers = this.channels.get(message.channel);
            handlers?.forEach(handler => handler(message.payload));
          }
          break;
          
        case 'pong':
          this.lastPongTime = Date.now();
          break;
      }
    } catch (error) {
      console.error('[WS] Failed to parse message:', error);
    }
  }

  private handleDisconnect(shouldReconnect: boolean): void {
    this.state.connected = false;
    this.state.connecting = false;
    this.stopHeartbeat();
    this.notifyStateChange();

    if (shouldReconnect && this.state.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.state.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.state.reconnectAttempts++;
    this.state.error = `Reconnecting in ${delay}ms...`;
    this.notifyStateChange();

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.state.reconnectAttempts})`);

    setTimeout(() => {
      if (this.wsUrl && this.wsToken) {
        this.connect(this.wsUrl, this.wsToken);
      }
    }, delay);
  }

  private resubscribeAll(): void {
    this.channels.forEach((_, channel) => {
      this.sendSubscribe(channel);
    });
  }

  private sendSubscribe(channel: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const message: WSMessage = {
        type: 'subscribe',
        channel,
      };
      this.ws.send(JSON.stringify(message));
    }
  }

  private sendUnsubscribe(channel: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const message: WSMessage = {
        type: 'unsubscribe',
        channel,
      };
      this.ws.send(JSON.stringify(message));
    }
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.messageQueue.shift()!;
      this.send(msg.channel, msg.payload);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      
      // Check if we received a pong recently
      if (now - this.lastPongTime > this.heartbeatTimeout) {
        console.warn('[WS] Heartbeat timeout, reconnecting...');
        this.ws?.close();
        this.handleDisconnect(true);
        return;
      }
      
      // Send ping
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private notifyStateChange(): void {
    const state = { ...this.state };
    stateChangeListeners.forEach(handler => handler(state));
  }

  // Store URL/token for reconnection
  private wsUrl: string | null = null;
  private wsToken: string | null = null;
}

// Global state change listeners
const stateChangeListeners = new Set<(state: WebSocketState) => void>();

// Singleton instance
export const wsMultiplexer = new WebSocketMultiplexer();

// React hook for using the multiplexer
export function useWebSocket() {
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    connecting: false,
    error: null,
    reconnectAttempts: 0,
  });

  useEffect(() => {
    const unsubscribe = wsMultiplexer.onStateChange(setState);
    setState(wsMultiplexer.getState());
    
    return unsubscribe;
  }, []);

  return {
    ...state,
    connect: (wsUrl: string, token?: string) => wsMultiplexer.connect(wsUrl, token),
    disconnect: () => wsMultiplexer.disconnect(),
    subscribe: (channel: string, handler: ChannelHandler) => 
      wsMultiplexer.subscribe(channel, handler),
    send: (channel: string, payload: any) => wsMultiplexer.send(channel, payload),
  };
}

// Helper to create channel names
export const channels = {
  collab: (projectId: string, fileId: string) => `collab:${projectId}:${fileId}`,
  terminal: (sessionId: string) => `terminal:${sessionId}`,
  lsp: (projectId: string, language: string) => `lsp:${projectId}:${language}`,
  ai: (conversationId: string) => `ai:${conversationId}`,
  preview: (projectId: string) => `preview:${projectId}`,
  presence: (projectId: string) => `presence:${projectId}`,
  notifications: () => `notifications`,
};
