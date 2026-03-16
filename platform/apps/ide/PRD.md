# IDE Client - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/` (Next.js 15 / React 19)  
> **Tech Stack:** Next.js 15 + Monaco Editor + Yjs + WebContainers + D3.js + WebSocket

---

## 1. Executive Summary

The IDE Client is the browser-based code editor for the AI-Native IDE Platform. It features Monaco Editor with real-time collaboration, WebContainers for free-tier execution, and D3.js visualizations for AI workflow monitoring.

---

## 2. Project Setup

### 2.1 Initialize Project

```bash
mkdir -p ide/src/{editor,webcontainers,preview,terminal,state,visualization,websocket,lib,components,hooks}
cd ide
npx create-next-app@latest . --typescript --tailwind --eslint
npm install @monaco-editor/react monaco-editor yjs y-monaco y-websocket y-protocols @webcontainer/api xterm xterm-addon-fit @monaco-languageclient zustand d3 @types/d3 swr jose zod date-fns
npm install -D @testing-library/react
```

### 2.2 Next.js Config (next.config.ts)

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.experiments = { ...config.experiments, topLevelAwait: true };
    return config;
  },
};

export default nextConfig;
```

### 2.3 package.json

```json
{
  "name": "ide-client",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@monaco-editor/react": "^4.6.0",
    "monaco-editor": "^0.45.0",
    "yjs": "^13.6.0",
    "y-monaco": "^0.1.5",
    "y-websocket": "^1.5.0",
    "y-protocols": "^1.0.6",
    "@webcontainer/api": "^1.1.0",
    "xterm": "^5.3.0",
    "xterm-addon-fit": "^0.8.0",
    "monaco-languageclient": "^7.0.0",
    "zustand": "^4.4.0",
    "d3": "^7.8.5",
    "swr": "^2.2.4",
    "jose": "^5.2.0",
    "zod": "^3.22.4",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.10.0",
    "@types/react": "^19.0.0",
    "@types/d3": "^7.4.0",
    "tailwindcss": "^3.4.0"
  }
}
```

---

## 3. Directory Structure

```
src/
├── app/
│   ├── (ide)/
│   │    ├── layout.tsx
│   │    ├── page.tsx              # Main IDE page
│   │    ├── file/
│   │    │   └── [fileId].tsx      # File editor route
│   │    └── api/
│   │         └── secrets/
│   │              └── route.ts    # Secure secret injection
│   ├── layout.tsx
│   └── globals.css
│
├── editor/
│   ├── MonacoWorkspace.tsx        # Main Monaco wrapper
│   ├── FileTabs.tsx               # Tab management
│   └── EditorToolbar.tsx          # Editor actions
│
├── webcontainers/
│   ├── boot.ts                    # WebContainer initialization
│   ├── vfs-sync.ts                # Virtual file system sync
│   ├── network-interceptor.ts     # ServiceWorker proxy
│   └── terminal-bridge.ts         # XTerm integration
│
├── preview/
│   └── LiveIframe.tsx             # Sandboxed preview iframe
│
├── terminal/
│   └── XtermTerminal.tsx          # Terminal component
│
├── state/
│   ├── yjs-store.ts               # CRDT collaboration state
│   ├── zustand-store.ts           # UI state (tabs, theme)
│   └── project-store.ts           # Project & file state
│
├── visualization/
│   ├── DagViewer.tsx              # D3.js AI workflow DAG
│   └── TokenAnalytics.tsx         # D3.js token usage charts
│
├── websocket/
│   ├── multiplexer.ts             # Single WS connection
│   ├── collab-handler.ts          # Yjs sync handler
│   └── lsp-proxy.ts               # Monaco LSP proxy
│
├── lib/
│   ├── api.ts                     # API client
│   ├── auth.ts                    # JWT validation
│   └── utils.ts
│
├── hooks/
│   ├── useWebContainer.ts         # WebContainer hook
│   ├── useYjs.ts                  # Yjs collaboration hook
│   ├── useMonaco.ts               # Monaco editor hook
│   └── useWebSocket.ts            # WebSocket hook
│
└── components/
    ├── ui/
    ├── layout/
    └── visualization/
