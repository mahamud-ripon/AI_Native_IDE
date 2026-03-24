/**
 * Divider/Separator Component
 *
 * Visual separator for dividing content into sections.
 *
 * @example
 * <Divider />
 * <Divider orientation="vertical" />
 * <Divider label="Section" />
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

/**
 * Divider variants
 */
const dividerVariants = cva('shrink-0 bg-[var(--border-muted)]', {
  variants: {
    orientation: {
      horizontal: 'h-px w-full',
      vertical: 'h-full w-px',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
});

/**
 * Divider props
 */
interface DividerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof dividerVariants> {
  /** Optional label to display in the middle of the divider */
  label?: React.ReactNode;
  /** Color variant */
  variant?: 'default' | 'muted' | 'accent';
}

/**
 * Divider component
 */
function Divider({
  className,
  orientation = 'horizontal',
  label,
  variant = 'default',
  ...props
}: DividerProps) {
  const colorClasses = {
    default: 'bg-[var(--border-muted)]',
    muted: 'bg-[var(--border-default)]',
    accent: 'bg-[var(--accent-primary)]',
  };

  if (label) {
    return (
      <div
        className={cn(
          'relative flex items-center',
          orientation === 'horizontal' ? 'w-full' : 'h-full flex-col',
          className
        )}
        {...props}
      >
        <div
          className={cn(
            dividerVariants({ orientation }),
            colorClasses[variant],
            'flex-1'
          )}
        />
        <span
          className={cn(
            'px-2 text-xs text-[var(--text-muted)]',
            orientation === 'vertical' && 'py-2'
          )}
        >
          {label}
        </span>
        <div
          className={cn(
            dividerVariants({ orientation }),
            colorClasses[variant],
            'flex-1'
          )}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(dividerVariants({ orientation }), colorClasses[variant], className)}
      {...props}
    />
  );
}

/**
 * Vertical spacer component
 */
function Spacer({ size = 'md' }: { size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }) {
  const sizeClasses = {
    xs: 'h-1',
    sm: 'h-2',
    md: 'h-4',
    lg: 'h-6',
    xl: 'h-8',
  };

  return <div className={sizeClasses[size]} />;
}

export { Divider, Spacer, dividerVariants };
