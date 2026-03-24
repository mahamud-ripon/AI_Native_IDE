/**
 * Split Editor Component
 *
 * Enables side-by-side editing with resizable panels.
 * Supports horizontal and vertical splits.
 *
 * @example
 * <SplitEditor direction="horizontal">
 *   <Editor content={file1} />
 *   <Editor content={file2} />
 * </SplitEditor>
 */

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Columns, Rows, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { SimpleTooltip as Tooltip } from '@/components/ui/Tooltip';

// ============================================================================
// Types
// ============================================================================

export type SplitDirection = 'horizontal' | 'vertical';

export interface EditorViewState {
  id: string;
  filePath: string;
  content: string;
  language?: string;
  isActive?: boolean;
}

export interface SplitEditorProps {
  views: EditorViewState[];
  direction?: SplitDirection;
  activeViewId?: string;
  onViewSelect?: (viewId: string) => void;
  onViewClose?: (viewId: string) => void;
  onDirectionChange?: (direction: SplitDirection) => void;
  children?: React.ReactNode;
  className?: string;
}

// ============================================================================
// Split Handle Component
// ============================================================================

interface SplitHandleProps {
  direction: SplitDirection;
  onMouseDown: (e: React.MouseEvent) => void;
}

function SplitHandle({ direction, onMouseDown }: SplitHandleProps) {
  const isHorizontal = direction === 'horizontal';

  return (
    <div
      className={cn(
        'relative flex items-center justify-center',
        'bg-ide-border hover:bg-ide-accent-primary/50',
        'transition-colors duration-fast z-10',
        isHorizontal
          ? 'w-1 cursor-col-resize mx-[-2px]'
          : 'h-1 cursor-row-resize my-[-2px]'
      )}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      aria-label="Resize editor panels"
    >
      <div
        className={cn(
          'rounded-full bg-ide-text-tertiary',
          isHorizontal ? 'w-0.5 h-8' : 'w-8 h-0.5'
        )}
      />
    </div>
  );
}

// ============================================================================
// View Tab Component
// ============================================================================

interface ViewTabProps {
  view: EditorViewState;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function ViewTab({ view, isActive, onSelect, onClose }: ViewTabProps) {
  return (
    <motion.div
      layout
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-2 px-3 py-1.5',
        'cursor-pointer select-none transition-all duration-fast',
        'border-r border-ide-border',
        isActive
          ? 'bg-ide-bg-primary text-ide-text-primary'
          : 'bg-ide-bg-secondary text-ide-text-secondary hover:bg-ide-bg-tertiary'
      )}
    >
      <span className="flex-1 truncate text-xs">{view.filePath.split('/').pop()}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          'opacity-0 group-hover:opacity-100',
          'flex items-center justify-center w-4 h-4 rounded',
          'text-ide-text-muted hover:text-ide-text-primary hover:bg-ide-bg-elevated',
          'transition-all duration-fast'
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </motion.div>
  );
}

// ============================================================================
// Main Split Editor Component
// ============================================================================

export function SplitEditor({
  views,
  direction = 'horizontal',
  activeViewId,
  onViewSelect,
  onViewClose,
  onDirectionChange,
  children,
  className,
}: SplitEditorProps) {
  const [sizes, setSizes] = useState<number[]>(() =>
    Array(views.length).fill(100 / views.length)
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragInfoRef = React.useRef<{
    index: number;
    startPos: number;
    startSizes: number[];
  } | null>(null);

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const isHorizontal = direction === 'horizontal';
    dragInfoRef.current = {
      index,
      startPos: isHorizontal ? e.clientX : e.clientY,
      startSizes: [...sizes],
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragInfoRef.current) return;

      const { index, startPos, startSizes } = dragInfoRef.current;
      const isHorizontal = direction === 'horizontal';
      const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
      const delta = currentPos - startPos;

      // Calculate new sizes based on delta
      const containerSize = isHorizontal
        ? (e.currentTarget as HTMLElement).parentElement?.offsetWidth || 1
        : (e.currentTarget as HTMLElement).parentElement?.offsetHeight || 1;

      const deltaPercent = (delta / containerSize) * 100;

      const newSizes = [...startSizes];
      newSizes[index] = Math.max(10, Math.min(90, startSizes[index] + deltaPercent));
      newSizes[index + 1] = Math.max(10, Math.min(90, startSizes[index + 1] - deltaPercent));

      setSizes(newSizes);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragInfoRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [direction, sizes]);

  const toggleDirection = () => {
    const newDirection = direction === 'horizontal' ? 'vertical' : 'horizontal';
    onDirectionChange?.(newDirection);
  };

  if (views.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full text-ide-text-muted', className)}>
        <div className="text-center">
          <p className="text-sm">No files open</p>
          <p className="text-xs text-ide-text-tertiary mt-1">
            Select a file from the explorer to start editing
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Toolbar */}
      {views.length > 1 && (
        <div className="flex items-center justify-between px-2 py-1 border-b border-ide-border bg-ide-bg-secondary">
          <div className="flex items-center">
            {views.map((view) => (
              <ViewTab
                key={view.id}
                view={view}
                isActive={view.id === activeViewId}
                onSelect={() => onViewSelect?.(view.id)}
                onClose={() => onViewClose?.(view.id)}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip content={direction === 'horizontal' ? 'Vertical split' : 'Horizontal split'} side="top">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={toggleDirection}
              >
                {direction === 'horizontal' ? (
                  <Rows className="h-3.5 w-3.5" />
                ) : (
                  <Columns className="h-3.5 w-3.5" />
                )}
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Editor panels */}
      <div
        className={cn(
          'flex-1 overflow-hidden',
          direction === 'horizontal' ? 'flex-row' : 'flex-col'
        )}
        style={{ display: 'flex' }}
      >
        {React.Children.map(children, (child, index) => (
          <React.Fragment key={index}>
            {index > 0 && (
              <SplitHandle
                direction={direction}
                onMouseDown={(e) => handleMouseDown(index - 1, e)}
              />
            )}
            <div
              className="flex-1 overflow-hidden"
              style={{
                flex: sizes[index] ? `0 0 ${sizes[index]}%` : undefined,
              }}
            >
              {child}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default SplitEditor;