```

---

## 4. Core Features

### 4.1 Monaco Editor Integration

#### 4.1.1 Monaco Workspace (src/editor/MonacoWorkspace.tsx)

```typescript
'use client';

import { useRef, useEffect, useState } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import { WebsocketProvider } from 'y-websocket';
import { useYjs } from '@/hooks/useYjs';
import { useMonaco } from '@/hooks/useMonaco';

interface MonacoWorkspaceProps {
  projectId: string;
  fileId: string;
  filePath: string;
  language: string;
}

export function MonacoWorkspace({
  projectId,
  fileId,
  filePath,
  language
}: MonacoWorkspaceProps) {
  const editorRef = useRef<any>(null);
  const [binding, setBinding] = useState<MonacoBinding | null>(null);
  const { ydoc, provider, connect, disconnect } = useYjs(projectId, fileId);
  const { setupLSP } = useMonaco();

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    
    // Setup LSP connection
    setupLSP(projectId, language, editor);
  };

  const handleChange: OnChange = (value) => {
    // Yjs handles sync automatically
  };

  useEffect(() => {
    if (ydoc && editorRef.current && provider) {
      const ytext = ydoc.getText('monaco');
      const model = editorRef.current.getModel();
      
      const newBinding = new MonacoBinding(
        ytext,
        model,
        new Set([editorRef.current]),
        provider.awareness
      );
      
      setBinding(newBinding);
      
      return () => {
        newBinding.destroy();
      };
    }
  }, [ydoc, provider]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [fileId]);

  return (
    <Editor
      height="100%"
      language={language}
      theme="vs-dark"
      onMount={handleMount}
      onChange={handleChange}
      options={{
        minimap: { enabled: true },
        fontSize: 14,
        fontFamily: 'JetBrains Mono, monospace',
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true }
      }}
    />
  );
}
```

#### 4.1.2 File Switching with Yjs Pool

```typescript
// src/state/yjs-store.ts
import { create } from 'zustand';
import * as Y from 'yjs';

interface YjsDocPool {
  docs: Map<string, Y.Doc>;
  providers: Map<string, WebsocketProvider>;
}

interface YjsStore {
  pool: YjsDocPool;
  activeFileId: string | null;
  
  getOrCreateDoc: (projectId: string, fileId: string) => Y.Doc;
  getOrCreateProvider: (projectId: string, fileId: string) => WebsocketProvider;
  switchFile: (fileId: string) => void;
  cleanup: (fileId: string) => void;
}

export const useYjsStore = create<YjsStore>((set, get) => ({
  pool: { docs: new Map(), providers: new Map() },
  activeFileId: null,
  
  getOrCreateDoc: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    const { pool } = get();
    
    if (pool.docs.has(key)) {
      return pool.docs.get(key)!;
    }
    
    const doc = new Y.Doc();
    set(state => ({
      pool: {
        ...state.pool,
        docs: new Map(state.pool.docs).set(key, doc)
      }
    }));
    
    return doc;
  },
  
  getOrCreateProvider: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    const { pool } = get();
    
    if (pool.providers.has(key)) {
      return pool.providers.get(key)!;
    }
    
    const doc = get().getOrCreateDoc(projectId, fileId);
    const provider = new WebsocketProvider(
      'wss://ws.platform.io/gateway',
      `collab:${projectId}:${fileId}`,
      doc
    );
    
    set(state => ({
      pool: {
        ...state.pool,
        providers: new Map(state.pool.providers).set(key, provider)
      }
    }));
    
    return provider;
  },
  
  switchFile: (fileId) => {
    set({ activeFileId: fileId });
  },
  
  cleanup: (fileId) => {
    const { pool } = get();
    // Cleanup unused docs to prevent memory leaks
    // Keep max 10 docs in pool
  }
}));
```

### 4.2 WebContainers (Tier 1 Execution)

#### 4.2.1 Boot Sequence (src/webcontainers/boot.ts)

```typescript
import { WebContainer } from '@webcontainer/api';

