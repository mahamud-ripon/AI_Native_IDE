/**
 * Shared TableSkeleton Component
 * 
 * Loading skeleton for table views.
 */

export interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 5 }: TableSkeletonProps) {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="border-b bg-gray-50 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <div
              key={i}
              className="h-4 flex-1 rounded bg-gray-200"
              style={{ maxWidth: `${100 / columns}%` }}
            />
          ))}
        </div>
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="border-b px-4 py-4">
          <div className="flex gap-4">
            {Array.from({ length: columns }).map((_, colIndex) => (
              <div
                key={colIndex}
                className="h-4 flex-1 rounded bg-gray-100"
                style={{ maxWidth: `${100 / columns}%` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface CardSkeletonProps {
  lines?: number;
}

export function CardSkeleton({ lines = 3 }: CardSkeletonProps) {
  return (
    <div className="animate-pulse rounded-lg border bg-white p-4 shadow-sm">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded bg-gray-200"
          style={{ width: `${Math.random() * 40 + 60}%`, marginBottom: i < lines - 1 ? '0.75rem' : 0 }}
        />
      ))}
    </div>
  );
}

export interface MetricSkeletonProps {
  count?: number;
}

export function MetricSkeleton({ count = 4 }: MetricSkeletonProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-2 h-4 w-24 rounded bg-gray-200" />
          <div className="mb-1 h-8 w-16 rounded bg-gray-100" />
          <div className="h-3 w-20 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}
