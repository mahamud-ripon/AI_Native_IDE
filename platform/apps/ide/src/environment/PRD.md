# IDE Environment - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/environment/`  
> **Tech Stack:** React + WebSocket + Zustand

---

## 1. Executive Summary

The Environment component manages UI states for the user's compute environment (Firecracker VMs). It displays VM status (running, waking, hibernating, crashed), handles manual wake/restart actions, and shows resource exhaustion warnings.

---

## 2. Project Setup

### 2.1 Dependencies

```bash
npm install zustand @tanstack/react-query lucide-react
```

---

## 3. VM Status Types

```typescript
// src/environment/types.ts

export type VMStatus = 
  | 'running'      // VM is active and ready
  | 'waking'       // VM is waking from hibernation
  | 'hibernating'  // VM is sleeping (snapshot to disk)
  | 'crashed'      // VM crashed or out of memory
  | 'starting'     // VM is starting from cold
  | 'stopping';    // VM is shutting down

export interface VMState {
  status: VMStatus;
  lastActive: Date | null;
  wakeupTime?: number; // seconds to wake
  error?: string;
  memoryUsage?: number; // MB
  cpuUsage?: number; // percentage
}

export interface ResourceWarning {
  type: 'oom' | 'cpu' | 'timeout';
  message: string;
  timestamp: Date;
}
```

---

## 4. Environment Store

### 4.1 Zustand Store (src/environment/store.ts)

```typescript
import { create } from 'zustand';
import { VMStatus, VMState, ResourceWarning } from './types';

interface EnvironmentStore {
  // VM State
  vmState: VMState;
  projectId: string | null;
  
  // Resource warnings
  warnings: ResourceWarning[];
  
  // Actions
  setVMState: (state: Partial<VMState>) => void;
  setProjectId: (projectId: string) => void;
  addWarning: (warning: ResourceWarning) => void;
  clearWarnings: () => void;
  
  // VM Actions
  wakeVM: () => Promise<void>;
  restartVM: () => Promise<void>;
  hardResetVM: () => Promise<void>;
}

export const useEnvironmentStore = create<EnvironmentStore>((set, get) => ({
  vmState: {
    status: 'hibernating',
    lastActive: null,
    wakeupTime: 3
  },
  projectId: null,
  warnings: [],
  
  setVMState: (newState) => set((state) => ({
    vmState: { ...state.vmState, ...newState }
  })),
  
  setProjectId: (projectId) => set({ projectId }),
  
  addWarning: (warning) => set((state) => ({
    warnings: [...state.warnings, warning]
  })),
  
  clearWarnings: () => set({ warnings: [] }),
  
  wakeVM: async () => {
    const { projectId } = get();
    if (!projectId) return;
    
    set((state) => ({
      vmState: { ...state.vmState, status: 'waking' }
    }));
    
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/exec/${projectId}/wake`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`
          }
        }
      );
      
      if (!response.ok) throw new Error('Failed to wake VM');
      
      set((state) => ({
        vmState: { ...state.vmState, status: 'running' }
      }));
    } catch (error) {
      set((state) => ({
        vmState: { ...state.vmState, status: 'crashed', error: String(error) }
      }));
    }
  },
  
  restartVM: async () => {
    const { projectId } = get();
    if (!projectId) return;
    
    set((state) => ({
      vmState: { ...state.vmState, status: 'starting' }
    }));
    
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/exec/${projectId}/restart`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`
          }
        }
      );
      
      if (!response.ok) throw new Error('Failed to restart VM');
      
      set((state) => ({
        vmState: { ...state.vmState, status: 'running' }
      }));
    } catch (error) {
      set((state) => ({
        vmState: { ...state.vmState, status: 'crashed', error: String(error) }
      }));
    }
  },
  
  hardResetVM: async () => {
    const { projectId } = get();
    if (!projectId) return;
    
    set((state) => ({
      vmState: { ...state.vmState, status: 'starting' }
    }));
    
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/exec/${projectId}/hard-reset`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`
          }
        }
      );
      
      if (!response.ok) throw new Error('Failed to hard reset VM');
      
      set((state) => ({
        vmState: { ...state.vmState, status: 'running' }
      }));
    } catch (error) {
      set((state) => ({
        vmState: { ...state.vmState, status: 'crashed', error: String(error) }
      }));
    }
  }
}));

// Helper to get auth token
function getAuthToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('session-token='))
    ?.split('=')[1] || '';
}
```

