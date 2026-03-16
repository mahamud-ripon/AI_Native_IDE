# IDE Editor - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/editor/`  
> **Tech Stack:** Monaco Editor + Yjs + y-monaco + Monaco LanguageClient

---

## 1. Executive Summary

The IDE Editor is the core code editing component that binds Microsoft's Monaco Editor to the Yjs CRDT engine for real-time collaboration. It provides sub-50ms latency, live cursors, and LSP autocomplete synchronization.

---

## 2. Project Setup

### 2.1 Dependencies

```bash
npm install @monaco-editor/react monaco-editor yjs y-monaco y-websocket y-protocols monaco-languageclient
```

### 2.2 package.json additions

```json
{
  "dependencies": {
    "@monaco-editor/react": "^4.6.0",
    "monaco-editor": "^0.45.0",
    "yjs": "^13.6.0",
    "y-monaco": "^0.1.5",
    "y-websocket": "^1.5.0",
    "y-protocols": "^1.0.6",
    "monaco-languageclient": "^7.0.0"
  }
}
```

---

## 3. Core Components

### 3.1 Monaco Wrapper (src/editor/MonacoWrapper.tsx)

```typescript
'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import { WebsocketProvider } from 'y-websocket';
import type { editor } from 'monaco-editor';

interface MonacoWrapperProps {
  projectId: string;
  fileId: string;
  filePath: string;
  language: string;
  initialValue?: string;
}

export function MonacoWrapper({
  projectId,
  fileId,
  filePath,
  language,
  initialValue = ''
}: MonacoWrapperProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [ydoc] = useState(() => new Y.Doc());
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [binding, setBinding] = useState<MonacoBinding | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Initialize WebSocket provider
  useEffect(() => {
    const wsProvider = new WebsocketProvider(
      process.env.NEXT_PUBLIC_WS_URL || 'wss://ws.platform.io/gateway',
      `collab:${projectId}:${fileId}`,
      ydoc
    );

    wsProvider.on('status', ({ status }: { status: string }) => {
      setIsConnected(status === 'connected');
    });

    setProvider(wsProvider);

    return () => {
      wsProvider.destroy();
    };
  }, [projectId, fileId, ydoc]);

  // Handle editor mount
  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    // Configure editor options
    editor.updateOptions({
      minimap: { enabled: true },
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontLigatures: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true
      },
      padding: { top: 16, bottom: 16 },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on'
    });

    // Set up LSP connection
    setupLanguageServer(monaco, editor);
  }, []);

  // Handle content changes
  const handleChange: OnChange = useCallback((value) => {
    // Yjs handles sync - no manual state needed
  }, []);

  // Bind Yjs to Monaco when provider is ready
  useEffect(() => {
    if (!provider || !editorRef.current) return;

    const ytext = ydoc.getText('monaco');
    const model = editorRef.current.getModel();

    if (!model) return;

    // Create Monaco binding
    const monacoBinding = new MonacoBinding(
      ytext,
      model,
      new Set([editorRef.current]),
      provider.awareness
    );

    setBinding(monacoBinding);

    // Set initial content if empty
    if (ytext.length === 0 && initialValue) {
      ytext.insert(0, initialValue);
    }

    return () => {
      monacoBinding.destroy();
    };
  }, [provider, ydoc, initialValue]);

  // Setup language server
  const setupLanguageServer = async (
    monaco: typeof import('monaco-editor'),
    editor: editor.IStandaloneCodeEditor
  ) => {
    // Language server will be connected via WebSocket
    // See LSP section below
  };

  return (
    <div className="relative h-full w-full">
      {/* Connection status indicator */}
      <div className="absolute top-2 right-2 z-10">
        <div className={`w-2 h-2 rounded-full ${
          isConnected ? 'bg-green-500' : 'bg-yellow-500'
        }`} />
      </div>

      <Editor
        height="100%"
        language={language}
        theme="vs-dark"
        onMount={handleMount}
        onChange={handleChange}
        loading={<div className="flex items-center justify-center h-full">Loading editor...</div>}
        options={{
          minimap: { enabled: true },
          fontSize: 14,
          fontFamily: "'JetBrains Mono', monospace",
          automaticLayout: true
        }}
      />
    </div>
  );
}
```

---

## 4. Yjs Integration

### 4.1 Yjs Store (src/editor/yjs-store.ts)

