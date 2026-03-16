/**
 * WebSocket Hook for Real-time Admin Metrics
 * 
 * Provides live streaming data from background-worker
 * with exponential backoff reconnection and error handling.
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { WsMessage, WsMetricsPayload, WsAlertPayload } from '@/types';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

interface UseWebSocketOptions {
  url?: string;
  onMessage?: (message: WsMessage) => void;
  onMetrics?: (payload: WsMetricsPayload) => void;
  onAlert?: (payload: WsAlertPayload) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  initialReconnectInterval?: number;
  maxReconnectInterval?: number;
  maxReconnectAttempts?: number;
  backoffMultiplier?: number;
}

interface WebSocketState {
  connectionState: ConnectionState;
  isConnected: boolean;
  isReconnecting: boolean;
  error: string | null;
  reconnectAttempts: number;
  nextReconnectIn: number | null;
}

// Exponential backoff calculator
function calculateBackoff(
  attempt: number,
  initialInterval: number,
  maxInterval: number,
  multiplier: number
): number {
  const delay = Math.min(initialInterval * Math.pow(multiplier, attempt), maxInterval);
  // Add jitter (±10%) to prevent thundering herd
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000',
    onMessage,
    onMetrics,
    onAlert,
    onConnect,
    onDisconnect,
    onError,
    initialReconnectInterval = 1000,
    maxReconnectInterval = 30000,
    maxReconnectAttempts = 20,
    backoffMultiplier = 1.5,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);
  const manualDisconnectRef = useRef(false);

  const [state, setState] = useState<WebSocketState>({
    connectionState: 'disconnected',
    isConnected: false,
    isReconnecting: false,
    error: null,
    reconnectAttempts: 0,
    nextReconnectIn: null,
  });

  // Clear all timers
  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  // Start countdown for next reconnect
  const startCountdown = useCallback((delayMs: number) => {
    let remaining = Math.ceil(delayMs / 1000);
    setState(prev => ({ ...prev, nextReconnectIn: remaining }));

    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        setState(prev => ({ ...prev, nextReconnectIn: null }));
      } else {
        setState(prev => ({ ...prev, nextReconnectIn: remaining }));
      }
    }, 1000);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    clearTimers();
    manualDisconnectRef.current = false;

    setState(prev => ({
      ...prev,
      connectionState: prev.reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
      error: null,
    }));

    try {
      const ws = new WebSocket(`${url}/ws/admin/metrics`);
      
      ws.onopen = () => {
        setState(prev => ({
          ...prev,
          connectionState: 'connected',
          isConnected: true,
          isReconnecting: false,
          error: null,
          reconnectAttempts: 0,
          nextReconnectIn: null,
        }));
        clearTimers();
        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message: WsMessage = JSON.parse(event.data);
          onMessage?.(message);

          // Route to specific handlers
          switch (message.type) {
            case 'metrics':
              onMetrics?.(message.payload as WsMetricsPayload);
              break;
            case 'alert':
              onAlert?.(message.payload as WsAlertPayload);
              break;
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = (event) => {
        const wasConnected = state.isConnected;
        
        setState(prev => ({
          ...prev,
          connectionState: 'disconnected',
          isConnected: false,
        }));
        
        onDisconnect?.();

        // Attempt reconnection with exponential backoff
        if (shouldReconnectRef.current && !manualDisconnectRef.current) {
          setState(prev => {
            const newAttempts = prev.reconnectAttempts + 1;
            
            if (newAttempts <= maxReconnectAttempts) {
              const delay = calculateBackoff(
                newAttempts - 1,
                initialReconnectInterval,
                maxReconnectInterval,
                backoffMultiplier
              );
              
              startCountdown(delay);
              
              reconnectTimeoutRef.current = setTimeout(() => {
                connect();
              }, delay);
              
              return {
                ...prev,
                connectionState: 'reconnecting',
                isReconnecting: true,
                reconnectAttempts: newAttempts,
              };
            }
            
            const errorMsg = 'Max reconnection attempts reached. Click reconnect to try again.';
            onError?.(errorMsg);
            
            return {
              ...prev,
              connectionState: 'error',
              isReconnecting: false,
              error: errorMsg,
              nextReconnectIn: null,
            };
          });
        }
      };

      ws.onerror = (error) => {
        const errorMsg = 'WebSocket connection error. Retrying...';
        setState(prev => ({
          ...prev,
          connectionState: 'error',
          error: prev.isReconnecting ? prev.error : errorMsg,
        }));
        onError?.(errorMsg);
      };

      wsRef.current = ws;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Connection failed';
      setState(prev => ({
        ...prev,
        connectionState: 'error',
        error: errorMsg,
      }));
      onError?.(errorMsg);
    }
  }, [url, onMessage, onMetrics, onAlert, onConnect, onDisconnect, onError, 
      initialReconnectInterval, maxReconnectInterval, maxReconnectAttempts, 
      backoffMultiplier, clearTimers, startCountdown, state.isConnected]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    shouldReconnectRef.current = false;
    clearTimers();
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setState({
      connectionState: 'disconnected',
      isConnected: false,
      isReconnecting: false,
      error: null,
      reconnectAttempts: 0,
      nextReconnectIn: null,
    });
  }, [clearTimers]);

  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    manualDisconnectRef.current = false;
    clearTimers();
    
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setState(prev => ({ 
      ...prev, 
      reconnectAttempts: 0,
      error: null,
      connectionState: 'connecting',
    }));
    
    // Small delay before reconnecting
    setTimeout(() => connect(), 100);
  }, [connect, clearTimers]);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    reconnect,
  };
}

/**
 * Hook for real-time metrics streaming
 */
export function useRealTimeMetrics() {
  const [metrics, setMetrics] = useState<WsMetricsPayload | null>(null);
  const [alerts, setAlerts] = useState<WsAlertPayload[]>([]);
  const [history, setHistory] = useState<WsMetricsPayload[]>([]);
  const maxHistorySize = 600; // 10 minutes at 1 update/second

  const onMetrics = useCallback((payload: WsMetricsPayload) => {
    setMetrics(payload);
    setHistory(prev => {
      const newHistory = [...prev, payload];
      // Maintain sliding window
      if (newHistory.length > maxHistorySize) {
        return newHistory.slice(-maxHistorySize);
      }
      return newHistory;
    });
  }, []);

  const onAlert = useCallback((payload: WsAlertPayload) => {
    setAlerts(prev => [payload, ...prev].slice(0, 50)); // Keep last 50 alerts
  }, []);

  const ws = useWebSocket({
    onMetrics,
    onAlert,
  });

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return {
    metrics,
    alerts,
    history,
    clearAlerts,
    clearHistory,
    ...ws,
  };
}