---

## 5. Status Indicator Component

### 5.1 VM Status Badge (src/environment/VMStatusBadge.tsx)

```typescript
'use client';

import { useEnvironmentStore } from './store';
import { VMStatus } from './types';
import { Power, RefreshCw, AlertTriangle } from 'lucide-react';

const STATUS_CONFIG: Record<VMStatus, { color: string; icon: string; label: string }> = {
  running: { color: 'bg-green-500', icon: '🟢', label: 'Running' },
  waking: { color: 'bg-yellow-500', icon: '🟡', label: 'Waking' },
  hibernating: { color: 'bg-gray-500', icon: '😴', label: 'Hibernating' },
  crashed: { color: 'bg-red-500', icon: '🔴', label: 'Crashed' },
  starting: { color: 'bg-blue-500', icon: '🔵', label: 'Starting' },
  stopping: { color: 'bg-orange-500', icon: '🟠', label: 'Stopping' }
};

export function VMStatusBadge() {
  const { vmState, wakeVM, restartVM } = useEnvironmentStore();
  const config = STATUS_CONFIG[vmState.status];

  const handleClick = () => {
    // Open action menu (would integrate with Radix Popover)
    showActionMenu();
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 px-3 py-1 rounded-md bg-gray-800 hover:bg-gray-700 transition-colors"
    >
      <span className={`w-2 h-2 rounded-full ${config.color}`} />
      <span className="text-sm text-gray-200">
        {config.icon} {config.label}
        {vmState.status === 'waking' && vmState.wakeupTime && ` (${vmState.wakeupTime}s)`}
      </span>
    </button>
  );
}

function showActionMenu() {
  // This would open a Radix UI Popover with actions
  console.log('Show action menu');
}
```

---

## 6. Resource Warning Toast

### 6.1 Warning Banner (src/environment/ResourceWarning.tsx)

