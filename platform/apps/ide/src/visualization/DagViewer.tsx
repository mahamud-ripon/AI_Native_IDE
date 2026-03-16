/**
 * D3.js AI Workflow DAG Visualization
 * 
 * Visualizes the LangGraph agent workflow as an interactive Directed Acyclic Graph.
 * Shows agent execution status, dependencies, and progress in real-time.
 * 
 * Features:
 * - Interactive node dragging
 * - Zoom and pan
 * - Real-time status updates (pending → running → completed/failed)
 * - Token usage analytics
 * - Agent output streaming
 * 
 * Agents:
 * - PM Agent → Architect → Backend/Frontend (parallel) → DevOps → QA → Security
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';

// ========================================
// Types
// ========================================

export interface DagNode {
  id: string;
  label: string;
  type: 'agent' | 'gate' | 'start' | 'end';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
  tokens?: {
    input: number;
    output: number;
  };
  startTime?: number;
  endTime?: number;
  error?: string;
  // D3 force simulation properties
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
  index?: number;
}

export interface DagEdge {
  source: string;
  target: string;
  type: 'sequential' | 'parallel' | 'conditional';
}

export interface DagData {
  nodes: DagNode[];
  edges: DagEdge[];
  conversationId?: string;
  totalTokens?: number;
  totalCost?: number;
}

interface DagViewerProps {
  data: DagData;
  width?: number;
  height?: number;
  onNodeClick?: (node: DagNode) => void;
}

// ========================================
// Color Schemes
// ========================================

const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280',    // Gray
  running: '#3b82f6',    // Blue
  completed: '#22c55e',  // Green
  failed: '#ef4444',     // Red
  skipped: '#9ca3af',    // Light Gray
};

const NODE_COLORS: Record<string, string> = {
  agent: '#8b5cf6',  // Violet
  gate: '#f59e0b',   // Amber
  start: '#10b981',  // Emerald
  end: '#6366f1',    // Indigo
};

// ========================================
// Component
// ========================================

export function DagViewer({
  data,
  width = 800,
  height = 500,
  onNodeClick,
}: DagViewerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Render DAG
  useEffect(() => {
    if (!svgRef.current || data.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 40, right: 40, bottom: 40, left: 40 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom as any);

    // Reset zoom button
    svg.append('g')
      .attr('class', 'zoom-reset')
      .attr('transform', `translate(${width - 60}, 30)`)
      .append('rect')
      .attr('width', 50)
      .attr('height', 24)
      .attr('rx', 4)
      .attr('fill', '#374151')
      .attr('cursor', 'pointer')
      .on('click', () => {
        svg.transition().duration(300).call(
          (zoom as any).transform,
          d3.zoomIdentity
        );
      });

    svg.append('text')
      .attr('x', width - 35)
      .attr('y', 46)
      .attr('fill', '#9ca3af')
      .attr('font-size', '11px')
      .attr('text-anchor', 'middle')
      .text('Reset');

    // Force simulation
    const simulation = d3.forceSimulation(data.nodes as any)
      .force('link', d3.forceLink(data.edges).id((d: any) => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(innerWidth / 2, innerHeight / 2))
      .force('collide', d3.forceCollide(40));

    // Draw edges first (so they appear behind nodes)
    const link = g.append('g')
      .selectAll('path')
      .data(data.edges)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', '#4b5563')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', function(this: any, d: any) {
        if (d.type === 'conditional') return '5,5';
        return undefined as any;
      })
      .attr('marker-end', 'url(#arrowhead)');

    // Arrow marker
    svg.append('defs')
      .append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 30)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('fill', '#4b5563')
      .attr('d', 'M0,-5L10,0L0,5');

    // Draw nodes
    const node = g.append('g')
      .selectAll('g')
      .data(data.nodes)
      .join('g')
      .call(
        d3
          .drag<any, DagNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on('click', (event, d) => {
        if (onNodeClick) onNodeClick(d);
      });

    // Node circles
    node.append('circle')
      .attr('r', 25)
      .attr('fill', (d) => NODE_COLORS[d.type] || STATUS_COLORS[d.status])
      .attr('stroke', (d) => STATUS_COLORS[d.status])
      .attr('stroke-width', 3)
      .attr('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        d3.select(this).attr('stroke-width', 5);
        
        // Show tooltip
        if (tooltipRef.current) {
          tooltipRef.current.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px;">${d.label}</div>
            <div style="font-size: 11px; color: #9ca3af;">
              Status: ${d.status}<br/>
              ${d.tokens ? `Tokens: ${d.tokens.input + d.tokens.output}<br/>` : ''}
              ${d.error ? `<span style="color: #ef4444;">${d.error}</span>` : ''}
            </div>
          `;
          tooltipRef.current.style.display = 'block';
        }
      })
      .on('mouseout', function () {
        d3.select(this).attr('stroke-width', 3);
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
      });

    // Node icons/labels
    node.append('text')
      .text((d) => {
        const icons: Record<string, string> = {
          agent: '🤖',
          gate: '🚧',
          start: '▶',
          end: '✓',
        };
        return icons[d.type] || '●';
      })
      .attr('x', 0)
      .attr('y', 5)
      .attr('font-size', '14px')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none');

    // Node labels
    node.append('text')
      .text((d) => d.label)
      .attr('x', 32)
      .attr('y', 5)
      .attr('fill', '#e5e7eb')
      .attr('font-size', '12px')
      .attr('font-weight', '500')
      .attr('pointer-events', 'none');

    // Status indicator
    node.append('circle')
      .attr('r', 6)
      .attr('cx', 20)
      .attr('cy', -20)
      .attr('fill', (d) => STATUS_COLORS[d.status])
      .attr('stroke', '#1f2937')
      .attr('stroke-width', 2);

    // Update positions on simulation tick
    simulation.on('tick', () => {
      link.attr('d', (d: any) => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        return `M${d.source.x},${d.source.y}L${d.target.x},${d.target.y}`;
      });

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [data, width, height, onNodeClick]);

  return (
    <div style={{ position: 'relative' }}>
      {/* Stats Header */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 12,
          padding: '8px 12px',
          background: 'rgba(31, 41, 55, 0.5)',
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS.pending }} />
          <span style={{ color: '#9ca3af' }}>Pending</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS.running }} />
          <span style={{ color: '#3b82f6' }}>Running</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS.completed }} />
          <span style={{ color: '#22c55e' }}>Completed</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS.failed }} />
          <span style={{ color: '#ef4444' }}>Failed</span>
        </div>
        {data.totalTokens && (
          <div style={{ marginLeft: 'auto', color: '#9ca3af' }}>
            📊 {data.totalTokens.toLocaleString()} tokens
          </div>
        )}
      </div>

      {/* DAG Visualization */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{
          background: 'rgba(17, 24, 39, 0.5)',
          borderRadius: 8,
          cursor: 'move',
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          top: 60,
          right: 16,
          background: 'rgba(31, 41, 55, 0.95)',
          border: '1px solid #374151',
          borderRadius: 6,
          padding: 12,
          fontSize: 11,
          display: 'none',
          maxWidth: 200,
          pointerEvents: 'none',
        }}
      />

      {/* Instructions */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          fontSize: 11,
          color: '#6b7280',
        }}
      >
        Drag nodes to reposition • Scroll to zoom
      </div>
    </div>
  );
}

