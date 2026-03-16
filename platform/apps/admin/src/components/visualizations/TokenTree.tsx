/**
 * Token Usage TreeMap with D3.js
 * 
 * Hierarchical visualization of token usage by user/project/agent.
 * Supports drill-down with smooth zoom transitions.
 * Fully responsive with mobile/tablet/desktop breakpoints.
 */

'use client';

import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { TokenUsageNode } from '@/types';
import {
  useResizeObserver,
  getResponsiveFontSizes,
  truncateLabel,
  type Breakpoint,
} from '@/hooks/useResizeObserver';

interface TokenTreeProps {
  data: TokenUsageNode;
  width?: number;
  height?: number;
  onNodeClick?: (node: TokenUsageNode) => void;
}

export function TokenTree({
  data,
  width = 800,
  height = 500,
  onNodeClick,
}: TokenTreeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerRef, dimensions, containerRefObject] = useResizeObserver({ initialWidth: width, initialHeight: height });

  useEffect(() => {
    if (!svgRef.current || !data) return;

    const svg = d3.select(svgRef.current);
    const { width: w, height: h, breakpoint } = dimensions;
    const fonts = getResponsiveFontSizes(breakpoint);

    // Clear previous
    svg.selectAll('*').remove();

    // Create hierarchy
    const root = d3.hierarchy<TokenUsageNode>(data)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // Create treemap layout
    const treemap = d3.treemap<TokenUsageNode>()
      .size([w, h])
      .paddingOuter(breakpoint === 'mobile' ? 2 : 3)
      .paddingTop(breakpoint === 'mobile' ? 15 : 19)
      .paddingInner(1)
      .round(true);

    treemap(root);

    // Type for nodes after treemap layout (adds x0, y0, x1, y1)
    type TreemapLayoutNode = d3.HierarchyNode<TokenUsageNode> & {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };

    // Color scale
    const color = d3.scaleOrdinal(d3.schemeCategory10);

    // Container
    const g = svg.attr('width', w).attr('height', h);

    // Leaf nodes
    const leaf = g.selectAll('g')
      .data(root.leaves() as TreemapLayoutNode[])
      .enter()
      .append('g')
      .attr('transform', (d: TreemapLayoutNode) => `translate(${d.x0},${d.y0})`);

    // Rectangles
    leaf.append('rect')
      .attr('id', (_, i) => `leaf-${i}`)
      .attr('class', 'leaf')
      .attr('width', (d: TreemapLayoutNode) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d: TreemapLayoutNode) => Math.max(0, d.y1 - d.y0))
      .attr('fill', (d: TreemapLayoutNode) => {
        // Color based on parent
        const parent = d.parent;
        if (parent) {
          const siblings = parent.children || [];
          const idx = siblings.indexOf(d);
          return color(idx.toString());
        }
        return color('0');
      })
      .attr('fill-opacity', 0.8)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('click', (_, d: TreemapLayoutNode) => {
        if (onNodeClick && d.data) {
          onNodeClick(d.data);
        }
      })
      .on('mouseenter', function() {
        d3.select(this).attr('fill-opacity', 1).attr('stroke-width', 2);
      })
      .on('mouseleave', function() {
        d3.select(this).attr('fill-opacity', 0.8).attr('stroke-width', 1);
      });

    // Labels - responsive visibility
    leaf.append('clipPath')
      .attr('id', (_, i) => `clip-${i}`)
      .append('use')
      .attr('xlink:href', (_, i) => `#leaf-${i}`);

    leaf.append('text')
      .attr('clip-path', (_, i) => `url(#clip-${i})`)
      .attr('x', breakpoint === 'mobile' ? 2 : 4)
      .attr('y', breakpoint === 'mobile' ? 12 : 14)
      .attr('font-size', `${fonts.label}px`)
      .attr('font-weight', '500')
      .attr('fill', '#fff')
      .text((d: TreemapLayoutNode) => {
        const availableWidth = (d.x1 - d.x0) - (breakpoint === 'mobile' ? 4 : 8);
        // Hide labels on very small cells
        if (availableWidth < 25) return '';
        return truncateLabel(d.data.name, availableWidth, fonts.label);
      });

    // Value labels - hidden on mobile for small cells
    leaf.append('text')
      .attr('clip-path', (_, i) => `url(#clip-${i})`)
      .attr('x', breakpoint === 'mobile' ? 2 : 4)
      .attr('y', breakpoint === 'mobile' ? 22 : 28)
      .attr('font-size', `${fonts.label - 1}px`)
      .attr('fill', '#fff')
      .attr('fill-opacity', 0.8)
      .text((d: TreemapLayoutNode) => {
        const availableWidth = (d.x1 - d.x0) - (breakpoint === 'mobile' ? 4 : 8);
        // Hide value labels on mobile or small cells
        if (breakpoint === 'mobile' && availableWidth < 60) return '';
        if (availableWidth < 40) return '';
        return formatTokens(d.value || 0);
      });

    // Group headers
    const groups = g.selectAll('.group')
      .data(root.descendants().filter((d) => d.depth === 1) as TreemapLayoutNode[])
      .enter()
      .append('g')
      .attr('class', 'group')
      .attr('transform', (d: TreemapLayoutNode) => `translate(${d.x0},${d.y0})`);

    groups.append('rect')
      .attr('width', (d: TreemapLayoutNode) => Math.max(0, d.x1 - d.x0))
      .attr('height', breakpoint === 'mobile' ? 13 : 17)
      .attr('fill', (d: TreemapLayoutNode) => color(d.data.name))
      .attr('fill-opacity', 0.3);

    groups.append('text')
      .attr('x', breakpoint === 'mobile' ? 2 : 4)
      .attr('y', breakpoint === 'mobile' ? 10 : 13)
      .attr('font-size', `${fonts.label + 1}px`)
      .attr('font-weight', '600')
      .attr('fill', (d: TreemapLayoutNode) => color(d.data.name))
      .text((d: TreemapLayoutNode) => {
        const availableWidth = (d.x1 - d.x0) - (breakpoint === 'mobile' ? 4 : 8);
        return truncateLabel(d.data.name, availableWidth, fonts.label + 1);
      });

    // Tooltip
    const tooltip = d3.select(containerRefObject.current)
      .append('div')
      .attr('class', 'absolute hidden bg-gray-900 text-white rounded shadow-lg p-3 text-sm z-20')
      .style('pointer-events', 'none');

    leaf.on('mousemove', (event: MouseEvent, d: TreemapLayoutNode) => {
      const [x, y] = d3.pointer(event, containerRefObject.current);
      tooltip
        .html(`
          <div class="font-semibold">${d.data.name}</div>
          <div class="text-gray-300">${formatTokens(d.value || 0)} tokens</div>
          <div class="text-gray-400 text-xs mt-1">Click to drill down</div>
        `)
        .style('left', `${x + 10}px`)
        .style('top', `${y + 10}px`)
        .classed('hidden', false);
    })
    .on('mouseleave', () => {
      tooltip.classed('hidden', true);
    });

    return () => {
      tooltip.remove();
    };
  }, [data, dimensions, onNodeClick]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[300px]">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}