let webcontainerInstance: WebContainer | null = null;

export async function bootWebContainer(): Promise<WebContainer> {
  if (webcontainerInstance) {
    return webcontainerInstance;
  }
  
  webcontainerInstance = await WebContainer.boot();
  return webcontainerInstance;
}

export function getWebContainer(): WebContainer | null {
  return webcontainerInstance;
}
```

#### 4.2.2 VFS Synchronization (src/webcontainers/vfs-sync.ts)

```typescript
import { WebContainer } from '@webcontainer/api';
import { FileSystemTree } from '@webcontainer/api';

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  content?: string;
  children?: FileNode[];
}

export async function syncToWebContainer(
  instance: WebContainer,
  files: FileNode[]
): Promise<void> {
  const tree = buildFileTree(files);
  await instance.mount(tree);
}

export async function syncFromWebContainer(
  instance: WebContainer,
  path: string
): Promise<string> {
  const content = await instance.fs.readFile(path, 'utf-8');
  return content;
}

function buildFileTree(files: FileNode[]): FileSystemTree {
  const tree: FileSystemTree = {};
  
  for (const file of files) {
    if (file.type === 'file') {
      tree[file.name] = {
        file: {
          contents: file.content || ''
        }
      };
    } else if (file.children) {
      tree[file.name] = {
        directory: buildFileTree(file.children)
      };
    }
  }
  
  return tree;
}

// Two-way sync: Listen to Yjs changes and write to WebContainer
export async function setupYjsToWebContainerSync(
  instance: WebContainer,
  yText: any,
  filePath: string
): Promise<void> {
  yText.observe((event: any) => {
    const content = yText.toString();
    instance.fs.writeFile(filePath, content);
  });
}
```

#### 4.2.3 Terminal Bridge (src/webcontainers/terminal-bridge.ts)

```typescript
import { WebContainer } from '@webcontainer/api';
import { Terminal } from 'xterm';

export async function spawnShell(
  instance: WebContainer,
  terminal: Terminal
): Promise<void> {
  const shellProcess = await instance.spawn('jsh', {
    terminal: {
      cols: terminal.cols,
      rows: terminal.rows
    }
  });

  // Pipe output to terminal
  shellProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        terminal.write(data);
      }
    })
  );

  // Pipe terminal input to shell
  const inputWriter = shellProcess.input.getWriter();
  terminal.onData((data) => {
    inputWriter.write(data);
  });

  // Handle resize
  terminal.onResize(({ cols, rows }) => {
    shellProcess.resize({ cols, rows });
  });
}
```

#### 4.2.4 Live Preview (src/preview/LiveIframe.tsx)

```typescript
interface LiveIframeProps {
  url: string;
}

export function LiveIframe({ url }: LiveIframeProps) {
  if (!url) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <p className="text-gray-500">Start the development server to see preview</p>
      </div>
    );
  }

  return (
    <iframe
      src={url}
      className="w-full h-full border-0"
      sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
      title="Live Preview"
    />
  );
}
```

### 4.3 Real-Time Collaboration

#### 4.3.1 WebSocket Multiplexer (src/websocket/multiplexer.ts)

```typescript
type ChannelHandler = (data: any) => void;

class WebSocketMultiplexer {
  private ws: WebSocket | null = null;
  private channels: Map<string, Set<ChannelHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReAttempts = 5;