```typescript
'use client';

import { useEnvironmentStore } from './store';
import { AlertTriangle, X, Sparkles } from 'lucide-react';
import { useEffect } from 'react';

export function ResourceWarning() {
  const { warnings, clearWarnings } = useEnvironmentStore();
  
  const latestWarning = warnings[warnings.length - 1];
  
  if (!latestWarning) return null;

  const getWarningConfig = (type: string) => {
    switch (type) {
      case 'oom':
        return {
          title: 'Out of Memory',
          message: 'Your app ran out of memory.',
          action: 'Restart Server'
        };
      case 'cpu':
        return {
          title: 'High CPU Usage',
          message: 'Your code is using too much CPU.',
          action: 'View Process'
        };
      case 'timeout':
        return {
          title: 'Request Timeout',
          message: 'Your request took too long.',
          action: 'Retry'
        };
      default:
        return {
          title: 'Resource Warning',
          message: latestWarning.message,
          action: 'View Details'
        };
    }
  };

  const config = getWarningConfig(latestWarning.type);

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-3 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-5 h-5" />
        <div>
          <span className="font-semibold">{config.title}:</span>{' '}
          <span>{config.message}</span>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            // Trigger AI to find the issue
            console.log('Ask AI to fix');
          }}
          className="flex items-center gap-1 px-3 py-1 bg-white/20 rounded hover:bg-white/30 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          <span>Ask AI to fix</span>
        </button>
        
        <button
          onClick={() => {
            // Restart the server
            useEnvironmentStore.getState().restartVM();
          }}
          className="px-3 py-1 bg-white text-red-600 rounded font-medium hover:bg-gray-100 transition-colors"
        >
          {config.action}
        </button>
        
        <button
          onClick={clearWarnings}
          className="p-1 hover:bg-white/20 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

---

## 7. WebSocket Integration

### 7.1 VM State Listener (src/environment/useVMState.ts)

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { useEnvironmentStore } from './store';
import { VMStatus } from './types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://ws.platform.io/gateway';

export function useVMState(projectId: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const { setVMState, addWarning } = useEnvironmentStore();

  useEffect(() => {
    if (!projectId) return;

    // Connect to WebSocket
    const ws = new WebSocket(`${WS_URL}?projectId=${projectId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Subscribe to VM events
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: `vm:${projectId}`
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleVMMessage(message);
      } catch (e) {
        console.error('Failed to parse VM message:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('VM WebSocket error:', error);
    };

    ws.onclose = () => {
      // Attempt reconnect after 5 seconds
      setTimeout(() => {
        if (projectId) {
          console.log('Reconnecting to VM WebSocket...');
        }
      }, 5000);
    };

    // Poll VM status every 30 seconds as backup
    const pollInterval = setInterval(() => {
      fetchVMStatus(projectId);
    }, 30000);

    // Initial fetch
    fetchVMStatus(projectId);

    return () => {
      ws.close();
      clearInterval(pollInterval);
    };
  }, [projectId]);

  const handleVMMessage = (message: any) => {
    switch (message.type) {
      case 'vm_status':
        setVMState({
          status: message.status as VMStatus,
          wakeupTime: message.wakeupTime,
          memoryUsage: message.memoryUsage,
          cpuUsage: message.cpuUsage
        });
        break;

      case 'vm_waking':
        setVMState({ status: 'waking' });
        break;

      case 'vm_ready':
        setVMState({ status: 'running' });
        break;

      case 'vm_stopped':
        setVMState({ status: 'hibernating' });
        break;

      case 'vm_crashed':
        setVMState({ 
          status: 'crashed', 
          error: message.error 
        });
        break;

      case 'resource_exhausted':
        addWarning({
          type: message.reason || 'oom',
          message: message.message,
          timestamp: new Date()
        });
        break;

      case 'resource_warning':
        setVMState({
          memoryUsage: message.memoryUsage,
          cpuUsage: message.cpuUsage
        });
        break;
    }
  };

  const fetchVMStatus = async (projectId: string) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/exec/${projectId}/status`,
        {
          headers: {
            'Authorization': `Bearer ${getToken()}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setVMState({
          status: data.status,
          wakeupTime: data.wakeupTime,
          memoryUsage: data.memoryUsage,
          cpuUsage: data.cpuUsage,
          lastActive: data.lastActive ? new Date(data.lastActive) : null
        });
      }
    } catch (e) {
      console.error('Failed to fetch VM status:', e);
    }
  };
}

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('session-token='))
    ?.split('=')[1] || '';
}
```

---

## 8. Status Bar Integration

### 8.1 Environment Footer (src/environment/EnvironmentStatusBar.tsx)

```typescript
'use client';

import { useEnvironmentStore } from './store';
import { useVMState } from './useVMState';
import { VMStatusBadge } from './VMStatusBadge';
import { ResourceWarning } from './ResourceWarning';
import { Cpu, HardDrive, Clock } from 'lucide-react';

interface EnvironmentStatusBarProps {
  projectId: string;
}

export function EnvironmentStatusBar({ projectId }: EnvironmentStatusBarProps) {
  // Initialize WebSocket listener
  useVMState(projectId);
  
  const { vmState, warnings } = useEnvironmentStore();

  return (
    <>
      {/* Resource warning toast */}
      {warnings.length > 0 && <ResourceWarning />}
      
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-t border-gray-700">
        <div className="flex items-center gap-4">
          {/* VM Status */}
          <VMStatusBadge />
          
          {/* Resource usage (only when running) */}
          {vmState.status === 'running' && (
            <>
              <div className="flex items-center gap-1 text-gray-400">
                <HardDrive className="w-4 h-4" />
                <span className="text-xs">
                  {vmState.memoryUsage ? `${Math.round(vmState.memoryUsage / 1024)}GB` : '--'}
                </span>
              </div>
              
              <div className="flex items-center gap-1 text-gray-400">
                <Cpu className="w-4 h-4" />
                <span className="text-xs">
                  {vmState.cpuUsage ? `${Math.round(vmState.cpuUsage)}%` : '--'}
                </span>
              </div>
            </>
          )}
          
          {/* Last active */}
          {vmState.lastActive && (
            <div className="flex items-center gap-1 text-gray-400">
              <Clock className="w-4 h-4" />
              <span className="text-xs">
                Last active: {formatLastActive(vmState.lastActive)}
              </span>
            </div>
          )}
        </div>
        
        {/* Error indicator */}
        {vmState.error && (
          <div className="text-red-400 text-xs">
            Error: {vmState.error}
          </div>
        )}
      </div>
    </>
  );
}