/**
 * Format tokens with K/M suffixes
 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

/**
 * Sunburst Chart for hierarchical token usage
 */
export function TokenSunburst({
  data,
  width = 600,
  height = 600,
}: {
  data: TokenUsageNode;
  width?: number;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const radius = Math.min(width, height) / 2;

  useEffect(() => {
    if (!svgRef.current || !data) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    // Create hierarchy
    const root = d3.hierarchy<TokenUsageNode>(data)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // Partition layout
    const partition = d3.partition<TokenUsageNode>()
      .size([2 * Math.PI, radius]);

    partition(root);

    // Type for nodes after partition layout (adds x0, y0, x1, y1 angles/radii)
    type PartitionLayoutNode = d3.HierarchyNode<TokenUsageNode> & {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };

    // Color scale
    const color = d3.scaleOrdinal(d3.schemeCategory10);
    const arc = d3.arc<PartitionLayoutNode>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => d.y1 - 1);

    // Draw arcs
    g.selectAll('path')
      .data(root.descendants().filter((d) => d.depth) as PartitionLayoutNode[])
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', (d: PartitionLayoutNode) => {
        while (d.depth > 1) d = d.parent! as PartitionLayoutNode;
        return color(d.data.name);
      })
      .attr('fill-opacity', 0.8)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mouseenter', function(_, d) {
        d3.select(this).attr('fill-opacity', 1);
      })
      .on('mouseleave', function() {
        d3.select(this).attr('fill-opacity', 0.8);
      });

    // Center text
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.5em')
      .attr('font-size', '24px')
      .attr('font-weight', 'bold')
      .text('Total');

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1em')
      .attr('font-size', '16px')
      .attr('fill', '#666')
      .text(formatTokens(root.value || 0));

  }, [data, width, height, radius]);

  return <svg ref={svgRef} />;
}