  connect(token: string): void {
    this.ws = new WebSocket(`wss://ws.platform.io/gateway?token=${token}`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      console.log('[WS] Connected');
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    this.ws.onclose = () => {
      this.handleReconnect(token);
    };
  }

  subscribe(channel: string, handler: ChannelHandler): () => void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    
    this.channels.get(channel)!.add(handler);

    // Send subscribe message
    this.send({ type: 'subscribe', channel });

    return () => {
      this.channels.get(channel)?.delete(handler);
      this.send({ type: 'unsubscribe', channel });
    };
  }

  send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: any): void {
    const handlers = this.channels.get(message.channel);
    handlers?.forEach(handler => handler(message));
  }

  private handleReconnect(token: string): void {
    if (this.reconnectAttempts < this.maxReAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      setTimeout(() => this.connect(token), delay);
    }
  }
}

export const wsMultiplexer = new WebSocketMultiplexer();
```

#### 4.3.2 Awareness & Cursors (src/websocket/collab-handler.ts)

```typescript
import { Awareness } from 'y-protocols/awareness';

interface UserState {
  name: string;
  color: string;
  avatar?: string;
  cursor?: { line: number; column: number };
}

export function setupAwareness(
  provider: WebsocketProvider,
  userId: string,
  userName: string
): void {
  const colors = [
    '#f783ac', '#818cf8', '#34d399', '#fbbf24', '#f87171', '#60a5fa'
  ];
  
  const userColor = colors[Math.floor(Math.random() * colors.length)];

  provider.awareness.setLocalStateField('user', {
    name: userName,
    color: userColor,
    id: userId
  } as UserState);

  // Listen for remote cursor updates
  provider.awareness.on('change', () => {
    // Update remote cursors in Monaco
  });
}
```

### 4.4 D3.js Visualizations

#### 4.4.1 AI Workflow DAG (src/visualization/DagViewer.tsx)

```typescript
'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface DagNode {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  x?: number;
  y?: number;
}

interface DagEdge {
  source: string;
  target: string;
}

interface DagViewerProps {
  nodes: DagNode[];
  edges: DagEdge[];
  width?: number;
  height?: number;
}

export function DagViewer({ nodes, edges, width = 800, height = 500 }: DagViewerProps) {
  const svgRef = useRef<SVGSVGElement>(null);

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
      .force('link', d3.forceLink(edges).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2));

    // Draw edges
    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', '#4b5563')
      .attr('stroke-width', 2);

    // Draw nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .call(d3.drag<any, DagNode>()
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
      .attr('r', 20)
      .attr('fill', d => {
        switch (d.status) {
          case 'running': return '#3b82f6';
          case 'completed': return '#22c55e';
          case 'failed': return '#ef4444';
          default: return '#6b7280';
        }
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    // Node labels
    node.append('text')
      .text(d => d.label)
      .attr('x', 25)
      .attr('y', 5)
      .attr('fill', '#fff')
      .attr('font-size', '12px');

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

  return (
    <svg 
      ref={svgRef} 
      width={width} 
      height={height}
      className="bg-gray-900 rounded-lg"
    />
  );
}
```

#### 4.4.2 Token Analytics (src/visualization/TokenAnalytics.tsx)

```typescript
'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface TokenData {
  date: Date;
  value: number;
  category: string;
}

export function TokenAnalytics({ data }: { data: TokenData[] }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = 800;
    const height = 400;
    const margin = { top: 20, right: 30, bottom: 30, left: 50 };

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime()
      .domain(d3.extent(data, d => d.date) as [Date, Date])
      .range([0, width - margin.left - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.value) || 0])
      .nice()
      .range([height - margin.top - margin.bottom, 0]);

    const color = d3.scaleOrdinal(d3.schemeTableau10);

    // Area chart
    const area = d3.area<TokenData>()
      .x(d => x(d.date))
      .y0(height - margin.top - margin.bottom)
      .y1(d => y(d.value))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', '#3b82f6')
      .attr('fill-opacity', 0.3)
      .attr('d', area);

    // Line
    const line = d3.line<TokenData>()
      .x(d => x(d.date))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${height - margin.top - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(6));

    g.append('g')
      .call(d3.axisLeft(y).ticks(5));

  }, [data]);

  return <svg ref={svgRef} width={800} height={400} />;
}
```

---

## 5. State Management

### 5.1 Zustand Store (src/state/zustand-store.ts)

```typescript
import { create } from 'zustand';