function formatLastActive(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  
  return `${Math.floor(hours / 24)}d ago`;
}
```

---

## 9. Action Menu Popover

### 9.1 VM Actions Menu (src/environment/VMActionsMenu.tsx)

```typescript
'use client';

import * as Popover from '@radix-ui/react-popover';
import { useEnvironmentStore } from './store';
import { Power, RefreshCw, Zap, AlertCircle } from 'lucide-react';

export function VMActionsMenu({ children }: { children: React.ReactNode }) {
  const { vmState, wakeVM, restartVM, hardResetVM } = useEnvironmentStore();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        {children}
      </Popover.Trigger>
      
      <Popover.Portal>
        <Popover.Content
          className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-2 min-w-[200px] z-50"
          sideOffset={5}
        >
          <div className="text-xs text-gray-400 px-2 py-1 mb-2">
            VM Actions
          </div>
          
          <button
            onClick={() => wakeVM()}
            disabled={vmState.status === 'running'}
            className="flex items-center gap-2 w-full px-2 py-2 text-left text-gray-200 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Zap className="w-4 h-4 text-yellow-500" />
            <span>Wake Environment</span>
          </button>
          
          <button
            onClick={() => restartVM()}
            disabled={vmState.status === 'starting' || vmState.status === 'stopping'}
            className="flex items-center gap-2 w-full px-2 py-2 text-left text-gray-200 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-4 h-4 text-blue-500" />
            <span>Restart VM</span>
          </button>
          
          <div className="h-px bg-gray-700 my-2" />
          
          <button
            onClick={() => {
              if (confirm('This will wipe all non-persistent data. Continue?')) {
                hardResetVM();
              }
            }}
            disabled={vmState.status === 'starting'}
            className="flex items-center gap-2 w-full px-2 py-2 text-left text-gray-200 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span>Hard Reset (Wipes Data)</span>
          </button>
          
          <Popover.Arrow className="fill-gray-800" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

---

## 10. Testing Checklist

```bash
# Test VM status indicator
# Check status shows correct color and icon

# Test WebSocket connection
# Check VM status updates in real-time

# Test resource warning
# Trigger OOM and verify toast appears

# Test VM actions
# Test wake, restart, hard reset

# Test polling fallback
# Disconnect WebSocket and verify polling works
```

---

## 11. Implementation Status

| Component | Status |
|-----------|--------|
| Types | ✅ Complete |
| Zustand Store | ✅ Complete |
| Status Badge | ✅ Complete |
| Resource Warning | ✅ Complete |
| WebSocket Listener | ✅ Complete |
| Status Bar | ✅ Complete |
| Actions Menu | ✅ Complete |

---

## 12. Key Implementation Notes

### 12.1 Status Display
- Color-coded dot: 🟢 running, 🟡 waking, 😴 hibernating, 🔴 crashed
- Shows wakeup time when waking

### 12.2 Actions
- Wake: Resume from hibernation
- Restart: Soft reboot
- Hard Reset: Wipes non-persistent data

### 12.3 Resource Warnings
- OOM, CPU, Timeout warnings
- Un-missable red toast
- AI fix suggestion button

### 12.4 Polling
- WebSocket primary (real-time)
- 30-second poll fallback
- Auto-reconnect on disconnect
