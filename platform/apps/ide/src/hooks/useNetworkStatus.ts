/**
 * useNetworkStatus Hook - Track online/offline status
 * Monitors browser network state
 */

import { useState, useEffect } from 'react';

export interface NetworkState {
  isOnline: boolean;
  lastOnlineAt?: number;
  lastOfflineAt?: number;
}

export function useNetworkStatus() {
  const [state, setState] = useState<NetworkState>({
    isOnline: navigator.onLine,
  });
  
  useEffect(() => {
    const handleOnline = () => {
      setState({
        isOnline: true,
        lastOnlineAt: Date.now(),
      });
    };
    
    const handleOffline = () => {
      setState({
        isOnline: false,
        lastOfflineAt: Date.now(),
      });
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  return state;
}

export default useNetworkStatus;
