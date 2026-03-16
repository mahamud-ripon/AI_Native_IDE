/**
 * Slide-Over Drawer Component
 * 
 * URL-driven drawer for editing data or viewing complex nested graphs.
 * Follows DEVELOPMENT_LOGIC.md specs.
 */

'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface DrawerConfig {
  drawerId: string;
  title?: string;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  position?: 'left' | 'right';
}

interface DrawerProps {
  config: DrawerConfig;
  children: React.ReactNode;
  onClose?: () => void;
}

const widthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

export function Drawer({ config, children, onClose }: DrawerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const isOpen = searchParams.get('drawer') === config.drawerId;

  const closeDrawer = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('drawer');
    router.push(`?${params.toString()}`);
    onClose?.();
  }, [searchParams, router, onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeDrawer();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeDrawer]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const position = config.position || 'right';

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby={config.title ? 'drawer-title' : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={closeDrawer}
      />

      {/* Drawer panel */}
      <div
        className={cn(
          "fixed top-0 h-full bg-white shadow-xl animate-slide-in",
          widthClasses[config.width || 'lg'],
          position === 'right' ? 'right-0' : 'left-0',
          position === 'right' ? 'animate-slide-in-right' : 'animate-slide-in-left'
        )}
      >
        {/* Header */}
        {config.title && (
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 id="drawer-title" className="text-lg font-semibold">
              {config.title}
            </h2>
            <button
              onClick={closeDrawer}
              className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              aria-label="Close drawer"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="h-full overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Hook to open a drawer with URL state
 */
export function useOpenDrawer() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const openDrawer = useCallback((drawerId: string, params?: Record<string, string>) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('drawer', drawerId);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        newParams.set(key, value);
      });
    }
    
    router.push(`?${newParams.toString()}`);
  }, [searchParams, router]);

  return openDrawer;
}

/**
 * Hook to get current drawer state from URL
 */
export function useDrawerState() {
  const searchParams = useSearchParams();

  return {
    isOpen: (drawerId: string) => searchParams.get('drawer') === drawerId,
    currentDrawer: searchParams.get('drawer'),
    params: Object.fromEntries(searchParams.entries()),
  };
}