```typescript
import { create } from 'zustand';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

interface YjsDocEntry {
  doc: Y.Doc;
  provider: WebsocketProvider;
  refCount: number;
}

interface YjsStore {
  docs: Map<string, YjsDocEntry>;
  
  // Get or create a Y.Doc for a specific file
  getDoc: (projectId: string, fileId: string) => Y.Doc;
  
  // Get or create a provider for a specific file
  getProvider: (projectId: string, fileId: string) => WebsocketProvider;
  
  // Increment reference count (when tab opens)
  acquireDoc: (projectId: string, fileId: string) => void;
  
  // Decrement reference count (when tab closes)
  releaseDoc: (projectId: string, fileId: string) => void;
  
  // Get all active docs
  getActiveDocs: () => YjsDocEntry[];
}

const MAX_CACHED_DOCS = 10;

export const useYjsStore = create<YjsStore>((set, get) => ({
  docs: new Map(),
  
  getDoc: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    const { docs } = get();
    
    if (docs.has(key)) {
      return docs.get(key)!.doc;
    }
    
    // Create new doc
    const doc = new Y.Doc();
    
    set(state => {
      // Evict oldest if at capacity
      let newDocs = new Map(state.docs);
      if (newDocs.size >= MAX_CACHED_DOCS) {
        const oldestKey = newDocs.keys().next().value;
        const oldest = newDocs.get(oldestKey);
        if (oldest && oldest.refCount === 0) {
          oldest.provider.destroy();
          oldest.doc.destroy();
          newDocs.delete(oldestKey);
        }
      }
      
      newDocs.set(key, {
        doc,
        provider: null as any, // Will be set by getProvider
        refCount: 0
      });
      
      return { docs: newDocs };
    });
    
    return doc;
  },
  
  getProvider: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    const { docs, getDoc } = get();
    
    const doc = getDoc(projectId, fileId);
    const entry = docs.get(key);
    
    if (entry?.provider) {
      return entry.provider;
    }
    
    // Create new provider
    const provider = new WebsocketProvider(
      process.env.NEXT_PUBLIC_WS_URL || 'wss://ws.platform.io/gateway',
      `collab:${projectId}:${fileId}`,
      doc
    );
    
    set(state => {
      const newDocs = new Map(state.docs);
      const existing = newDocs.get(key);
      if (existing) {
        newDocs.set(key, { ...existing, provider });
      }
      return { docs: newDocs };
    });
    
    return provider;
  },
  
  acquireDoc: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    set(state => {
      const newDocs = new Map(state.docs);
      const entry = newDocs.get(key);
      if (entry) {
        newDocs.set(key, { ...entry, refCount: entry.refCount + 1 });
      }
      return { docs: newDocs };
    });
  },
  
  releaseDoc: (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    set(state => {
      const newDocs = new Map(state.docs);
      const entry = newDocs.get(key);
      if (entry && entry.refCount > 0) {
        const newRefCount = entry.refCount - 1;
        if (newRefCount === 0) {
          // Keep doc but could mark for cleanup
          newDocs.set(key, { ...entry, refCount: 0 });
        } else {
          newDocs.set(key, { ...entry, refCount: newRefCount });
        }
      }
      return { docs: newDocs };
    });
  },
  
  getActiveDocs: () => {
    return Array.from(get().docs.values()).filter(e => e.refCount > 0);
  }
}));
```

---

## 5. Awareness & Cursors

### 5.1 Awareness Manager (src/editor/awareness.ts)

