/**
 * Input Component
 *
 * Text input component with support for icons, validation states, and various sizes.
 *
 * @example
 * <Input placeholder="Enter your name" />
 * <Input icon={<SearchIcon />} placeholder="Search..." />
 * <Input error="This field is required" />
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { cn } from '../../lib/utils';

/**
 * Input variants for different sizes and states
 */
const inputVariants = cva(
  // Base styles
  'flex w-full rounded-md border bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all duration-fast ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-[var(--border-muted)] hover:border-[var(--border-default)]',
        error: 'border-[var(--accent-error)] focus:ring-[var(--accent-error)]',
        success: 'border-[var(--accent-success)] focus:ring-[var(--accent-success)]',
      },
      size: {
        sm: 'h-8 px-2 text-xs',
        md: 'h-9 px-3',
        lg: 'h-10 px-4 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

/**
 * Props for the Input component
 */
export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  /** Icon to display at the start of the input */
  icon?: React.ReactNode;
  /** Icon to display at the end of the input */
  iconRight?: React.ReactNode;
  /** Error message to display */
  error?: string;
  /** Success message to display */
  success?: string;
  /** Whether the input is in a loading state */
  loading?: boolean;
  /** Helper text to display below the input */
  helperText?: string;
  /** Label for the input */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
}

/**
 * Input component with comprehensive styling options
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      variant,
      size,
      icon,
      iconRight,
      error,
      success,
      loading,
      helperText,
      label,
      required,
      disabled,
      id,
      ...props
    },
    ref
  ) => {
    // Generate a unique ID if not provided
    const inputId = id || React.useId();
    const hasError = !!error;
    const hasSuccess = !!success && !hasError;

    // Determine the variant based on state
    const inputVariant = hasError ? 'error' : hasSuccess ? 'success' : variant;

    return (
      <div className="w-full">
        {/* Label */}
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
          >
            {label}
            {required && <span className="ml-1 text-[var(--accent-error)]">*</span>}
          </label>
        )}

        {/* Input container */}
        <div className="relative">
          {/* Left icon */}
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
              {icon}
            </div>
          )}

          {/* Input element */}
          <input
            id={inputId}
            ref={ref}
            disabled={disabled || loading}
            className={cn(
              inputVariants({ variant: inputVariant, size }),
              icon && 'pl-9',
              (iconRight || loading || hasError || hasSuccess) && 'pr-9',
              className
            )}
            aria-invalid={hasError}
            aria-describedby={
              hasError
                ? `${inputId}-error`
                : helperText
                ? `${inputId}-helper`
                : undefined
            }
            {...props}
          />

          {/* Right icon / status indicator */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
            ) : hasError ? (
              <AlertCircle className="h-4 w-4 text-[var(--accent-error)]" />
            ) : hasSuccess ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--accent-success)]" />
            ) : (
              iconRight
            )}
          </div>
        </div>

        {/* Error message */}
        {hasError && (
          <p
            id={`${inputId}-error`}
            className="mt-1.5 flex items-center gap-1 text-xs text-[var(--accent-error)]"
            role="alert"
          >
            <AlertCircle className="h-3 w-3" />
            {error}
          </p>
        )}

        {/* Success message */}
        {hasSuccess && !hasError && (
          <p
            id={`${inputId}-success`}
            className="mt-1.5 flex items-center gap-1 text-xs text-[var(--accent-success)]"
          >
            <CheckCircle2 className="h-3 w-3" />
            {success}
          </p>
        )}

        {/* Helper text */}
        {helperText && !hasError && !hasSuccess && (
          <p
            id={`${inputId}-helper`}
            className="mt-1.5 text-xs text-[var(--text-muted)]"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input, inputVariants };
