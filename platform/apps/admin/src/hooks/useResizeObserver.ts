/**
 * ResizeObserver Hook with Responsive Breakpoints
 * 
 * Provides dynamic dimensions and breakpoint detection for responsive visualizations.
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop' | 'wide';

export interface ResponsiveDimensions {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

interface UseResizeObserverOptions {
  /** Initial width before resize observation */
  initialWidth?: number;
  /** Initial height before resize observation */
  initialHeight?: number;
  /** Mobile breakpoint max width */
  mobileBreakpoint?: number;
  /** Tablet breakpoint max width */
  tabletBreakpoint?: number;
  /** Desktop breakpoint max width */
  desktopBreakpoint?: number;
  /** Debounce resize events (ms) */
  debounceMs?: number;
}

const BREAKPOINTS = {
  mobile: 640,   // < 640px
  tablet: 1024,  // 640px - 1024px
  desktop: 1440, // 1024px - 1440px
  wide: Infinity, // > 1440px
};

/**
 * Determine breakpoint from width
 */
function getBreakpoint(
  width: number,
  mobileBreakpoint: number,
  tabletBreakpoint: number,
  desktopBreakpoint: number
): Breakpoint {
  if (width < mobileBreakpoint) return 'mobile';
  if (width < tabletBreakpoint) return 'tablet';
  if (width < desktopBreakpoint) return 'desktop';
  return 'wide';
}

/**
 * Hook for observing container resize with responsive breakpoint detection
 */
export function useResizeObserver(
  options: UseResizeObserverOptions = {}
): [React.RefCallback<HTMLDivElement>, ResponsiveDimensions, React.RefObject<HTMLDivElement | null>] {
  const {
    initialWidth = 800,
    initialHeight = 400,
    mobileBreakpoint = BREAKPOINTS.mobile,
    tabletBreakpoint = BREAKPOINTS.tablet,
    desktopBreakpoint = BREAKPOINTS.desktop,
    debounceMs = 100,
  } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [dimensions, setDimensions] = useState<ResponsiveDimensions>(() => ({
    width: initialWidth,
    height: initialHeight,
    breakpoint: getBreakpoint(initialWidth, mobileBreakpoint, tabletBreakpoint, desktopBreakpoint),
    isMobile: initialWidth < mobileBreakpoint,
    isTablet: initialWidth >= mobileBreakpoint && initialWidth < tabletBreakpoint,
    isDesktop: initialWidth >= tabletBreakpoint,
  }));

  const refCallback = useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      containerRef.current = null;
      return;
    }
    containerRef.current = node;

    const updateDimensions = (width: number, height: number) => {
      const breakpoint = getBreakpoint(width, mobileBreakpoint, tabletBreakpoint, desktopBreakpoint);
      setDimensions({
        width,
        height,
        breakpoint,
        isMobile: breakpoint === 'mobile',
        isTablet: breakpoint === 'tablet',
        isDesktop: breakpoint === 'desktop' || breakpoint === 'wide',
      });
    };

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;

      // Debounce resize events
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        updateDimensions(width, height || initialHeight);
      }, debounceMs);
    });

    observer.observe(node);

    // Store observer for cleanup
    const currentObserver = observer;
    const currentTimeout = timeoutRef.current;
    
    // Return cleanup function stored on the ref
    (node as HTMLDivElement & { __resizeCleanup?: () => void }).__resizeCleanup = () => {
      if (currentTimeout) {
        clearTimeout(currentTimeout);
      }
      currentObserver.disconnect();
    };
  }, [initialHeight, mobileBreakpoint, tabletBreakpoint, desktopBreakpoint, debounceMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (containerRef.current && '__resizeCleanup' in containerRef.current) {
        (containerRef.current as HTMLDivElement & { __resizeCleanup: () => void }).__resizeCleanup();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [refCallback, dimensions, containerRef];
}

/**
 * Get responsive margins based on breakpoint
 */
export function getResponsiveMargins(breakpoint: Breakpoint) {
  switch (breakpoint) {
    case 'mobile':
      return { top: 20, right: 15, bottom: 40, left: 45 };
    case 'tablet':
      return { top: 25, right: 25, bottom: 50, left: 55 };
    case 'desktop':
    case 'wide':
    default:
      return { top: 30, right: 30, bottom: 60, left: 60 };
  }
}

/**
 * Get responsive font sizes based on breakpoint
 */
export function getResponsiveFontSizes(breakpoint: Breakpoint) {
  switch (breakpoint) {
    case 'mobile':
      return {
        title: 14,
        label: 9,
        tick: 9,
        legend: 10,
      };
    case 'tablet':
      return {
        title: 15,
        label: 10,
        tick: 10,
        legend: 11,
      };
    case 'desktop':
    case 'wide':
    default:
      return {
        title: 16,
        label: 11,
        tick: 11,
        legend: 12,
      };
  }
}

/**
 * Get responsive tick count for axes
 */
export function getResponsiveTickCount(breakpoint: Breakpoint, axis: 'x' | 'y') {
  if (axis === 'x') {
    switch (breakpoint) {
      case 'mobile':
        return 4;
      case 'tablet':
        return 6;
      case 'desktop':
      case 'wide':
      default:
        return 8;
    }
  } else {
    switch (breakpoint) {
      case 'mobile':
        return 3;
      case 'tablet':
        return 4;
      case 'desktop':
      case 'wide':
      default:
        return 5;
    }
  }
}

/**
 * Get responsive legend position
 */
export function getResponsiveLegendPosition(
  breakpoint: Breakpoint,
  innerWidth: number,
  innerHeight: number
): { x: number; y: number; orientation: 'horizontal' | 'vertical' } {
  switch (breakpoint) {
    case 'mobile':
      // Place legend at bottom horizontally
      return { x: innerWidth / 2, y: innerHeight + 25, orientation: 'horizontal' };
    case 'tablet':
      // Place legend at top right
      return { x: innerWidth - 80, y: 0, orientation: 'vertical' };
    case 'desktop':
    case 'wide':
    default:
      // Place legend at top right
      return { x: innerWidth - 100, y: 0, orientation: 'vertical' };
  }
}

/**
 * Calculate if labels should be hidden due to space constraints
 */
export function shouldHideLabels(
  breakpoint: Breakpoint,
  availableSpace: number,
  labelCount: number
): boolean {
  const minSpacePerLabel = breakpoint === 'mobile' ? 40 : breakpoint === 'tablet' ? 50 : 60;
  return availableSpace < minSpacePerLabel * labelCount;
}

/**
 * Truncate label text based on available space
 */
export function truncateLabel(
  text: string,
  availableWidth: number,
  fontSize: number
): string {
  // Approximate character width (varies by font, but reasonable estimate)
  const charWidth = fontSize * 0.6;
  const maxChars = Math.floor(availableWidth / charWidth);
  
  if (text.length <= maxChars) return text;
  if (maxChars < 3) return '';
  return text.slice(0, maxChars - 2) + '…';
}
