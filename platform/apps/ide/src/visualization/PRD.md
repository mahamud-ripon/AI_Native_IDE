# IDE Visualization - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/visualization/`  
> **Tech Stack:** D3.js + React + SSE

---

## 1. Executive Summary

The Visualization component renders the AI Agent orchestration DAG (Directed Acyclic Graph) using D3.js. It shows real-time agent status updates via Server-Sent Events.

---

## 2. Dependencies

```bash
npm install d3 @types/d3
```

---

## 3. DAG Visualization

### 3.1 DagViewer (src/visualization/DagViewer.tsx)

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface AgentNode {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface AgentEdge {
  source: string;
  target: string;
}

interface DagViewerProps {
  nodes: AgentNode[];
  edges: AgentEdge[];
  width?: number;
  height?: number;
}

export function DagViewer({ nodes, edges, width = 600, height = 400 }: DagViewerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<AgentNode | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Force simulation
    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(edges).id((d: any) => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(50));

    // Draw edges
    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', '#4b5563')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.6);

    // Draw nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (event, d) => {
        setSelectedNode(d);
      })
      .call(d3.drag<any, AgentNode>()
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
        }));

    // Node circles
    node.append('circle')
      .attr('r', 24)
      .attr('fill', d => getStatusColor(d.status))
      .attr('stroke', '#fff')
      .attr('stroke-width', 3)
      .transition()
      .duration(500)
      .attr('r', 24);

    // Node labels
    node.append('text')
      .text(d => d.label)
      .attr('x', 30)
      .attr('y', 5)
      .attr('fill', '#fff')
      .attr('font-size', '12px')
      .attr('font-weight', '500');

    // Status icons
    node.append('text')
      .text(d => getStatusIcon(d.status))
      .attr('x', 0)
      .attr('y', 5)
      .attr('text-anchor', 'middle')
      .attr('font-size', '14px');

    // Update positions
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [nodes, edges, width, height]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#3b82f6';
      case 'completed': return '#22c55e';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return '⚡';
      case 'completed': return '✓';
      case 'failed': return '✗';
      default: return '○';
    }
  };

  return (
    <div className="relative bg-gray-900 rounded-lg overflow-hidden">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full"
      />
      
      {selectedNode && (
        <div className="absolute top-2 right-2 bg-gray-800 p-3 rounded-lg text-white text-sm">
          <div className="font-semibold">{selectedNode.label}</div>
          <div className="text-gray-400 capitalize">{selectedNode.status}</div>
          <button
            onClick={() => setSelectedNode(null)}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 4. SSE Integration Hook

### 4.2 useAgentStream (src/visualization/useAgentStream.ts)

```typescript
'use client';

import { useEffect, useState, useRef } from 'react';
import { AgentNode, AgentEdge } from './types';

const SSE_URL = process.env.NEXT_PUBLIC_API_URL + '/api/v1/ai/stream';

export function useAgentStream(conversationId: string) {
  const [nodes, setNodes] = useState<AgentNode[]>([]);
  const [edges, setEdges] = useState<AgentEdge[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!conversationId) return;

    const eventSource = new EventSource(
      `${SSE_URL}/${conversationId}/events`
    );
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'agent_update':
            setNodes(prev => {
              const existing = prev.find(n => n.id === data.agent);
              if (existing) {
                return prev.map(n => 
                  n.id === data.agent 
                    ? { ...n, status: data.status }
                    : n
                );
              }
              return [...prev, {
                id: data.agent,
                label: data.agent,
                status: data.status
              }];
            });
            break;

          case 'agent_started':
            setNodes(prev => [...prev, {
              id: data.agent,
              label: data.agent,
              status: 'running'
            }]);
            if (data.from) {
              setEdges(prev => [...prev, { source: data.from, target: data.agent }]);
            }
            break;

          case 'agent_completed':
            setNodes(prev => prev.map(n =>
              n.id === data.agent ? { ...n, status: 'completed' } : n
            ));
            break;

          case 'agent_failed':
            setNodes(prev => prev.map(n =>
              n.id === data.agent ? { ...n, status: 'failed' } : n
            ));
            break;
        }
      } catch (e) {
        console.error('Failed to parse SSE message:', e);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [conversationId]);

  return { nodes, edges };
}
```

---

## 5. Implementation Status

| Component | Status |
|-----------|--------|
| DagViewer | ✅ Complete |
| D3 Force Layout | ✅ Complete |
| Zoom/Pan | ✅ Complete |
| Node Selection | ✅ Complete |
| SSE Integration | ✅ Complete |
| Status Colors | ✅ Complete |
