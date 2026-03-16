/**
 * Admin Data Table Component
 * 
 * Headless table using TanStack Table with server-side pagination, sorting, and filtering.
 * Follows DEVELOPMENT_LOGIC.md specifications for massive data handling.
 */

'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { Button, Badge, Spinner } from '@/components/ui';
import { Pagination } from '@/components/shared';

interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  totalRows: number;
  pageSize?: number;
  currentPage?: number;
  isLoading?: boolean;
  onRowClick?: (row: TData) => void;
  rowActions?: (row: TData) => React.ReactNode;
  getRowId?: (row: TData) => string;
  enableRowSelection?: boolean;
  onSelectionChange?: (selectedIds: string[]) => void;
}

export function DataTable<TData>({
  data,
  columns,
  totalRows,
  pageSize = 20,
  currentPage = 1,
  isLoading = false,
  onRowClick,
  rowActions,
  getRowId,
  enableRowSelection = false,
  onSelectionChange,
}: DataTableProps<TData>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Sync sorting state with URL
  const handleSortingChange = useCallback((updater: React.SetStateAction<SortingState>) => {
    const newSorting = typeof updater === 'function' ? updater(sorting) : updater;
    setSorting(newSorting);
    
    const params = new URLSearchParams(searchParams);
    if (newSorting.length > 0) {
      params.set('sortBy', newSorting[0].id);
      params.set('sortOrder', newSorting[0].desc ? 'desc' : 'asc');
    } else {
      params.delete('sortBy');
      params.delete('sortOrder');
    }
    params.delete('page');
    router.push(`?${params.toString()}`);
  }, [sorting, searchParams, router]);

  // Sync row selection with parent
  const handleRowSelectionChange = useCallback((updater: React.SetStateAction<RowSelectionState>) => {
    const newSelection = typeof updater === 'function' ? updater(rowSelection) : updater;
    setRowSelection(newSelection);
    
    if (onSelectionChange) {
      const selectedIds = Object.keys(newSelection).filter(key => newSelection[key]);
      onSelectionChange(selectedIds);
    }
  }, [rowSelection, onSelectionChange]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId,
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: handleRowSelectionChange,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: Math.ceil(totalRows / pageSize),
  });

  const totalPages = Math.ceil(totalRows / pageSize);

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      "px-4 py-3 text-left font-medium text-gray-700",
                      header.column.getCanSort() && "cursor-pointer select-none hover:bg-gray-100"
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-2">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                      {{
                        asc: <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" /></svg>,
                        desc: <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>,
                      }[header.column.getIsSorted() as string]}
                    </div>
                  </th>
                ))}
                {rowActions && (
                  <th className="px-4 py-3 text-right font-medium text-gray-700">Actions</th>
                )}
              </tr>
            ))}
          </thead>
          
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length + (rowActions ? 1 : 0)} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Spinner size="lg" />
                    <span className="text-gray-500">Loading data...</span>
                  </div>
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (rowActions ? 1 : 0)} className="px-4 py-12 text-center text-gray-500">
                  No results found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "hover:bg-gray-50 transition-colors",
                    onRowClick && "cursor-pointer",
                    row.getIsSelected() && "bg-primary-50"
                  )}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {rowActions(row.original)}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalRows}
        itemName="rows"
      />
    </div>
  );
}

// Utility hook for table state from URL
export function useTableStateFromUrl() {
  const searchParams = useSearchParams();
  
  return useMemo(() => ({
    page: parseInt(searchParams.get('page') || '1'),
    pageSize: parseInt(searchParams.get('limit') || '20'),
    sortBy: searchParams.get('sortBy') || undefined,
    sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
    search: searchParams.get('search') || undefined,
  }), [searchParams]);
}