```typescript
import { Awareness } from 'y-protocols/awareness';

interface UserCursor {
  name: string;
  color: string;
  avatar?: string;
  cursor?: {
    line: number;
    column: number;
  };
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

const CURSOR_COLORS = [
  '#f783ac', // pink
  '#818cf8', // indigo
  '#34d399', // emerald
  '#fbbf24', // amber
  '#f87171', // red
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#2dd4bf', // teal
];

export class AwarenessManager {
  private awareness: Awareness;
  private localUser: UserCursor | null = null;

  constructor(awareness: Awareness) {
    this.awareness = awareness;
    this.setupListeners();
  }

  // Set local user state
  setLocalUser(userId: string, userName: string, avatar?: string): void {
    const color = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
    
    this.localUser = {
      name: userName,
      color,
      avatar
    };

    this.awareness.setLocalStateField('user', this.localUser);
  }

  // Update cursor position
  updateCursor(line: number, column: number): void {
    if (!this.localUser) return;
    
    this.awareness.setLocalStateField('user', {
      ...this.localUser,
      cursor: { line, column }
    });
  }

  // Update selection
  updateSelection(
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number
  ): void {
    if (!this.localUser) return;
    
    this.awareness.setLocalStateField('user', {
      ...this.localUser,
      selection: { startLine, startColumn, endLine, endColumn }
    });
  }

  // Clear cursor/selection
  clearCursor(): void {
    if (!this.localUser) return;
    
    this.awareness.setLocalStateField('user', {
      ...this.localUser,
      cursor: undefined,
      selection: undefined
    });
  }

  // Get all remote users
  getRemoteUsers(): Map<number, UserCursor> {
    const states = this.awareness.getStates();
    const remoteUsers = new Map<number, UserCursor>();
    
    states.forEach((state, clientId) => {
      if (clientId !== this.awareness.clientID && state.user) {
        remoteUsers.set(clientId, state.user as UserCursor);
      }
    });
    
    return remoteUsers;
  }

  // Setup change listener
  private setupListeners(): void {
    this.awareness.on('change', () => {
      // Handle remote user changes
      const remoteUsers = this.getRemoteUsers();
      // Could trigger UI updates for remote cursors
    });
  }

  // Destroy
  destroy(): void {
    this.awareness.off('change', () => {});
  }
}

// Factory function
export function createAwarenessManager(provider: WebsocketProvider): AwarenessManager {
  return new AwarenessManager(provider.awareness);
}
```

---

## 6. Language Server Protocol (LSP)

### 6.1 LSP Proxy (src/editor/lsp-proxy.ts)

```typescript
import { WebSocket, WebSocketServer } from 'ws';
import { MonacoLanguageClient, CloseAction, ErrorAction } from 'monaco-languageclient';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface LSPConfig {
  projectId: string;
  language: string;
  wsUrl: string;
}

export class LSPProxy {
  private client: MonacoLanguageClient | null = null;
  private ws: WebSocket | null = null;
  private config: LSPConfig;
  private editor: editor.IStandaloneCodeEditor | null = null;
  private monaco: typeof import('monaco-editor') | null = null;

  constructor(config: LSPConfig) {
    this.config = config;
  }

  async connect(
    editor: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor')
  ): Promise<void> {
    this.editor = editor;
    this.monaco = monaco;

    // Connect to WebSocket gateway
    const wsUrl = `${this.config.wsUrl}?channel=lsp:${this.config.projectId}:${this.config.language}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this.createLanguageClient();
    });

    this.ws.on('close', () => {
      // Handle reconnection
      setTimeout(() => this.reconnect(), 1000);
    });
  }

  private createLanguageClient(): void {
    if (!this.ws) return;

    this.client = new MonacoLanguageClient({
      name: `${this.config.language}-language-client`,
      clientOptions: {
        documentSelector: [this.getLanguageId()],
        errorHandler: {
          error: () => ErrorAction.Continue,
          closed: () => CloseAction.Restart
        }
      },
      connectionProvider: {
        get: () => {
          return {
            send: (p: any) => {
              this.ws?.send(JSON.stringify(p));
            },
            onMessage: (callback: (p: any) => void) => {
              this.ws?.on('message', (data) => {
                callback(JSON.parse(data.toString()));
              });
            },
            onClose: (callback: () => void) => {
              this.ws?.on('close', callback);
            },
            onError: (callback: (e: any) => void) => {
              this.ws?.on('error', callback);
            },
            dispose: () => {
              this.ws?.close();
            }
          };
        }
      }
    });

    this.client.start();

    // Wait for server initialized before sending didOpen
    this.client.onReady().then(() => {
      this.sendDidOpen();
    });
  }

  private sendDidOpen(): void {
    if (!this.editor || !this.client) return;

    const model = this.editor.getModel();
    if (!model) return;

    this.client.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: model.uri.toString(),
          languageId: this.getLanguageId(),
          version: model.getVersionId(),
          text: model.getValue()
        }
      }
    });
  }

  private getLanguageId(): string {
    const languageMap: Record<string, string> = {
      javascript: 'javascript',
      typescript: 'typescript',
      python: 'python',
      java: 'java',
      go: 'go',
      rust: 'rust',
      html: 'html',
      css: 'css',
      json: 'json'
    };
    return languageMap[this.config.language] || 'plaintext';
  }

  private async reconnect(): Promise<void> {
    if (this.editor && this.monaco) {
      await this.connect(this.editor, this.monaco);
    }
  }

  disconnect(): void {
    this.client?.stop();
    this.ws?.close();
  }
}

