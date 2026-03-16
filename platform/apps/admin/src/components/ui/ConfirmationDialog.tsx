/**
 * Confirmation Dialog Component
 * 
 * Reusable modal for confirming destructive actions.
 * Supports single and bulk operations.
 */

'use client';

import { useEffect, useRef } from 'react';
import { Button, Card } from '@/components/ui';

export type ConfirmationVariant = 'danger' | 'warning' | 'info';

interface ConfirmationDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Title of the dialog */
  title: string;
  /** Description/message */
  message: string;
  /** Additional details (shown in smaller text) */
  details?: string;
  /** Variant affects color scheme */
  variant?: ConfirmationVariant;
  /** Confirm button text */
  confirmText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Called when confirmed */
  onConfirm: () => void;
  /** Called when cancelled */
  onCancel: () => void;
  /** Whether operation is in progress */
  isLoading?: boolean;
  /** Whether to show a list of affected items */
  affectedItems?: string[];
  /** Maximum items to show before truncating */
  maxVisibleItems?: number;
}

export function ConfirmationDialog({
  isOpen,
  title,
  message,
  details,
  variant = 'warning',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isLoading = false,
  affectedItems,
  maxVisibleItems = 5,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  // Focus trap
  useEffect(() => {
    if (isOpen && dialogRef.current) {
      const focusableElements = dialogRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      const handleTab = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
      };

      dialogRef.current.addEventListener('keydown', handleTab);
      firstElement?.focus();

      return () => {
        dialogRef.current?.removeEventListener('keydown', handleTab);
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      icon: (
        <svg className="h-12 w-12 text-danger-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
      confirmButton: 'danger' as const,
    },
    warning: {
      icon: (
        <svg className="h-12 w-12 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      confirmButton: 'primary' as const,
    },
    info: {
      icon: (
        <svg className="h-12 w-12 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      confirmButton: 'primary' as const,
    },
  };

  const style = variantStyles[variant];
  const hiddenCount = affectedItems && affectedItems.length > maxVisibleItems
    ? affectedItems.length - maxVisibleItems
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onCancel();
        }
      }}
    >
      <div ref={dialogRef} className="w-full max-w-md mx-4">
        <Card className="p-6">
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="flex flex-col items-center text-center">
            {style.icon}

            <h3 id="dialog-title" className="mt-4 text-lg font-semibold text-gray-900">
              {title}
            </h3>

            <p className="mt-2 text-sm text-gray-600">
              {message}
            </p>

            {details && (
              <p className="mt-1 text-xs text-gray-500">
                {details}
              </p>
            )}

            {affectedItems && affectedItems.length > 0 && (
              <div className="mt-4 w-full">
                <p className="text-xs font-medium text-gray-500 mb-2">
                  Affected items ({affectedItems.length}):
                </p>
                <div className="max-h-32 overflow-y-auto rounded-lg bg-gray-50 p-2">
                  <ul className="text-xs text-gray-600 space-y-1">
                    {affectedItems.slice(0, maxVisibleItems).map((item, i) => (
                      <li key={i} className="truncate">
                        {item}
                      </li>
                    ))}
                    {hiddenCount > 0 && (
                      <li className="text-gray-400 italic">
                        ...and {hiddenCount} more
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={isLoading}
            >
              {cancelText}
            </Button>
            <Button
              variant={style.confirmButton}
              onClick={onConfirm}
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing...
                </span>
              ) : (
                confirmText
              )}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
