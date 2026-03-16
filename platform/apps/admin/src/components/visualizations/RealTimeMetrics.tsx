/**
 * Real-Time Metrics Display (Client Component)
 * 
 * Uses WebSocket hook for live metric streaming with
 * enhanced connection status and reconnection UI.
 */

'use client';

import { useRealTimeMetrics } from '@/hooks/useWebSocket';
import { Card, Badge, Spinner, Button } from '@/components/ui';
import { formatNumber } from '@/lib/utils';

export function RealTimeMetrics() {
  const { 
    metrics, 
    alerts, 
    history,
    connectionState, 
    isConnected, 
    isReconnecting, 
    error, 
    reconnectAttempts,
    nextReconnectIn,
    reconnect 
  } = useRealTimeMetrics();

  // Connection status indicator
  const renderConnectionStatus = () => {
    switch (connectionState) {
      case 'connected':
        return (
          <Badge variant="success" className="flex items-center gap-1">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Connected
          </Badge>
        );
      case 'connecting':
        return (
          <Badge variant="default" className="flex items-center gap-1">
            <Spinner size="sm" />
            Connecting...
          </Badge>
        );
      case 'reconnecting':
        return (
          <div className="flex items-center gap-2">
            <Badge variant="warning" className="flex items-center gap-1">
              <Spinner size="sm" />
              Reconnecting (attempt {reconnectAttempts})
            </Badge>
            {nextReconnectIn && (
              <span className="text-xs text-gray-500">
                in {nextReconnectIn}s
              </span>
            )}
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-2">
            <Badge variant="danger" className="flex items-center gap-1">
              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              Connection Failed
            </Badge>
            <Button 
              size="sm" 
              variant="secondary" 
              onClick={reconnect}
              className="text-xs"
            >
              Reconnect
            </Button>
          </div>
        );
      case 'disconnected':
      default:
        return (
          <Badge variant="default" className="flex items-center gap-1">
            <span className="w-2 h-2 bg-gray-400 rounded-full" />
            Disconnected
          </Badge>
        );
    }
  };

  // Error state with reconnect option
  if (error && connectionState === 'error') {
    return (
      <Card className="p-4 bg-danger-50 border-danger-200">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 text-danger-600 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="text-sm font-medium text-danger-700">Connection Error</p>
              <p className="text-xs text-danger-600 mt-1">{error}</p>
              {reconnectAttempts > 0 && (
                <p className="text-xs text-danger-500 mt-1">
                  Failed after {reconnectAttempts} attempts
                </p>
              )}
            </div>
          </div>
          <Button 
            size="sm" 
            variant="secondary" 
            onClick={reconnect}
            className="text-danger-700 border-danger-300 hover:bg-danger-100"
          >
            Retry Connection
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Connection Status */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Live Metrics</h3>
        <div className="flex items-center gap-2">
          {renderConnectionStatus()}
        </div>
      </div>

      {/* Metrics Grid - shows last known metrics even during reconnect */}
      {metrics || history.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricTile 
            label="CPU" 
            value={`${(metrics?.cpu ?? history[history.length - 1]?.cpu ?? 0).toFixed(1)}%`}
            isStale={!isConnected}
          />
          <MetricTile 
            label="Memory" 
            value={`${(metrics?.memory ?? history[history.length - 1]?.memory ?? 0).toFixed(1)}%`}
            isStale={!isConnected}
          />
          <MetricTile 
            label="Requests" 
            value={formatNumber(metrics?.requests ?? history[history.length - 1]?.requests ?? 0)}
            isStale={!isConnected}
          />
          <MetricTile 
            label="Errors" 
            value={formatNumber(metrics?.errors ?? history[history.length - 1]?.errors ?? 0)}
            isStale={!isConnected}
          />
          <MetricTile 
            label="Latency" 
            value={`${(metrics?.latency ?? history[history.length - 1]?.latency ?? 0).toFixed(0)}ms`}
            isStale={!isConnected}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center py-8 text-gray-500">
          <Spinner className="mr-2" />
          {isReconnecting ? 'Reconnecting...' : 'Waiting for metrics...'}
        </div>
      )}

      {/* Stale data indicator */}
      {isReconnecting && (metrics || history.length > 0) && (
        <div className="flex items-center gap-2 text-xs text-yellow-600 bg-yellow-50 px-3 py-1.5 rounded-md">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>Showing last known data while reconnecting...</span>
        </div>
      )}

      {/* Recent Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-500 uppercase">Recent Alerts</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {alerts.slice(0, 5).map((alert: import('@/types').WsAlertPayload, i: number) => (
              <div
                key={i}
                className={`text-xs p-2 rounded ${
                  alert.level === 'critical'
                    ? 'bg-danger-50 text-danger-700'
                    : alert.level === 'warning'
                    ? 'bg-yellow-50 text-yellow-700'
                    : 'bg-blue-50 text-blue-700'
                }`}
              >
                <span className="font-medium">[{alert.level.toUpperCase()}]</span>{' '}
                {alert.message}
                <span className="text-gray-400 ml-2">({alert.source})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, value, isStale = false }: { label: string; value: string; isStale?: boolean }) {
  return (
    <Card className={`p-3 text-center ${isStale ? 'opacity-60' : ''}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
      {isStale && (
        <div className="text-xs text-yellow-500 mt-1">stale</div>
      )}
    </Card>
  );
}