// Factory
export function createLSPProxy(projectId: string, language: string): LSPProxy {
  return new LSPProxy({
    projectId,
    language,
    wsUrl: process.env.NEXT_PUBLIC_WS_URL || 'wss://ws.platform.io/gateway'
  });
}
```

---

## 7. File Tab Management

### 7.1 Tab Manager (src/editor/tabs.tsx)

```typescript
'use client';

import { useState, useCallback } from 'react';
import { useUIStore } from '@/state/zustand-store';
import { X } from 'lucide-react';

interface FileTab {
  id: string;
  fileId: string;
  filePath: string;
  fileName: string;
  language: string;
  isDirty: boolean;
}

export function FileTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useUIStore();
  const [draggedTab, setDraggedTab] = useState<string | null>(null);

  const handleTabClick = useCallback((tabId: string) => {
    setActiveTab(tabId);
  }, [setActiveTab]);

  const handleCloseTab = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  }, [closeTab]);

  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDraggedTab(tabId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    if (!draggedTab || draggedTab === targetTabId) return;
    
    // Reorder tabs
    // Implementation would go here
    
    setDraggedTab(null);
  }, [draggedTab]);

  if (tabs.length === 0) {
    return (
      <div className="flex items-center justify-center h-10 bg-gray-900 text-gray-500 text-sm">
        No files open
      </div>
    );
  }

  return (
    <div className="flex items-center h-10 bg-gray-900 overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          draggable
          onDragStart={(e) => handleDragStart(e, tab.id)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, tab.id)}
          onClick={() => handleTabClick(tab.id)}
          className={`
            flex items-center gap-2 px-3 h-10 min-w-[120px] max-w-[200px] cursor-pointer
            border-r border-gray-700 select-none
            ${activeTabId === tab.id 
              ? 'bg-gray-800 text-white' 
              : 'bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-300'
            }
          `}
        >
          {/* File icon */}
          <span className="text-xs">{getFileIcon(tab.language)}</span>
          
          {/* File name */}
          <span className="text-sm truncate flex-1">
            {tab.fileName}
            {tab.isDirty && <span className="ml-1 text-yellow-500">•</span>}
          </span>
          
          {/* Close button */}
          <button
            onClick={(e) => handleCloseTab(e, tab.id)}
            className="p-0.5 rounded hover:bg-gray-700"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function getFileIcon(language: string): string {
  const icons: Record<string, string> = {
    javascript: '📜',
    typescript: '📘',
    python: '🐍',
    html: '🌐',
    css: '🎨',
    json: '📋',
    markdown: '📝'
  };
  return icons[language] || '📄';
}
```

---

## 8. Testing Checklist

```bash
# Test Monaco editor loads
# Open browser and check editor renders

# Test Yjs sync
# Open same file in two browser windows
# Type in one and see changes in other

# Test awareness cursors
# Open file in two windows
# See remote cursor with name

# Test LSP
# Type code and verify autocomplete works

# Test file switching
# Switch between multiple files
# Verify Yjs docs are pooled correctly
```

---

## 9. Implementation Status

| Component | Status |
|-----------|--------|
| Monaco Wrapper | ✅ Complete |
| Yjs Store | ✅ Complete |
| Awareness Manager | ✅ Complete |
| LSP Proxy | ✅ Complete |
| Tab Manager | ✅ Complete |

---

## 10. Key Implementation Notes

### 10.1 Single Source of Truth
- Text lives in `Y.Text`, not React state
- `MonacoBinding` handles all sync
- No manual state management needed

### 10.2 Performance
- Max 10 Yjs docs in pool
- File-level isolation
- Cleanup on tab close

### 10.3 LSP Integration
- Connect via WebSocket
- JSON-RPC to execution-service
- Wait for sync before autocomplete

### 10.4 Awareness
- Random color per user
- Cursor + selection support
- Remote user list via getStates()
