/**
 * Real-Time Usage Dashboard with D3.js
 * 
 * High-performance D3 SVG rendering for live metrics.
 * Uses sliding window algorithm to prevent memory leaks.
 * Fully responsive with mobile/tablet/desktop breakpoints.
 */

'use client';

import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { MetricPoint, MetricSeries } from '@/types';
import {
  useResizeObserver,
  getResponsiveMargins,
  getResponsiveFontSizes,
  getResponsiveTickCount,
  getResponsiveLegendPosition,
  truncateLabel,
} from '@/hooks/useResizeObserver';

interface UsageDashboardProps {
  data: MetricSeries[];
  width?: number;
  height?: number;
  maxTicks?: number;
}

const COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#ef4444', // red
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
];

export function UsageDashboard({
  data,
  width = 800,
  height = 400,
  maxTicks = 600,
}: UsageDashboardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerRef, dimensions, containerRefObject] = useResizeObserver({ initialWidth: width, initialHeight: height });

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const svg = d3.select(svgRef.current);
    const { width: w, height: h, breakpoint } = dimensions;
    const margin = getResponsiveMargins(breakpoint);
    const fonts = getResponsiveFontSizes(breakpoint);
    const innerWidth = w - margin.left - margin.right;
    const innerHeight = h - margin.top - margin.bottom;

    // Clear previous content
    svg.selectAll('*').remove();

    // Create container group
    const g = svg
      .attr('width', w)
      .attr('height', h)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3.scaleTime().range([0, innerWidth]);
    const yScale = d3.scaleLinear().range([innerHeight, 0]);

    // Get all timestamps for x domain
    const allTimestamps = data.flatMap((series) =>
      series.data.map((d) => new Date(d.timestamp))
    );
    const allValues = data.flatMap((series) => series.data.map((d) => d.value));

    xScale.domain(d3.extent(allTimestamps) as [Date, Date]);
    yScale.domain([0, d3.max(allValues) || 100]);

    // Axes with responsive tick counts
    const xAxis = d3.axisBottom(xScale).ticks(getResponsiveTickCount(breakpoint, 'x'));
    const yAxis = d3.axisLeft(yScale).ticks(getResponsiveTickCount(breakpoint, 'y'));

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('font-size', `${fonts.tick}px`);

    g.append('g')
      .attr('class', 'y-axis')
      .call(yAxis)
      .selectAll('text')
      .attr('font-size', `${fonts.tick}px`);

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yScale.ticks(getResponsiveTickCount(breakpoint, 'y')))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', '#e5e7eb')
      .attr('stroke-dasharray', '2,2');

    // Clip path for sliding window
    const clipId = `clip-${Math.random().toString(36).slice(2)}`;
    svg
      .append('defs')
      .append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight);

    // Line generator
    const line = d3
      .line<MetricPoint>()
      .x((d) => xScale(new Date(d.timestamp)))
      .y((d) => yScale(d.value))
      .curve(d3.curveMonotoneX);

    // Draw lines for each series
    const seriesGroups = g
      .selectAll('.series')
      .data(data)
      .enter()
      .append('g')
      .attr('class', 'series')
      .attr('clip-path', `url(#${clipId})`);

    seriesGroups
      .append('path')
      .attr('class', 'line')
      .attr('d', (d) => line(d.data))
      .attr('fill', 'none')
      .attr('stroke', (_, i) => COLORS[i % COLORS.length])
      .attr('stroke-width', breakpoint === 'mobile' ? 1.5 : 2)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');

    // Area fill - hidden on mobile for performance
    if (breakpoint !== 'mobile') {
      const area = d3
        .area<MetricPoint>()
        .x((d) => xScale(new Date(d.timestamp)))
        .y0(innerHeight)
        .y1((d) => yScale(d.value))
        .curve(d3.curveMonotoneX);

      seriesGroups
        .append('path')
        .attr('class', 'area')
        .attr('d', (d) => area(d.data))
        .attr('fill', (_, i) => COLORS[i % COLORS.length])
        .attr('fill-opacity', 0.1);
    }

    // Legend with responsive positioning
    const legendPos = getResponsiveLegendPosition(breakpoint, innerWidth, innerHeight);
    const legend = g
      .append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${legendPos.x}, ${legendPos.y})`);

    if (legendPos.orientation === 'horizontal') {
      // Horizontal legend for mobile
      let offsetX = 0;
      data.forEach((series, i) => {
        const legendItem = legend
          .append('g')
          .attr('transform', `translate(${offsetX}, 0)`);

        legendItem
          .append('rect')
          .attr('width', 10)
          .attr('height', 10)
          .attr('fill', COLORS[i % COLORS.length]);

        legendItem
          .append('text')
          .attr('x', 14)
          .attr('y', 8)
          .attr('font-size', `${fonts.legend}px`)
          .text(truncateLabel(series.name, 60, fonts.legend));

        offsetX += 70;
      });
    } else {
      // Vertical legend for tablet/desktop
      data.forEach((series, i) => {
        const legendItem = legend
          .append('g')
          .attr('transform', `translate(0, ${i * 20})`);

        legendItem
          .append('rect')
          .attr('width', 12)
          .attr('height', 12)
          .attr('fill', COLORS[i % COLORS.length]);

        legendItem
          .append('text')
          .attr('x', 18)
          .attr('y', 10)
          .attr('font-size', `${fonts.legend}px`)
          .text(truncateLabel(series.name, 80, fonts.legend));
      });
    }

    // Tooltip
    const tooltip = d3
      .select(containerRefObject.current)
      .append('div')
      .attr('class', 'absolute hidden bg-white border rounded shadow-lg p-2 text-sm z-10')
      .style('pointer-events', 'none');

    // Bisector for tooltip
    const bisect = d3.bisector<MetricPoint, Date>((d) => new Date(d.timestamp)).left;

    // Vertical line for hover
    const hoverLine = g
      .append('line')
      .attr('class', 'hover-line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#666')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4')
      .attr('opacity', 0);

    // Mouse interaction
    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .on('mousemove', (event) => {
        const [x] = d3.pointer(event);
        const xDate = xScale.invert(x);

        hoverLine.attr('x1', x).attr('x2', x).attr('opacity', 1);

        let tooltipContent = '';
        data.forEach((series, i) => {
          const idx = bisect(series.data, xDate, 1);
          const d0 = series.data[idx - 1];
          const d1 = series.data[idx];
          const d = d1 && xDate.getTime() - new Date(d0.timestamp).getTime() > new Date(d1.timestamp).getTime() - xDate.getTime() ? d1 : d0;

          if (d) {
            tooltipContent += `<div style="color: ${COLORS[i % COLORS.length]}">${truncateLabel(series.name, 100, fonts.legend)}: ${d.value.toFixed(2)}</div>`;
          }
        });

        tooltip
          .html(tooltipContent)
          .style('left', `${x + margin.left + 10}px`)
          .style('top', `${margin.top}px`)
          .classed('hidden', false);
      })
      .on('mouseleave', () => {
        hoverLine.attr('opacity', 0);
        tooltip.classed('hidden', true);
      });

    // Cleanup
    return () => {
      tooltip.remove();
    };
  }, [data, dimensions, maxTicks]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[200px]">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}

/**
 * Sliding Window Line Chart
 * Optimized for real-time streaming with transform-based updates
 */
export function SlidingLineChart({
  data,
  width = 600,
  height = 200,
  maxTicks = 600,
}: {
  data: MetricPoint[];
  width?: number;
  height?: number;
  maxTicks?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const prevDataRef = useRef<MetricPoint[]>([]);

  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const svg = d3.select(svgRef.current);
    const margin = { top: 10, right: 20, bottom: 20, left: 40 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Initialize if needed
    if (svg.select('g.chart').empty()) {
      svg.attr('width', width).attr('height', height);

      const g = svg
        .append('g')
        .attr('class', 'chart')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      // Clip path
      svg
        .append('defs')
        .append('clipPath')
        .attr('id', 'sliding-clip')
        .append('rect')
        .attr('width', innerWidth)
        .attr('height', innerHeight);

      // Grid
      g.append('g').attr('class', 'grid');

      // X axis
      g.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${innerHeight})`);

      // Y axis
      g.append('g').attr('class', 'y-axis');

      // Line path
      g.append('path')
        .attr('class', 'line')
        .attr('clip-path', 'url(#sliding-clip)')
        .attr('fill', 'none')
        .attr('stroke', '#3b82f6')
        .attr('stroke-width', 2);
    }

    const g = svg.select('g.chart');
    const xScale = d3.scaleTime().range([0, innerWidth]);
    const yScale = d3.scaleLinear().range([innerHeight, 0]);

    // Use sliding window
    const windowData = data.slice(-maxTicks);
    const timestamps = windowData.map((d) => new Date(d.timestamp));
    const values = windowData.map((d) => d.value);

    xScale.domain(d3.extent(timestamps) as [Date, Date]);
    yScale.domain([0, d3.max(values) || 100]);

    // Update axes
    const xAxis = d3.axisBottom(xScale).ticks(4);
    const yAxis = d3.axisLeft(yScale).ticks(4);
    
    (g.select('.x-axis') as d3.Selection<SVGGElement, unknown, null, undefined>).call(xAxis);
    (g.select('.y-axis') as d3.Selection<SVGGElement, unknown, null, undefined>).call(yAxis);

    // Line generator
    const line = d3
      .line<MetricPoint>()
      .x((d) => xScale(new Date(d.timestamp)))
      .y((d) => yScale(d.value))
      .curve(d3.curveMonotoneX);

    // Check if new data point added
    const prevLen = prevDataRef.current.length;
    const newLen = windowData.length;
    const isNewPoint = newLen > prevLen && newLen <= maxTicks;

    if (isNewPoint && prevLen > 0) {
      // Sliding animation - translate existing line
      const xDiff = xScale(new Date(windowData[1].timestamp)) - xScale(new Date(windowData[0].timestamp));

      g.select('.line')
        .interrupt()
        .attr('d', line(windowData.slice(0, -1)))
        .transition()
        .duration(1000)
        .ease(d3.easeLinear)
        .attr('transform', `translate(${-xDiff},0)`)
        .on('end', function() {
          d3.select(this).attr('d', line(windowData)).attr('transform', null);
        });
    } else {
      // Full redraw
      g.select('.line').attr('d', line(windowData)).attr('transform', null);
    }

    prevDataRef.current = windowData;
  }, [data, width, height, maxTicks]);

  return <svg ref={svgRef} />;
}
