/**
 * VM Load Heatmap with D3.js
 * 
 * Real-time heatmap visualization of VM cold start delays
 * and resource utilization across the VM pool.
 * Fully responsive with mobile/tablet/desktop breakpoints.
 */

'use client';

import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { HeatmapCell } from '@/types';
import {
  useResizeObserver,
  getResponsiveMargins,
  getResponsiveFontSizes,
  getResponsiveTickCount,
  truncateLabel,
} from '@/hooks/useResizeObserver';

interface VmHeatmapProps {
  data: HeatmapCell[][];
  width?: number;
  height?: number;
  xLabels?: string[];
  yLabels?: string[];
  colorScale?: [string, string, string]; // low, mid, high
  title?: string;
}

export function VmHeatmap({
  data,
  width = 800,
  height = 400,
  xLabels,
  yLabels,
  colorScale = ['#22c55e', '#f59e0b', '#ef4444'],
  title = 'VM Load Distribution',
}: VmHeatmapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerRef, dimensions, containerRefObject] = useResizeObserver({ initialWidth: width, initialHeight: height });

  useEffect(() => {
    if (!svgRef.current || !data.length || !data[0].length) return;

    const svg = d3.select(svgRef.current);
    const { width: w, height: h, breakpoint } = dimensions;
    const margin = getResponsiveMargins(breakpoint);
    const fonts = getResponsiveFontSizes(breakpoint);
    const innerWidth = w - margin.left - margin.right;
    const innerHeight = h - margin.top - margin.bottom;

    // Clear previous
    svg.selectAll('*').remove();

    const rows = data.length;
    const cols = data[0].length;
    const cellWidth = innerWidth / cols;
    const cellHeight = innerHeight / rows;

    // Color scale
    const color = d3.scaleSequential()
      .interpolator(d3.interpolateRgbBasis(colorScale))
      .domain([0, 100]); // 0-100% load

    // Main container
    const g = svg
      .attr('width', w)
      .attr('height', h)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Title - hidden on mobile to save space
    if (breakpoint !== 'mobile') {
      svg.append('text')
        .attr('x', w / 2)
        .attr('y', margin.top / 2)
        .attr('text-anchor', 'middle')
        .attr('font-size', `${fonts.title}px`)
        .attr('font-weight', '600')
        .text(title);
    }

    // Flatten data for D3
    const flatData: (HeatmapCell & { row: number; col: number })[] = [];
    data.forEach((row, i) => {
      row.forEach((cell, j) => {
        flatData.push({ ...cell, row: i, col: j });
      });
    });

    // Draw cells
    const cells = g.selectAll('.cell')
      .data(flatData)
      .enter()
      .append('rect')
      .attr('class', 'cell')
      .attr('x', (d) => d.col * cellWidth)
      .attr('y', (d) => d.row * cellHeight)
      .attr('width', Math.max(0, cellWidth - 1))
      .attr('height', Math.max(0, cellHeight - 1))
      .attr('fill', (d) => color(d.value))
      .attr('rx', breakpoint === 'mobile' ? 1 : 2)
      .style('cursor', 'pointer');

    // X axis labels - responsive visibility
    if (xLabels) {
      const xTickInterval = breakpoint === 'mobile' ? Math.ceil(cols / 4) : breakpoint === 'tablet' ? Math.ceil(cols / 6) : 1;
      
      g.selectAll('.x-label')
        .data(xLabels.slice(0, cols).filter((_, i) => i % xTickInterval === 0))
        .enter()
        .append('text')
        .attr('class', 'x-label')
        .attr('x', (_, i) => i * xTickInterval * cellWidth + cellWidth * xTickInterval / 2)
        .attr('y', innerHeight + (breakpoint === 'mobile' ? 15 : 20))
        .attr('text-anchor', 'middle')
        .attr('font-size', `${fonts.tick}px`)
        .attr('fill', '#666')
        .text((d) => truncateLabel(d, cellWidth * xTickInterval, fonts.tick));
    }

    // Y axis labels - responsive visibility
    if (yLabels) {
      const yTickInterval = breakpoint === 'mobile' ? Math.ceil(rows / 5) : 1;
      
      g.selectAll('.y-label')
        .data(yLabels.slice(0, rows).filter((_, i) => i % yTickInterval === 0))
        .enter()
        .append('text')
        .attr('class', 'y-label')
        .attr('x', -5)
        .attr('y', (_, i) => i * yTickInterval * cellHeight + cellHeight * yTickInterval / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', `${fonts.tick}px`)
        .attr('fill', '#666')
        .text((d) => truncateLabel(d, margin.left - 10, fonts.tick));
    }

    // Color legend - hidden on mobile to save space
    if (breakpoint !== 'mobile') {
      const legendWidth = breakpoint === 'tablet' ? 100 : 150;
      const legendHeight = 10;
      const legendX = innerWidth - legendWidth - 10;
      const legendY = -15;

      const legendScale = d3.scaleLinear()
        .domain([0, 100])
        .range([0, legendWidth]);

      const legendAxis = d3.axisBottom(legendScale)
        .ticks(getResponsiveTickCount(breakpoint, 'x'))
        .tickFormat((d) => `${d}%`);

      // Legend gradient
      const defs = svg.append('defs');
      const gradientId = 'legend-gradient';

      const gradient = defs.append('linearGradient')
        .attr('id', gradientId)
        .attr('x1', '0%')
        .attr('x2', '100%');

      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', colorScale[0]);

      gradient.append('stop')
        .attr('offset', '50%')
        .attr('stop-color', colorScale[1]);

      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', colorScale[2]);

      g.append('rect')
        .attr('x', legendX)
        .attr('y', legendY)
        .attr('width', legendWidth)
        .attr('height', legendHeight)
        .attr('fill', `url(#${gradientId})`)
        .attr('rx', 2);

      g.append('g')
        .attr('transform', `translate(${legendX},${legendY + legendHeight})`)
        .call(legendAxis)
        .selectAll('text')
        .attr('font-size', `${fonts.tick - 2}px`);
    }

    // Tooltip
    const tooltip = d3.select(containerRefObject.current)
      .append('div')
      .attr('class', 'absolute hidden bg-gray-900 text-white rounded shadow-lg p-2 text-sm z-20')
      .style('pointer-events', 'none');

    cells.on('mouseenter', function(event, d) {
      d3.select(this)
        .attr('stroke', '#000')
        .attr('stroke-width', 2);

      const [x, y] = d3.pointer(event, containerRefObject.current);
      tooltip
        .html(`
          <div class="font-semibold">${d.label || `Cell (${d.row}, ${d.col})`}</div>
          <div class="text-gray-300">Load: ${d.value.toFixed(1)}%</div>
        `)
        .style('left', `${x + 10}px`)
        .style('top', `${y + 10}px`)
        .classed('hidden', false);
    })
    .on('mouseleave', function() {
      d3.select(this).attr('stroke', 'none');
      tooltip.classed('hidden', true);
    });

    return () => {
      tooltip.remove();
    };
  }, [data, dimensions, xLabels, yLabels, colorScale, title]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[250px]">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}

/**
 * Time-based Heatmap for hourly metrics
 */
export function TimeHeatmap({
  data,
  width = 800,
  height = 300,
  days = 7,
  hours = 24,
  colorScale = ['#22c55e', '#f59e0b', '#ef4444'],
}: {
  data: number[]; // Flat array of values [day][hour]
  width?: number;
  height?: number;
  days?: number;
  hours?: number;
  colorScale?: [string, string, string];
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const svg = d3.select(svgRef.current);
    const margin = { top: 30, right: 30, bottom: 30, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const cellWidth = innerWidth / hours;
    const cellHeight = innerHeight / days;

    svg.selectAll('*').remove();

    const color = d3.scaleSequential()
      .interpolator(d3.interpolateRgbBasis(colorScale))
      .domain([0, d3.max(data) || 100]);

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Day labels
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    g.selectAll('.day-label')
      .data(dayNames.slice(0, days))
      .enter()
      .append('text')
      .attr('class', 'day-label')
      .attr('x', -10)
      .attr('y', (_, i) => i * cellHeight + cellHeight / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#666')
      .text((d) => d);

    // Hour labels
    g.selectAll('.hour-label')
      .data(d3.range(0, hours, 4))
      .enter()
      .append('text')
      .attr('class', 'hour-label')
      .attr('x', (d) => d * cellWidth + cellWidth / 2)
      .attr('y', innerHeight + 15)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#666')
      .text((d) => `${d}:00`);

    // Cells
    const cells = g.selectAll('.cell')
      .data(data.map((value, i) => ({
        value,
        day: Math.floor(i / hours),
        hour: i % hours,
      })))
      .enter()
      .append('rect')
      .attr('class', 'cell')
      .attr('x', (d) => d.hour * cellWidth)
      .attr('y', (d) => d.day * cellHeight)
      .attr('width', cellWidth - 1)
      .attr('height', cellHeight - 1)
      .attr('fill', (d) => color(d.value))
      .attr('rx', 2);

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 15)
      .attr('text-anchor', 'middle')
      .attr('font-size', '14px')
      .attr('font-weight', '600')
      .text('Weekly Activity Heatmap');

  }, [data, width, height, days, hours, colorScale]);

  return <svg ref={svgRef} />;
}
