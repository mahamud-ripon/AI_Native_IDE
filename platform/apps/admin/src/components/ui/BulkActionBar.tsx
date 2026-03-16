/**
 * Bulk Action Bar Component
 * 
 * Floating action bar that appears when items are selected.
 * Provides bulk action buttons with progress feedback.
 */

'use client';

import { useState, useTransition } from 'react';
import { Button, Spinner } from '@/components/ui';
import { ConfirmationDialog, type ConfirmationVariant } from './ConfirmationDialog';
import type { SelectionType } from '@/contexts/BulkSelectionContext';

export interface BulkAction {
  /** Action identifier */
  id: string;
  /** Display label */
  label: string;
  /** Icon component */
  icon?: React.ReactNode;
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Confirmation dialog settings */
  confirmation?: {
    title: string;
    message: string;
    variant?: ConfirmationVariant;
  };
  /** Whether action is destructive (requires confirmation) */
  isDestructive?: boolean;
  /** Handler for the action */
  onExecute: (selectedIds: string[]) => Promise<{ success: boolean; error?: string }>;
}

interface BulkActionBarProps {
  /** Selection type for display */
  selectionType: SelectionType;
  /** Number of selected items */
  selectedCount: number;
  /** Selected item IDs */
  selectedIds: string[];
  /** Available bulk actions */
  actions: BulkAction[];
  /** Callback to clear selection */
  onClearSelection: () => void;
  /** Callback when action completes successfully */
  onSuccess?: (actionId: string) => void;
  /** Callback when action fails */
  onError?: (actionId: string, error: string) => void;
}

export function BulkActionBar({
  selectionType,
  selectedCount,
  selectedIds,
  actions,
  onClearSelection,
  onSuccess,
  onError,
}: BulkActionBarProps) {
  const [isPending, startTransition] = useTransition();
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    action: BulkAction;
    isOpen: boolean;
  } | null>(null);

  const handleActionClick = (action: BulkAction) => {
    if (action.confirmation || action.isDestructive) {
      setConfirmation({ action, isOpen: true });
    } else {
      executeAction(action);
    }
  };

  const executeAction = (action: BulkAction) => {
    startTransition(async () => {
      setExecutingAction(action.id);
      try {
        const result = await action.onExecute(selectedIds);
        
        if (result.success) {
          onClearSelection();
          onSuccess?.(action.id);
        } else {
          onError?.(action.id, result.error || 'Action failed');
        }
      } finally {
        setExecutingAction(null);
        setConfirmation(null);
      }
    });
  };

  const handleConfirm = () => {
    if (confirmation?.action) {
      executeAction(confirmation.action);
    }
  };

  const handleCancelConfirmation = () => {
    if (!isPending) {
      setConfirmation(null);
    }
  };

  if (selectedCount === 0) return null;

  const selectionLabel = selectionType === 'user' 
    ? 'user' 
    : selectionType === 'vm' 
    ? 'VM' 
    : 'project';

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
        <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-lg">
          {/* Selection count */}
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-600">
              {selectedCount}
            </span>
            <span className="text-sm font-medium text-gray-700">
              {selectedCount === 1 
                ? `${selectionLabel} selected`
                : `${selectionLabel}s selected`}
            </span>
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-200" />

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {actions.map((action) => {
              const isExecuting = executingAction === action.id;
              
              return (
                <Button
                  key={action.id}
                  size="sm"
                  variant={action.variant || 'secondary'}
                  onClick={() => handleActionClick(action)}
                  disabled={isPending && !isExecuting}
                  className="flex items-center gap-2"
                >
                  {isExecuting ? (
                    <>
                      <Spinner size="sm" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      {action.icon}
                      {action.label}
                    </>
                  )}
                </Button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-200" />

          {/* Clear selection */}
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearSelection}
            disabled={isPending}
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {confirmation && (
        <ConfirmationDialog
          isOpen={confirmation.isOpen}
          title={confirmation.action.confirmation?.title || `Confirm ${confirmation.action.label}`}
          message={confirmation.action.confirmation?.message || `Are you sure you want to ${confirmation.action.label.toLowerCase()} ${selectedCount} ${selectionLabel}${selectedCount !== 1 ? 's' : ''}?`}
          variant={confirmation.action.confirmation?.variant || (confirmation.action.isDestructive ? 'danger' : 'warning')}
          confirmText={confirmation.action.label}
          onConfirm={handleConfirm}
          onCancel={handleCancelConfirmation}
          isLoading={isPending}
          affectedItems={selectedIds}
        />
      )}
    </>
  );
}