// ========================================
// Default Workflow Templates
// ========================================

export const DEFAULT_WORKFLOW: DagData = {
  nodes: [
    { id: 'start', label: 'Start', type: 'start', status: 'completed' },
    { id: 'pm', label: 'PM Agent', type: 'agent', status: 'pending' },
    { id: 'architect', label: 'Architect', type: 'agent', status: 'pending' },
    { id: 'backend', label: 'Backend', type: 'agent', status: 'pending' },
    { id: 'frontend', label: 'Frontend', type: 'agent', status: 'pending' },
    { id: 'devops', label: 'DevOps', type: 'agent', status: 'pending' },
    { id: 'qa', label: 'QA Agent', type: 'agent', status: 'pending' },
    { id: 'security', label: 'Security', type: 'agent', status: 'pending' },
    { id: 'end', label: 'Complete', type: 'end', status: 'pending' },
  ],
  edges: [
    { source: 'start', target: 'pm', type: 'sequential' },
    { source: 'pm', target: 'architect', type: 'sequential' },
    { source: 'architect', target: 'backend', type: 'parallel' },
    { source: 'architect', target: 'frontend', type: 'parallel' },
    { source: 'backend', target: 'devops', type: 'sequential' },
    { source: 'frontend', target: 'devops', type: 'sequential' },
    { source: 'devops', target: 'qa', type: 'sequential' },
    { source: 'qa', target: 'security', type: 'sequential' },
    { source: 'security', target: 'end', type: 'sequential' },
  ],
};
