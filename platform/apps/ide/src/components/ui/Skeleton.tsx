/**
 * Skeleton Loading Component
 *
 * Loading placeholder that mimics the shape of content while loading.
 *
 * @example
 * <Skeleton className="h-4 w-[200px]" />
 * <div className="space-y-2">
 *   <Skeleton className="h-4 w-full" />
 *   <Skeleton className="h-4 w-[80%]" />
 * </div>
 */

import { cn } from '../../lib/utils';

/**
 * Skeleton component props
 */
interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether to show animation */
  animate?: boolean;
}

/**
 * Skeleton loading placeholder
 */
function Skeleton({
  className,
  animate = true,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-md bg-[var(--bg-elevated)]',
        animate && 'animate-pulse',
        className
      )}
      {...props}
    />
  );
}

/**
 * Skeleton text lines component
 */
function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton card component
 */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-lg border border-[var(--border-muted)] p-4 space-y-3', className)}>
      <Skeleton className="h-5 w-1/3" />
      <SkeletonText lines={2} />
    </div>
  );
}

/**
 * Skeleton avatar component
 */
function SkeletonAvatar({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12',
  };

  return (
    <Skeleton
      className={cn('rounded-full', sizeClasses[size], className)}
    />
  );
}

export { Skeleton, SkeletonText, SkeletonCard, SkeletonAvatar };