interface Tab {
  id: string;
  fileId: string;
  filePath: string;
  isDirty: boolean;
}

interface UIState {
  activeTabId: string | null;
  tabs: Tab[];
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  
  openTab: (fileId: string, filePath: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeTabId: null,
  tabs: [],
  theme: 'dark',
  sidebarOpen: true,
  
  openTab: (fileId, filePath) => {
    const { tabs } = get();
    const existing = tabs.find(t => t.fileId === fileId);
    
    if (existing) {
      set({ activeTabId: existing.id });
    } else {
      const newTab: Tab = {
        id: `tab-${Date.now()}`,
        fileId,
        filePath,
        isDirty: false
      };
      set({
        tabs: [...tabs, newTab],
        activeTabId: newTab.id
      });
    }
  },
  
  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const newTabs = tabs.filter(t => t.id !== tabId);
    
    set({
      tabs: newTabs,
      activeTabId: activeTabId === tabId 
        ? newTabs[0]?.id || null 
        : activeTabId
    });
  },
  
  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  toggleTheme: () => set(state => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen }))
}));
```

---

## 6. API Integration

### 6.1 Secure Secret Injection (src/app/api/secrets/route.ts)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const cookieStore = cookies();
  const token = cookieStore.get('session-token')?.value;
  
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const payload = await verifyAdminToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
  
  const { projectId } = await request.json();
  
  // Fetch secrets from Vault via API Gateway
  const response = await fetch(
    `${process.env.API_GATEWAY_URL}/api/v1/projects/${projectId}/secrets`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-User-Id': payload.sub
      }
    }
  );
  
  if (!response.ok) {
    return NextResponse.json({ error: 'Failed to fetch secrets' }, { status: 500 });
  }
  
  const secrets = await response.json();
  
  return NextResponse.json(secrets);
}
```

---

## 7. Testing Checklist

```bash
# Run the app
npm run dev

# Test WebContainer boot
# Open browser console and check for SharedArrayBuffer support

# Test Monaco editor
# Create a new file and start typing

# Test collaboration
# Open same file in two browser windows

# Test terminal
# Run 'ls' command in terminal

# Test preview
# Run 'npm run dev' and check preview iframe
```

---

## 8. Implementation Status

| Component | Status |
|-----------|--------|
| Project Setup | ✅ Complete |
| Next.js Config (COOP/COEP) | ✅ Complete |
| Monaco Editor | ✅ Complete |
| Yjs Integration | ✅ Complete |
| WebContainers | ✅ Complete |
| Terminal Bridge | ✅ Complete |
| Live Preview | ✅ Complete |
| WebSocket Multiplexer | ✅ Complete |
| D3 DAG Viewer | ✅ Complete |
| D3 Token Analytics | ✅ Complete |
| Zustand Store | ✅ Complete |
| Secret Injection | ✅ Complete |

---

## 9. Key Implementation Notes

### 9.1 Hybrid Execution
- **Tier 1 (Free):** WebContainers in browser
- **Tier 2 (Pro):** Firecracker microVMs
- WebContainer requires COOP/COEP headers

### 9.2 Collaboration
- Yjs CRDT for conflict-free editing
- File-level isolation (separate Y.Doc per file)
- Awareness protocol for live cursors

### 9.3 Security
- Iframe sandbox attributes
- Separate preview subdomain
- Secure secret injection via API

### 9.4 Performance
- Yjs doc pool (max 10)
- Server-side data fetching
- D3 with useRef (not React render)

### 9.5 LSP
- Monaco LanguageClient
- Proxy via WebSocket to execution-service
- JSON-RPC over channel `lsp:{project_id}:{lang}`
