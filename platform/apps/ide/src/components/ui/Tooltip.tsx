/**
 * Tooltip Component
 *
 * Accessible tooltip component using Radix UI primitives.
 * Provides contextual information on hover or focus.
 *
 * @example
 * <Tooltip content="Save file">
 *   <Button>Save</Button>
 * </Tooltip>
 */

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

/**
 * Tooltip provider component
 */
const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Tooltip root component
 */
const Tooltip = TooltipPrimitive.Root;

/**
 * Tooltip trigger component
 */
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Tooltip content variants
 */
const tooltipVariants = cva(
  'z-50 overflow-hidden rounded-md bg-[var(--bg-tooltip)] px-3 py-1.5 text-xs text-[var(--text-primary)] shadow-lg animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
  {
    variants: {
      variant: {
        default: 'bg-[var(--bg-tooltip)] text-[var(--text-primary)]',
        destructive: 'bg-[var(--accent-error)] text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

/**
 * Props for the TooltipContent component
 */
interface TooltipContentProps
  extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
    VariantProps<typeof tooltipVariants> {}

/**
 * Tooltip content component
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, variant, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(tooltipVariants({ variant }), className)}
    {...props}
  />
));

TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * Simplified tooltip props for the convenience component
 */
interface SimpleTooltipProps {
  /** Content to display in the tooltip */
  content: React.ReactNode;
  /** Element that triggers the tooltip */
  children: React.ReactNode;
  /** Tooltip position */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Delay before showing tooltip (ms) */
  delayDuration?: number;
  /** Whether tooltip is disabled */
  disabled?: boolean;
}

/**
 * Convenience tooltip component with simplified API
 */
function SimpleTooltip({
  content,
  children,
  side = 'top',
  delayDuration = 200,
  disabled = false,
}: SimpleTooltipProps) {
  if (disabled) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  SimpleTooltip,
};
