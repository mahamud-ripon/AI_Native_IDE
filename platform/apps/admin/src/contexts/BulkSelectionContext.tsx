/**
 * Bulk Selection Context
 * 
 * Provides selection state management for bulk operations across tables.
 */

'use client';

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export type SelectionType = 'user' | 'vm' | 'project';

interface BulkSelectionContextValue<T> {
  /** Currently selected item IDs */
  selectedIds: Set<string>;
  /** All available items for "select all" functionality */
  allItems: T[];
  /** Total count of all items (for pagination scenarios) */
  totalCount: number;
  /** Whether selection is active */
  hasSelection: boolean;
  /** Whether all items are selected */
  isAllSelected: boolean;
  /** Toggle single item selection */
  toggleItem: (id: string) => void;
  /** Toggle all items selection */
  toggleAll: () => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Set all available items */
  setAllItems: (items: T[]) => void;
  /** Set total count */
  setTotalCount: (count: number) => void;
  /** Get selected items data */
  getSelectedItems: () => T[];
  /** Selection type */
  selectionType: SelectionType;
}

const BulkSelectionContext = createContext<BulkSelectionContextValue<unknown> | null>(null);

interface BulkSelectionProviderProps {
  children: ReactNode;
  selectionType: SelectionType;
  /** Key extractor function for items */
  getKey: (item: unknown) => string;
}

export function BulkSelectionProvider({
  children,
  selectionType,
  getKey,
}: BulkSelectionProviderProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allItems, setAllItemsState] = useState<unknown[]>([]);
  const [totalCount, setTotalCountState] = useState(0);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      // If all visible items are selected, deselect all
      const allVisibleIds = new Set(allItems.map(getKey));
      const allCurrentSelected = [...allVisibleIds].every((id) => prev.has(id));
      
      if (allCurrentSelected) {
        // Deselect all visible items
        const next = new Set(prev);
        allVisibleIds.forEach((id) => next.delete(id));
        return next;
      } else {
        // Select all visible items
        const next = new Set(prev);
        allVisibleIds.forEach((id) => next.add(id));
        return next;
      }
    });
  }, [allItems, getKey]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const setAllItems = useCallback((items: unknown[]) => {
    setAllItemsState(items);
  }, []);

  const setTotalCount = useCallback((count: number) => {
    setTotalCountState(count);
  }, []);

  const getSelectedItems = useCallback(() => {
    return allItems.filter((item) => selectedIds.has(getKey(item)));
  }, [allItems, selectedIds, getKey]);

  const hasSelection = selectedIds.size > 0;
  const isAllSelected = useMemo(() => {
    if (allItems.length === 0) return false;
    return allItems.every((item) => selectedIds.has(getKey(item)));
  }, [allItems, selectedIds, getKey]);

  const value: BulkSelectionContextValue<unknown> = {
    selectedIds,
    allItems,
    totalCount,
    hasSelection,
    isAllSelected,
    toggleItem,
    toggleAll,
    clearSelection,
    setAllItems,
    setTotalCount,
    getSelectedItems,
    selectionType,
  };

  return (
    <BulkSelectionContext.Provider value={value}>
      {children}
    </BulkSelectionContext.Provider>
  );
}

/**
 * Hook to access bulk selection context
 */
export function useBulkSelection<T>(): BulkSelectionContextValue<T> {
  const context = useContext(BulkSelectionContext);
  if (!context) {
    throw new Error('useBulkSelection must be used within a BulkSelectionProvider');
  }
  return context as BulkSelectionContextValue<T>;
}

/**
 * Hook for checkbox selection in table rows
 */
export function useRowSelection(itemId: string): {
  isSelected: boolean;
  toggleSelection: () => void;
} {
  const { selectedIds, toggleItem } = useBulkSelection();
  
  return {
    isSelected: selectedIds.has(itemId),
    toggleSelection: () => toggleItem(itemId),
  };
}
