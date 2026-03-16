/**
 * URL-Driven Modal Component
 * 
 * Follows DEVELOPMENT_LOGIC.md specs:
 * - URL syncing for shareable state
 * - Lazy loading for heavy content
 * - Radix UI Portal for proper stacking
 */

'use client';

import { useEffect, useCallback, Suspense, lazy, ComponentType } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui';

interface ModalConfig {
  modalId: string;
  title?: string;
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnBackdrop?: boolean;
}

interface ModalProps {
  config: ModalConfig;
  children: React.ReactNode;
  onClose?: () => void;
}

const widthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-4xl',
};

export function Modal({ config, children, onClose }: ModalProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const isOpen = searchParams.get('modal') === config.modalId;

  const closeModal = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('modal');
    // Keep other params like userId, etc.
    router.push(`?${params.toString()}`);
    onClose?.();
  }, [searchParams, router, onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeModal]);

  // Prevent body scroll when modal is open
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={config.title ? 'modal-title' : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={config.closeOnBackdrop !== false ? closeModal : undefined}
      />

      {/* Modal content */}
      <div
        className={cn(
          "relative w-full rounded-lg bg-white shadow-xl animate-slide-up",
          widthClasses[config.width || 'md']
        )}
      >
        {/* Header */}
        {config.title && (
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 id="modal-title" className="text-lg font-semibold">
              {config.title}
            </h2>
            <button
              onClick={closeModal}
              className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Lazy Modal - Loads content only when modal opens
 * 
 * Usage:
 * const LazyJsonViewer = lazy(() => import('./JsonViewer'));
 * <LazyModal config={{ modalId: 'json-viewer' }} loader={() => import('./JsonViewer')} />
 */
interface LazyModalProps {
  config: ModalConfig;
  loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>;
  props?: Record<string, unknown>;
}

export function LazyModal({ config, loader, props = {} }: LazyModalProps) {
  const LazyComponent = lazy(loader);

  return (
    <Modal config={config}>
      <Suspense fallback={
        <div className="flex h-32 items-center justify-center">
          <Spinner size="lg" />
        </div>
      }>
        <LazyComponent {...props} />
      </Suspense>
    </Modal>
  );
}

/**
 * Hook to open a modal with URL state
 */
export function useOpenModal() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const openModal = useCallback((modalId: string, params?: Record<string, string>) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('modal', modalId);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        newParams.set(key, value);
      });
    }
    
    router.push(`?${newParams.toString()}`);
  }, [searchParams, router]);

  return openModal;
}

/**
 * Hook to close current modal
 */
export function useCloseModal() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const closeModal = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('modal');
    router.push(`?${params.toString()}`);
  }, [searchParams, router]);

  return closeModal;
}

/**
 * Hook to get current modal state from URL
 */
export function useModalState() {
  const searchParams = useSearchParams();

  return {
    isOpen: (modalId: string) => searchParams.get('modal') === modalId,
    currentModal: searchParams.get('modal'),
    params: Object.fromEntries(searchParams.entries()),
  };
}
