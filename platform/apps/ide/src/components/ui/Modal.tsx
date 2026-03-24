/**
 * Modal/Dialog Component
 *
 * Accessible modal dialog using Radix UI primitives.
 * Supports custom headers, footers, and various sizes.
 *
 * @example
 * <Modal open={isOpen} onOpenChange={setIsOpen} title="Confirm">
 *   <p>Are you sure?</p>
 * </Modal>
 */

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { cn } from '../../lib/utils';
import { Button } from './Button';

// ========================================
// TYPES
// ========================================

interface ModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Modal title */
  title?: React.ReactNode;
  /** Modal description */
  description?: React.ReactNode;
  /** Modal content */
  children: React.ReactNode;
  /** Footer content (buttons, etc.) */
  footer?: React.ReactNode;
  /** Modal size */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Whether to show close button */
  showCloseButton?: boolean;
  /** Callback when close button is clicked */
  onClose?: () => void;
  /** Prevent closing when clicking outside */
  preventBackdropClose?: boolean;
}

// ========================================
// COMPONENTS
// ========================================

/**
 * Modal component
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  showCloseButton = true,
  onClose,
  preventBackdropClose = false,
}: ModalProps) {
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && onClose) {
      onClose();
    }
    onOpenChange(newOpen);
  };

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-[90vw]',
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
                  onClick={() => !preventBackdropClose && handleOpenChange(false)}
                />
              </DialogPrimitive.Overlay>

              {/* Dialog content */}
              <DialogPrimitive.Content asChild>
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className={cn(
                    'fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2',
                    'bg-[var(--bg-secondary)] border border-[var(--border-muted)] rounded-lg shadow-xl',
                    'flex flex-col max-h-[85vh]',
                    sizeClasses[size]
                  )}
                >
                  {/* Header */}
                  {(title || showCloseButton) && (
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-muted)]">
                      <div className="flex-1">
                        {title && (
                          <DialogPrimitive.Title className="text-base font-semibold text-[var(--text-primary)]">
                            {title}
                          </DialogPrimitive.Title>
                        )}
                        {description && (
                          <DialogPrimitive.Description className="mt-1 text-sm text-[var(--text-muted)]">
                            {description}
                          </DialogPrimitive.Description>
                        )}
                      </div>
                      {showCloseButton && (
                        <DialogPrimitive.Close asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-2"
                            aria-label="Close"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </DialogPrimitive.Close>
                      )}
                    </div>
                  )}

                  {/* Body */}
                  <div className="flex-1 overflow-auto p-4">
                    {!title && description && (
                      <DialogPrimitive.Description className="mb-4 text-sm text-[var(--text-muted)]">
                        {description}
                      </DialogPrimitive.Description>
                    )}
                    {children}
                  </div>

                  {/* Footer */}
                  {footer && (
                    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-muted)]">
                      {footer}
                    </div>
                  )}
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/**
 * Confirm dialog helper
 */
interface ConfirmDialogProps extends Omit<ModalProps, 'children' | 'footer'> {
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  variant?: 'default' | 'destructive';
}

export function ConfirmDialog({
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
  ...props
}: ConfirmDialogProps) {
  return (
    <Modal
      {...props}
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              props.onOpenChange(false);
              onCancel?.();
            }}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm();
              props.onOpenChange(false);
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-[var(--text-secondary)]">
        Are you sure you want to proceed with this action?
      </p>
    </Modal>
  );
}

export { DialogPrimitive };
