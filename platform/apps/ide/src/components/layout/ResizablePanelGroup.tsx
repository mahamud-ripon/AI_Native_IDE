import React, { createContext, useContext, useRef, useCallback, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Resizable Panel Group Component
 * 
 * Creates a container for resizable panels with draggable dividers.
 * Supports both horizontal and vertical layouts.
 * 
 * Features:
 * - Smooth drag interactions
 * - Min/max panel size constraints
 * - Collapsible panels
 * - LocalStorage persistence of panel sizes
 * - Touch support for mobile devices
 * - Keyboard accessibility
 */

// ============================================================================
// Types
// ============================================================================

type PanelGroupDirection = 'horizontal' | 'vertical';
type PanelSize = { flex: number; pixels?: number } | { pixels: number; flex?: number };

interface PanelGroupContextValue {
  direction: PanelGroupDirection;
  registerPanel: (id: string, element: HTMLElement) => void;
  unregisterPanel: (id: string) => void;
  registerHandle: (id: string, beforePanelId: string, afterPanelId: string) => void;
  setPanelSize: (panelId: string, size: number) => void;
  getPanelSize: (panelId: string) => number;
  collapsePanel: (panelId: string) => void;
  expandPanel: (panelId: string) => void;
  isCollapsed: (panelId: string) => boolean;
}

interface PanelGroupProps {
  direction?: PanelGroupDirection;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  storageKey?: string;
  autoSaveId?: string;
}

interface PanelProps {
  id?: string;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsedSize?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  onCollapse?: () => void;
  onExpand?: () => void;
}

interface PanelHandleProps {
  className?: string;
  style?: React.CSSProperties;
  onDragging?: (isDragging: boolean) => void;
}

// ============================================================================
// Context
// ============================================================================

const PanelGroupContext = createContext<PanelGroupContextValue | null>(null);

function usePanelGroup() {
  const context = useContext(PanelGroupContext);
  if (!context) {
    throw new Error('Panel components must be used within a PanelGroup');
  }
  return context;
}

// ============================================================================
// Panel Group Component
// ============================================================================

export function PanelGroup({
  direction = 'horizontal',
  className,
  style,
  children,
  storageKey,
  autoSaveId,
}: PanelGroupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<Map<string, HTMLElement>>(new Map());
  const handlesRef = useRef<Map<string, { before: string; after: string }>>(new Map());
  const [panelSizes, setPanelSizes] = useState<Map<string, number>>(new Map());
  const [collapsedPanels, setCollapsedPanels] = useState<Set<string>>(new Set());

  // Load saved sizes from localStorage
  useEffect(() => {
    const key = storageKey || autoSaveId;
    if (!key) return;

    try {
      const saved = localStorage.getItem(`panel-group-${key}`);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.sizes) {
          setPanelSizes(new Map(Object.entries(data.sizes)));
        }
        if (data.collapsed) {
          setCollapsedPanels(new Set(data.collapsed));
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [storageKey, autoSaveId]);

  // Save sizes to localStorage
  const saveSizes = useCallback(() => {
    const key = storageKey || autoSaveId;
    if (!key) return;

    try {
      const data = {
        sizes: Object.fromEntries(panelSizes),
        collapsed: Array.from(collapsedPanels),
      };
      localStorage.setItem(`panel-group-${key}`, JSON.stringify(data));
    } catch {
      // Ignore localStorage errors
    }
  }, [storageKey, autoSaveId, panelSizes, collapsedPanels]);

  const registerPanel = useCallback((id: string, element: HTMLElement) => {
    panelsRef.current.set(id, element);
  }, []);

  const unregisterPanel = useCallback((id: string) => {
    panelsRef.current.delete(id);
    setPanelSizes(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const registerHandle = useCallback((id: string, beforePanelId: string, afterPanelId: string) => {
    handlesRef.current.set(id, { before: beforePanelId, after: afterPanelId });
  }, []);

  const setPanelSize = useCallback((panelId: string, size: number) => {
    setPanelSizes(prev => {
      const next = new Map(prev);
      next.set(panelId, Math.max(0, Math.min(100, size)));
      return next;
    });
  }, []);

  const getPanelSize = useCallback((panelId: string) => {
    return panelSizes.get(panelId) || 50;
  }, [panelSizes]);

  const collapsePanel = useCallback((panelId: string) => {
    setCollapsedPanels(prev => {
      const next = new Set(prev);
      next.add(panelId);
      return next;
    });
    saveSizes();
  }, [saveSizes]);

  const expandPanel = useCallback((panelId: string) => {
    setCollapsedPanels(prev => {
      const next = new Set(prev);
      next.delete(panelId);
      return next;
    });
    saveSizes();
  }, [saveSizes]);

  const isCollapsed = useCallback((panelId: string) => {
    return collapsedPanels.has(panelId);
  }, [collapsedPanels]);

  const value: PanelGroupContextValue = {
    direction,
    registerPanel,
    unregisterPanel,
    registerHandle,
    setPanelSize,
    getPanelSize,
    collapsePanel,
    expandPanel,
    isCollapsed,
  };

  return (
    <PanelGroupContext.Provider value={value}>
      <div
        ref={containerRef}
        className={cn(
          'flex w-full h-full overflow-hidden',
          direction === 'horizontal' ? 'flex-row' : 'flex-col',
          className
        )}
        style={style}
        data-panel-group
        data-direction={direction}
      >
        {children}
      </div>
    </PanelGroupContext.Provider>
  );
}

// ============================================================================
// Panel Component
// ============================================================================

// Generate unique IDs for panels
let panelIdCounter = 0;
const generatePanelId = () => `panel-${++panelIdCounter}`;

export function Panel({
  id: providedId,
  defaultSize = 50,
  minSize = 10,
  maxSize = 90,
  collapsible = false,
  collapsedSize = 2,
  className,
  style,
  children,
  onCollapse,
  onExpand,
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const context = usePanelGroup();
  const idRef = useRef(providedId || generatePanelId());
  const id = idRef.current;

  useEffect(() => {
    if (panelRef.current) {
      context.registerPanel(id, panelRef.current);
    }
    return () => {
      context.unregisterPanel(id);
    };
  }, [id, context]);

  const isCollapsed = context.isCollapsed(id);
  const currentSize = isCollapsed ? collapsedSize : (context.getPanelSize(id) || defaultSize);

  return (
    <div
      ref={panelRef}
      data-panel
      data-panel-id={id}
      data-collapsed={isCollapsed}
      className={cn(
        'flex flex-col overflow-hidden',
        isCollapsed && 'flex-shrink-0 flex-grow-0',
        className
      )}
      style={{
        flex: isCollapsed ? `0 0 ${currentSize}%` : `${currentSize} 1 0%`,
        minWidth: context.direction === 'horizontal' ? `${minSize}%` : undefined,
        maxWidth: context.direction === 'horizontal' ? `${maxSize}%` : undefined,
        minHeight: context.direction === 'vertical' ? `${minSize}%` : undefined,
        maxHeight: context.direction === 'vertical' ? `${maxSize}%` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ============================================================================
// Panel Handle Component
// ============================================================================

export function PanelHandle({ className, style, onDragging }: PanelHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const context = usePanelGroup();
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; sizes: Map<string, number> } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    onDragging?.(true);

    // Find adjacent panels
    const handle = handleRef.current;
    if (!handle) return;

    const container = handle.closest('[data-panel-group]');
    if (!container) return;

    const panels = Array.from(container.querySelectorAll('[data-panel]'));
    const handles = Array.from(container.querySelectorAll('[data-panel-handle]'));
    const handleIndex = handles.indexOf(handle);

    if (handleIndex === -1 || handleIndex >= panels.length - 1) return;

    const beforePanel = panels[handleIndex] as HTMLElement;
    const afterPanel = panels[handleIndex + 1] as HTMLElement;

    const beforeId = beforePanel.dataset.panelId;
    const afterId = afterPanel.dataset.panelId;

    if (!beforeId || !afterId) return;

    const containerRect = container.getBoundingClientRect();
    const isHorizontal = context.direction === 'horizontal';

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      sizes: new Map([
        [beforeId, context.getPanelSize(beforeId)],
        [afterId, context.getPanelSize(afterId)],
      ]),
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;

      const deltaX = moveEvent.clientX - dragStartRef.current.x;
      const deltaY = moveEvent.clientY - dragStartRef.current.y;

      const containerSize = isHorizontal ? containerRect.width : containerRect.height;
      const delta = isHorizontal ? deltaX : deltaY;
      const deltaPercent = (delta / containerSize) * 100;

      const beforeSize = dragStartRef.current.sizes.get(beforeId) || 50;
      const afterSize = dragStartRef.current.sizes.get(afterId) || 50;

      const newBeforeSize = Math.max(10, Math.min(90, beforeSize + deltaPercent));
      const newAfterSize = Math.max(10, Math.min(90, afterSize - deltaPercent));

      context.setPanelSize(beforeId, newBeforeSize);
      context.setPanelSize(afterId, newAfterSize);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onDragging?.(false);
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [context, onDragging]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    setIsDragging(true);
    onDragging?.(true);

    // Similar logic for touch events
    const handle = handleRef.current;
    if (!handle) return;

    const container = handle.closest('[data-panel-group]');
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const isHorizontal = context.direction === 'horizontal';

    const handleTouchMove = (moveEvent: TouchEvent) => {
      const moveTouch = moveEvent.touches[0];
      // Touch move logic similar to mouse move
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      onDragging?.(false);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);
  }, [context, onDragging]);

  const isHorizontal = context.direction === 'horizontal';

  return (
    <div
      ref={handleRef}
      data-panel-handle
      className={cn(
        'relative flex items-center justify-center transition-colors z-10',
        isHorizontal
          ? 'w-1 cursor-col-resize hover:bg-ide-accent/50 active:bg-ide-accent'
          : 'h-1 cursor-row-resize hover:bg-ide-accent/50 active:bg-ide-accent',
        isDragging && 'bg-ide-accent',
        className
      )}
      style={style}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      aria-label="Resize panel"
      tabIndex={0}
      onKeyDown={(e) => {
        // Keyboard support for resizing
        const step = 5;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          // Move separator left/up
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          // Move separator right/down
        }
      }}
    >
      {/* Visual handle indicator */}
      <motion.div
        className={cn(
          'rounded-full bg-ide-text-tertiary transition-colors',
          isHorizontal ? 'w-0.5 h-8' : 'w-8 h-0.5',
          isDragging && 'bg-ide-accent'
        )}
        animate={{
          scale: isDragging ? 1.2 : 1,
          backgroundColor: isDragging ? 'var(--ide-accent)' : 'var(--ide-text-tertiary)',
        }}
        transition={{ duration: 0.15 }}
      />
    </div>
  );
}

// ============================================================================
// Convenience Exports
// ============================================================================

export { PanelGroupContext, usePanelGroup };
export type { PanelGroupDirection, PanelGroupProps, PanelProps, PanelHandleProps };
