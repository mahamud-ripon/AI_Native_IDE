/**
 * Virtualized Table Component
 * 
 * For large single-page views with infinite scroll.
 * Uses @tanstack/react-virtual to render only visible rows.
 */

'use client';

import { useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui';

interface VirtualizedTableProps<TData> {
  data: TData[];
  columns: {
    key: string;
    header: string;
    width?: string;
    render: (item: TData) => React.ReactNode;
  }[];
  estimateRowHeight?: number;
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  onRowClick?: (item: TData) => void;
  getRowId?: (item: TData) => string;
}

export function VirtualizedTable<TData>({
  data,
  columns,
  estimateRowHeight = 48,
  isLoading = false,
  onLoadMore,
  hasMore = false,
  onRowClick,
  getRowId,
}: VirtualizedTableProps<TData>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: hasMore ? data.length + 1 : data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Handle infinite scroll
  const handleScroll = useCallback(() => {
    if (!parentRef.current || !onLoadMore || isLoading || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      onLoadMore();
    }
  }, [onLoadMore, isLoading, hasMore]);

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="h-full overflow-auto rounded-lg border bg-white"
    >
      {/* Header - sticky */}
      <div className="sticky top-0 z-10 border-b bg-gray-50">
        <div className="flex">
          {columns.map((col) => (
            <div
              key={col.key}
              className="flex-shrink-0 px-4 py-3 text-left font-medium text-gray-700"
              style={{ width: col.width || 'auto' }}
            >
              {col.header}
            </div>
          ))}
        </div>
      </div>

      {/* Virtualized rows */}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const isLoaderRow = virtualRow.index > data.length - 1;
          const item = data[virtualRow.index];

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {isLoaderRow ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner size="md" />
                </div>
              ) : (
                <div
                  className={cn(
                    "flex h-full items-center border-b hover:bg-gray-50 transition-colors",
                    onRowClick && "cursor-pointer"
                  )}
                  onClick={() => onRowClick?.(item)}
                >
                  {columns.map((col) => (
                    <div
                      key={col.key}
                      className="flex-shrink-0 px-4 py-3 text-sm"
                      style={{ width: col.width || 'auto' }}
                    >
                      {col.render(item)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {data.length === 0 && !isLoading && (
        <div className="flex h-32 items-center justify-center text-gray-500">
          No data available
        </div>
      )}
    </div>
  );
}

export default VirtualizedTable;
