# Critical Gaps — Implementation Specification

**Project:** AI-Native Cloud IDE Platform  
**Document scope:** 7 critical gaps blocking launch parity with bolt.new / Replit  
**Audience:** AI coding assistant or developer implementing fixes  
**Authority:** All implementations must conform to `ARCHITECTURE_STANDARDS.md`  
**Base path:** `D:\AI-Native-IDE\platform\`

---

## How to use this document

Each gap section contains:
- **Root cause** — exactly what is wrong and where
- **Files to change** — complete list, nothing else should be touched
- **Implementation** — step-by-step with exact code
- **Acceptance criteria** — how to verify the fix works
- **Do not touch** — guard rails to prevent over-engineering

Work through gaps in order. Gap 1 must be complete before Gap 4 will function. Gap 7 must be complete before Gaps 1 and 4 can use real-time streaming in production.

---

## Gap 1 — AI↔WebContainer File Sync

### Priority: BLOCKER — fixes the core user loop

### Root cause

AI agents (LangGraph Python pipeline) write generated files to **PostgreSQL + S3** via `project-service`. The **WebContainer** filesystem is a completely separate in-memory filesystem inside the browser's WASM sandbox. There is zero bridge between them.

When the AI generates `src/App.tsx`, it calls `POST /api/v1/projects/:id/files/sync`. This persists to the database. But the WebContainer running the dev server has its own `src/App.tsx` from the initial mount. The two filesystems diverge immediately and the preview never reflects AI-generated code.

The fix is a **push bridge** in the frontend: when AI events arrive via WebSocket with `file.created` or `file.modified`, write those files directly into the WebContainer filesystem using the WebContainer API.

### Files to change

```
apps/ide/src/core/runtime/webcontainerManager.ts   — add writeFile() and writeBatch()
apps/ide/src/hooks/useExecutionStreamIntegration.tsx — wire patch events to WC sync
apps/ide/src/services/executionStream.ts            — no change needed
```

### Do not touch

- `apps/ide/src/workspace/workspaceService.ts` — read path is already correct
- Any backend file — this is a pure frontend change
- `webcontainerManager.ts` boot/shell/dev-server logic — do not refactor those functions

---

### Implementation

#### Step 1 — Add `writeFile` and `writeBatch` to `webcontainerManager.ts`

Add these two exported functions at the bottom of the file, after `killShell`:

```typescript
/**
 * Write a single file into the running WebContainer filesystem.
 * Creates parent directories automatically.
 * Safe to call before boot — will wait for container to be ready.
 */
export async function writeFile(path: string, content: string): Promise<void> {
  const wc = await ensureContainer();
  
  // Normalize path — WebContainer uses paths without leading slash
  const wcPath = path.startsWith('/') ? path.slice(1) : path;
  
  // Ensure parent directory exists
  const dir = wcPath.includes('/') ? wcPath.substring(0, wcPath.lastIndexOf('/')) : '';
  if (dir) {
    await wc.fs.mkdir(dir, { recursive: true }).catch(() => {
      // Directory may already exist — that is fine
    });
  }
  
  await wc.fs.writeFile(wcPath, content, 'utf-8');
}

/**
 * Write multiple files into the running WebContainer filesystem in parallel.
 * Used for bulk AI-generated file application.
 * 
 * @param files - Record<path, content>
 * @returns Array of results with success/failure per file
 */
export async function writeBatch(
  files: Record<string, string>
): Promise<Array<{ path: string; success: boolean; error?: string }>> {
  const results = await Promise.allSettled(
    Object.entries(files).map(async ([path, content]) => {
      await writeFile(path, content);
      return path;
    })
  );
  
  return results.map((result, index) => {
    const path = Object.keys(files)[index];
    if (result.status === 'fulfilled') {
      return { path, success: true };
    } else {
      return {
        path,
        success: false,
        error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
      };
    }
  });
}
```

#### Step 2 — Wire AI file events to WebContainer in `useExecutionStreamIntegration.tsx`

The existing `applyPatchToEditor` function already handles Monaco. Extend it to also write to WebContainer. Replace the current `applyPatchToEditor` function (lines starting with `const applyPatchToEditor = useCallback...`) with:

```typescript
// Apply patch to Monaco Editor AND WebContainer filesystem
const applyPatchToEditor = useCallback(async (filePath: string, content: string) => {
  // 1. Apply to Monaco Editor (in-memory model)
  try {
    const model = editorModelManager.getOrCreate('', filePath, content);
    if (model) {
      model.setValue(content);
    }
  } catch (e) {
    console.warn('[Patch] Monaco update failed:', e);
  }

  // 2. Write to WebContainer filesystem (so dev server picks up change)
  try {
    const { writeFile } = await import('../core/runtime/webcontainerManager');
    await writeFile(filePath, content);
    console.log(`[Patch] Written to WebContainer: ${filePath}`);
  } catch (e) {
    // WebContainer may not be booted yet — queue for later
    console.warn('[Patch] WebContainer write deferred (not booted):', filePath);
    pendingWCWrites.current.set(filePath, content);
  }
}, []);
```

Add this ref at the top of the hook body (alongside existing refs):

```typescript
const pendingWCWrites = useRef<Map<string, string>>(new Map());
```

Add this effect after the existing effects to drain the pending queue once the container boots:

```typescript
// Drain pending WebContainer writes once container is available
useEffect(() => {
  if (connectionStatus !== 'connected') return;
  
  const drainPending = async () => {
    if (pendingWCWrites.current.size === 0) return;
    
    const { writeBatch } = await import('../core/runtime/webcontainerManager');
    const pending = Object.fromEntries(pendingWCWrites.current);
    pendingWCWrites.current.clear();
    
    const results = await writeBatch(pending);
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      console.warn('[Patch] Some queued WC writes failed:', failed);
    }
  };
  
  drainPending();
}, [connectionStatus]);
```

#### Step 3 — Handle bulk file writes from `syncFiles` responses

In the `case 'patch.generated':` block of `handleEvent`, after the existing `applyPatchToEditor` call, add handling for multi-file payloads from `syncFiles`:

```typescript
case 'patch.generated': {
  // ... existing single-file handling ...
  
  // Handle bulk file sync from syncFiles endpoint
  if (event.payload.files && typeof event.payload.files === 'object') {
    const files = event.payload.files as Record<string, string>;
    const { writeBatch } = await import('../core/runtime/webcontainerManager');
    writeBatch(files).then(results => {
      const succeeded = results.filter(r => r.success).length;
      console.log(`[Patch] Bulk WC sync: ${succeeded}/${results.length} files written`);
    });
  }
  break;
}
```

### Acceptance criteria

1. Start the IDE with a new project
2. Boot the WebContainer (click "Start Runtime" in Preview panel)
3. In the AI chat, type: `"Add a counter component to App.tsx with a button that increments"`
4. After the AI completes, open the Preview pane
5. **Expected:** The preview shows the counter button without requiring a manual refresh
6. **Expected:** The Monaco editor also shows the updated `App.tsx` content
7. Open DevTools → Application → nothing in `localStorage` should contain file content (it all goes to WebContainer)

---

## Gap 2 — Live Preview Pane

### Priority: BLOCKER — users cannot see their running app

### Root cause

`PreviewPanel.tsx` has the correct structure: `ensureContainer → mountDemoProject → ensureDependenciesInstalled → startDevServer → iframe`. The `server-ready` event listener IS wired. The bug is that:

1. The `server-ready` listener is set up **after** `start()` may be called, creating a race condition
2. `mountDemoProject` loads only the static demo files — it does not load the actual project files from the backend
3. The "Start Runtime" button is manual — there is no auto-boot when the project loads
4. The iframe `sandbox` attribute is missing `allow-modals` which blocks HMR error overlays

### Files to change

```
apps/ide/src/shell/panels/PreviewPanel.tsx          — primary fix
apps/ide/src/core/runtime/webcontainerManager.ts    — add mountProject()
apps/ide/src/workspace/workspaceService.ts          — already correct, read-only
```

### Do not touch

- `workspaceService.ts` — the `getSnapshot()` method is already implemented correctly
- The xterm / terminal panel — separate concern

---

### Implementation

#### Step 1 — Add `mountProject` to `webcontainerManager.ts`

This replaces `mountDemoProject` for real projects. Add after `mountDemoProject`:

```typescript
/**
 * Mount a real project's files into the WebContainer.
 * Fetches file content from workspaceService and mounts the entire tree.
 * Falls back to demo project if fetch fails.
 */
export async function mountProject(projectId: string): Promise<void> {
  const wc = await ensureContainer();
  
  // Lazy import to avoid circular dependency
  const { workspaceService } = await import('../../workspace/workspaceService');
  
  let snapshot: Record<string, string>;
  
  try {
    snapshot = await workspaceService.getSnapshot(projectId);
  } catch (err) {
    console.warn('[WebContainer] Failed to load project snapshot, using demo:', err);
    snapshot = (await import('../../workspace/workspaceService')).demoViteReactProjectFiles();
  }
  
  const tree = buildFileTreeFromMap(snapshot);
  await wc.mount(tree);
}
```

#### Step 2 — Rewrite `PreviewPanel.tsx`

Replace the entire component with the following:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  ensureContainer,
  mountProject,
  ensureDependenciesInstalled,
  startDevServer,
} from '../../core/runtime/webcontainerManager';
import { useRuntimeLogStore } from '../../state/runtimeLogStore';
import styles from './Panel.module.css';

type RuntimeStatus = 'idle' | 'booting' | 'mounting' | 'installing' | 'starting' | 'running' | 'error';

const STATUS_LABELS: Record<RuntimeStatus, string> = {
  idle: 'Idle',
  booting: 'Booting WebContainer…',
  mounting: 'Mounting project files…',
  installing: 'Installing dependencies…',
  starting: 'Starting dev server…',
  running: 'Running',
  error: 'Error',
};

export function PreviewPanel() {
  const { projectId } = useParams<{ projectId: string }>();
  const [status, setStatus] = useState<RuntimeStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [iframeKey, setIframeKey] = useState(0); // Force iframe refresh

  const append = useRuntimeLogStore((s) => s.append);
  const clear = useRuntimeLogStore((s) => s.clear);
  const log = useRuntimeLogStore((s) => s.log);
  const bootedRef = useRef(false);

  // Register server-ready listener ONCE on mount before any boot attempt
  useEffect(() => {
    let cancelled = false;

    const registerListener = async () => {
      try {
        const wc = await ensureContainer();
        
        wc.on('server-ready', (_port: number, url: string) => {
          if (cancelled) return;
          console.log('[Preview] Server ready at:', url);
          setPreviewUrl(url);
          setStatus('running');
          setIframeKey(k => k + 1); // Force iframe to reload with new URL
        });
      } catch (err) {
        console.error('[Preview] Failed to register server-ready listener:', err);
      }
    };

    registerListener();
    return () => { cancelled = true; };
  }, []);

  // Auto-boot when projectId becomes available
  useEffect(() => {
    if (!projectId || bootedRef.current) return;
    boot();
  }, [projectId]);

  const boot = useCallback(async () => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    clear();
    const pid = projectId ?? 'demo';

    try {
      setStatus('booting');
      append('Booting WebContainer...\n');
      await ensureContainer();
      append('WebContainer ready.\n');

      setStatus('mounting');
      append(`Mounting project ${pid}...\n`);
      await mountProject(pid);
      append('Project files mounted.\n');

      setStatus('installing');
      append('Running npm install...\n');
      await ensureDependenciesInstalled(append);
      append('Dependencies installed.\n');

      setStatus('starting');
      append('Starting dev server...\n');
      await startDevServer(append);
      // Status transitions to 'running' via server-ready event handler above

    } catch (err) {
      bootedRef.current = false; // Allow retry
      const msg = err instanceof Error ? err.message : 'Unknown error';
      append(`\nError: ${msg}\n`);
      setStatus('error');
    }
  }, [projectId, append, clear]);

  const handleRestart = useCallback(() => {
    bootedRef.current = false;
    setPreviewUrl('');
    setStatus('idle');
    boot();
  }, [boot]);

  const handleOpenExternal = useCallback(() => {
    if (previewUrl) window.open(previewUrl, '_blank');
  }, [previewUrl]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Preview — {STATUS_LABELS[status]}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {previewUrl && (
            <button
              onClick={handleOpenExternal}
              title="Open in new tab"
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, color: 'inherit', padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
            >
              Open ↗
            </button>
          )}
          <button
            onClick={handleRestart}
            disabled={status === 'booting' || status === 'mounting' || status === 'installing' || status === 'starting'}
            title="Restart runtime"
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, color: 'inherit', padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            Restart
          </button>
        </div>
      </div>

      <div className={styles.panelBody} style={{ padding: 0, position: 'relative' }}>
        {previewUrl ? (
          <iframe
            key={iframeKey}
            title="Live Preview"
            src={previewUrl}
            style={{ width: '100%', height: '100%', border: 0 }}
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
          />
        ) : (
          <pre style={{
            margin: 0,
            padding: 12,
            height: '100%',
            overflow: 'auto',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: 'rgba(255,255,255,0.6)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {log || (status === 'idle' ? 'Runtime will start automatically when a project is loaded.' : 'Starting…')}
          </pre>
        )}

        {/* Loading overlay during boot */}
        {status !== 'idle' && status !== 'running' && status !== 'error' && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 12, pointerEvents: 'none',
          }}>
            <div style={{ width: 24, height: 24, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#58a6ff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{STATUS_LABELS[status]}</span>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
```

### Acceptance criteria

1. Open IDE with any projectId in the URL (`/p/some-uuid/f/src/App.tsx`)
2. Preview panel should auto-boot without clicking anything
3. Within 30–60 seconds the iframe should show the running Vite app
4. Editing `src/App.tsx` in Monaco should cause HMR to update the preview within 1–2 seconds (via Gap 1's WebContainer write)
5. Clicking "Open ↗" opens the preview in a new tab
6. Clicking "Restart" re-mounts and restarts the dev server

---

## Gap 3 — Terminal (WebContainer, not host shell)

### Priority: BLOCKER — current implementation is a security hole

### Root cause

`execution_controller.ts` in the execution-service uses Node.js `spawn('sh', ['-c', command])` which runs directly **on the host server**. This allows any user with execute permission to run arbitrary shell commands on the production machine.

The frontend `TerminalPanel.tsx` is **already correctly implemented** — it calls `spawnShell()` from `webcontainerManager.ts` which uses the WebContainer's `jsh` shell. The backend execution service's terminal is a separate, dangerous code path that must not be reachable from the IDE frontend.

### Files to change

```
apps/ide/src/shell/panels/TerminalPanel.tsx               — already correct, minor fix only
services/execution-service/src/controllers/execution_controller.ts  — remove spawn() 
services/execution-service/src/streams/terminal_pty.ts    — restrict to VM-only context
```

### Do not touch

- `webcontainerManager.ts` — `spawnShell()` is already correct
- `TerminalPanel.tsx` shell lifecycle — mostly correct, just needs a small fix

---

### Implementation

#### Step 1 — Fix the race condition in `TerminalPanel.tsx`

The terminal currently starts the shell in a `useEffect` that depends on `termInstanceRef.current` being set by the first effect. This creates a race condition. Replace the second `useEffect` (the one that calls `startShell`) with:

```typescript
useEffect(() => {
  // Wait until xterm instance is mounted
  const term = termInstanceRef.current;
  if (!term) return;

  let cancelled = false;

  async function startShell() {
    try {
      term.writeln('\x1b[2m[Terminal] Connecting to WebContainer shell...\x1b[0m');
      await ensureContainer();
      
      if (cancelled) return;
      term.writeln('\x1b[32m[Terminal] WebContainer ready\x1b[0m\r\n');

      const shell = await spawnShell();
      if (cancelled) { killShell(); return; }

      const writer = shell.input.getWriter();
      shellWriterRef.current = writer;

      // Forward keyboard input to shell
      const onData = term.onData((data: string) => {
        writer.write(data).catch(console.error);
      });

      // Stream shell output to terminal
      const reader = shell.output.getReader();
      shellReaderRef.current = reader;

      ;(async () => {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) term.write(value);
        }
      })();

      return () => { onData.dispose(); };
    } catch (e) {
      if (!cancelled) {
        term.writeln(`\x1b[31m[Terminal] Failed: ${e instanceof Error ? e.message : 'Unknown'}\x1b[0m`);
      }
    }
  }

  startShell();

  return () => {
    cancelled = true;
    shellWriterRef.current?.close().catch(() => {});
    shellReaderRef.current?.cancel().catch(() => {});
    shellWriterRef.current = null;
    shellReaderRef.current = null;
    killShell();
  };
// Re-run when the xterm instance becomes available (after first effect)
}, [termInstanceRef.current]); // eslint-disable-line react-hooks/exhaustive-deps
```

#### Step 2 — Gut the dangerous `spawn()` in `execution_controller.ts`

The `runCode` endpoint should only manage VM lifecycle records, not execute shell commands directly. Replace the call site in `ExecutionController.runCode` that creates execution sessions. Find the `TerminalPTY.createSession` call and remove it:

```typescript
// REMOVE this block entirely — it spawns processes on the host:
// const sessionId = await TerminalPTY.createSession(vmId, data.command, ws);

// REPLACE with: the session ID comes from the DB record only.
// Terminal I/O goes through WebContainer (frontend) or Firecracker RPC (cloud tier).
// The execution record is for audit/history only.
```

In `terminal_pty.ts`, add a guard at the top of `createSession` that prevents misuse:

```typescript
export const TerminalPTY = {
  async createSession(vmId: string, command: string, ws: WebSocket): Promise<string> {
    // SECURITY: This function must only be called for Firecracker VM PTY sessions.
    // Do NOT call this for browser-tier projects — use WebContainer jsh instead.
    // Validate that vmId starts with 'fc-' (Firecracker prefix)
    if (!vmId.startsWith('fc-')) {
      throw new Error(
        `TerminalPTY.createSession must only be used with Firecracker VMs (vmId must start with "fc-"). ` +
        `For browser-tier projects, use WebContainer jsh via the frontend.`
      );
    }
    // ... rest of function unchanged but now guarded
```

### Acceptance criteria

1. Open the IDE and click on the Terminal panel
2. Within a few seconds, a working shell prompt should appear (`$`)
3. Type `ls` — should list the project files from the WebContainer
4. Type `node -e "console.log('hello')"` — should execute inside WebContainer
5. Open DevTools Network — there should be NO requests to `/api/v1/exec/run`
6. Verify the execution-service logs show no spawn calls during terminal usage

---

## Gap 4 — Unified AI Code Path

### Priority: BLOCKER — two broken paths, neither end-to-end

### Root cause

`AIChatPanel.tsx` has two AI execution paths that create a broken experience:

**Path A (backend):** `aiServiceClient.startWorkflow()` → `ai-service:8003/workflows/start` → LangGraph agents → BUT there is no `/ai/execute` endpoint that returns generated files back to the frontend as events. The workflow runs in Python, files are written to PostgreSQL, but no SSE or WebSocket events are emitted to the browser.

**Path B (frontend fallback):** `groqClient.complete()` → Groq API → regex parsing of markdown code blocks → `model.setValue()` in Monaco → **never writes to WebContainer**.

The fix: deprecate Path B for code generation. Fix Path A by making `ai-service` emit `file.modified` events over the existing WebSocket infrastructure after workflow completion.

### Files to change

```
services/ai-service/src/routes/workflows.ts          — add file-emit after workflow complete
services/ai-service/src/app.ts                       — register websocket plugin  
apps/ide/src/services/aiOrchestrator.ts              — deprecate, redirect to aiServiceClient
apps/ide/src/shell/panels/AIChatPanel.tsx            — remove groq fallback for code gen
apps/ide/src/services/groqClient.ts                  — keep for chat-only mode
```

### Do not touch

- `ai-agents/` Python code — agents are correct, only event emission is missing
- `executionStream.ts` and `executionStore.ts` — already wired correctly
- The Groq client — keep it for general Q&A chat, just not for code generation

---

### Implementation

#### Step 1 — Add `@fastify/websocket` to `ai-service`

Install the package and register it in `app.ts`:

```typescript
// In services/ai-service/package.json, add to dependencies:
// "@fastify/websocket": "^8.3.0"

// In services/ai-service/src/app.ts, add after existing imports:
import websocket from '@fastify/websocket';

// Inside build(), after helmet/cors, before route registration:
await fastify.register(websocket);
```

#### Step 2 — Create `services/ai-service/src/lib/executionEmitter.ts` (new file)

```typescript
/**
 * ExecutionEmitter — broadcasts AI execution events to connected IDE clients.
 * 
 * Maintains a registry of WebSocket connections subscribed to workspace events.
 * Called by workflow routes after agent steps complete.
 */

import type { WebSocket } from 'ws';

type EventPayload = Record<string, unknown>;

interface ExecutionEvent {
  taskId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  type: string;
  timestamp: number;
  sequence: number;
  stage?: string;
  progress?: number;
  payload: EventPayload;
  metadata: Record<string, unknown>;
}

// workspaceId → Set of connected WebSocket clients
const wsClients = new Map<string, Set<WebSocket>>();

// Per-task sequence counter
const sequences = new Map<string, number>();

export const executionEmitter = {
  /**
   * Register a WebSocket client for a workspace.
   * Called when client sends { type: 'execution.subscribe', workspaceId }
   */
  subscribe(workspaceId: string, ws: WebSocket): void {
    if (!wsClients.has(workspaceId)) {
      wsClients.set(workspaceId, new Set());
    }
    wsClients.get(workspaceId)!.add(ws);
    
    ws.on('close', () => {
      wsClients.get(workspaceId)?.delete(ws);
    });
  },

  /**
   * Emit an event to all clients subscribed to a workspace.
   */
  emit(workspaceId: string, taskId: string, event: Omit<ExecutionEvent, 'sequence' | 'workspaceId' | 'taskId'>): void {
    const clients = wsClients.get(workspaceId);
    if (!clients || clients.size === 0) return;

    const seq = (sequences.get(taskId) ?? 0) + 1;
    sequences.set(taskId, seq);

    const fullEvent: ExecutionEvent = {
      taskId,
      workspaceId,
      sequence: seq,
      ...event,
    };

    const message = JSON.stringify(fullEvent);
    
    clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    });
  },

  /**
   * Emit a file.modified event — the primary event IDE listens for to sync files.
   */
  emitFileModified(
    workspaceId: string,
    taskId: string,
    projectId: string,
    userId: string,
    filePath: string,
    content: string
  ): void {
    this.emit(workspaceId, taskId, {
      projectId,
      userId,
      type: 'file.modified',
      timestamp: Date.now(),
      stage: 'application',
      progress: 100,
      payload: {
        filePath,
        content,
        action: 'modified',
      },
      metadata: { agent: 'code_execution_agent' },
    });
  },

  /**
   * Emit a batch of files as patch.generated event.
   * More efficient than individual file.modified events.
   */
  emitFileBatch(
    workspaceId: string,
    taskId: string,
    projectId: string,
    userId: string,
    files: Record<string, string>
  ): void {
    this.emit(workspaceId, taskId, {
      projectId,
      userId,
      type: 'patch.generated',
      timestamp: Date.now(),
      stage: 'application',
      progress: 90,
      payload: {
        files,
        count: Object.keys(files).length,
      },
      metadata: { agent: 'code_execution_agent' },
    });
  },
};
```

#### Step 3 — Add WebSocket endpoint to `ai-service` workflow routes

In `services/ai-service/src/routes/workflows.ts`, add a WebSocket route and hook into workflow completion:

```typescript
// Add at the end of registerWorkflowRoutes():

// WebSocket endpoint for real-time execution events
fastify.get('/ws', { websocket: true }, (socket, _req) => {
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      
      if (msg.type === 'execution.subscribe' && msg.workspaceId) {
        executionEmitter.subscribe(msg.workspaceId, socket);
        socket.send(JSON.stringify({ type: 'execution.subscribed', workspaceId: msg.workspaceId }));
      }
    } catch {
      // ignore malformed messages
    }
  });
  
  socket.send(JSON.stringify({ type: 'connection.established', connectionId: `conn-${Date.now()}` }));
});
```

Also, in the existing `POST /workflows/start` handler, after the Python agent pipeline completes and files have been written, add emission:

```typescript
// After await runPipeline(...) returns and files are synced:
const { executionEmitter } = await import('../lib/executionEmitter.js');

// Emit task.started
executionEmitter.emit(workspaceId, workflowRunId, {
  projectId,
  userId,
  type: 'task.started',
  timestamp: Date.now(),
  stage: 'planning',
  progress: 10,
  payload: { instruction: prompt },
  metadata: {},
});

// Emit batch file update after agents complete
if (generatedFiles && Object.keys(generatedFiles).length > 0) {
  executionEmitter.emitFileBatch(workspaceId, workflowRunId, projectId, userId, generatedFiles);
}

// Emit task.completed
executionEmitter.emit(workspaceId, workflowRunId, {
  projectId,
  userId,
  type: 'task.completed',
  timestamp: Date.now(),
  stage: 'completed',
  progress: 100,
  payload: { filesGenerated: Object.keys(generatedFiles ?? {}).length },
  metadata: {},
});
```

#### Step 4 — Update `AIChatPanel.tsx` to remove the groq fallback for code generation

In `AIChatPanel.tsx`, find the `submitTask` function. Remove the entire `// Fall through to chat mode` section that calls `groqClient.chatStream` for coding intents. Replace it with:

```typescript
// After the backend workflow call (whether it succeeds or fails):
} catch (error) {
  setMessages(prev => prev.map(m =>
    m.id === progressMessage.id
      ? {
          ...m,
          content: `❌ **Could not reach AI service**\n\nMake sure \`ai-service\` is running on port 8003.\n\nError: ${error instanceof Error ? error.message : 'Unknown'}`,
          status: 'error',
        }
      : m
  ));
  setIsSending(false);
  return; // Do NOT fall through to Groq for code generation
}

// Groq is ONLY used for chat/Q&A (non-coding intents)
// isCodingIntent() check at the top of submitTask ensures this branch
// is only reached for questions, explanations, etc.
```

#### Step 5 — Update `aiServiceClient.ts` WebSocket URL

The `aiServiceClient` connects to `ws://localhost:8003` which is the ai-service. Update the WS endpoint to match the new route:

```typescript
// In aiServiceClient.ts constructor:
connectWebSocket(onConnect?: () => void, onError?: (error: Event) => void): void {
  if (this.ws?.readyState === WebSocket.OPEN) return;
  
  // Connect to ai-service WebSocket endpoint (not the gateway)
  const wsEndpoint = `${this.wsUrl.replace('http', 'ws')}/ws`;
  this.ws = new WebSocket(wsEndpoint);
  // ... rest of implementation unchanged
}
```

### Acceptance criteria

1. Type a coding request in AI chat: `"Create a React Todo app with add/delete functionality"`
2. Watch the AI chat panel — should show agent progress (PM → Architect → Backend → Frontend)
3. After completion, check the Preview panel — the Todo app should appear
4. Check Monaco file tree — `src/App.tsx` and `src/components/TodoList.tsx` (or similar) should exist
5. Verify DevTools Network shows NO requests to `api.groq.com` during code generation
6. Groq IS still used if you ask: `"What is the difference between useState and useReducer?"`

---

## Gap 5 — Project Creation and Template Selection UX

### Priority: HIGH — users cannot start new projects

### Root cause

`App.tsx` routes everything to `/new` with hardcoded `projectId="demo"`. There is no project creation form, no template gallery, no URL-based project routing. The `ProjectTemplate` Prisma model and `scaffold_project_tool` in Python exist but have no frontend UI.

### Files to change

```
apps/ide/src/App.tsx                                    — add /new and /p/:id routes properly
apps/ide/src/routes/NewProjectRoute.tsx                 — NEW FILE: project creation page
apps/ide/src/routes/ProjectRoute.tsx                    — NEW FILE: wraps IdeShell with project
apps/ide/src/api/projectClient.ts                       — NEW FILE: project API calls
apps/ide/src/components/TemplateGallery/index.tsx       — NEW FILE: template selection UI
```

### Do not touch

- `IdeShellRoute.tsx` and `IdeShell.tsx` — these are correct
- Backend project-service routes — already correct
- `schema.prisma` `ProjectTemplate` model — already correct

---

### Implementation

#### Step 1 — Create `apps/ide/src/api/projectClient.ts`

```typescript
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface ProjectTemplate {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  language: string;
  framework: string | null;
  thumbnailUrl: string | null;
  useCount: number;
}

export interface CreateProjectPayload {
  name: string;
  template?: string;
  visibility: 'private' | 'public';
  description?: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: string;
  template: string | null;
  language: string | null;
  framework: string | null;
}

export const projectClient = {
  async listTemplates(): Promise<ProjectTemplate[]> {
    const res = await fetch(`${API_BASE}/templates`);
    if (!res.ok) throw new Error('Failed to load templates');
    const data = await res.json();
    return data.data?.templates ?? data.data ?? [];
  },

  async createProject(payload: CreateProjectPayload): Promise<Project> {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? 'Failed to create project');
    }
    const data = await res.json();
    return data.data;
  },
};
```

#### Step 2 — Create `apps/ide/src/routes/NewProjectRoute.tsx`

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectClient, type ProjectTemplate } from '../api/projectClient';

// Built-in template definitions for offline/demo mode
const BUILT_IN_TEMPLATES: ProjectTemplate[] = [
  { id: 'react-vite', name: 'React + Vite', slug: 'react-vite', description: 'Modern React app with Vite bundler and TypeScript', category: 'Frontend', language: 'typescript', framework: 'React', thumbnailUrl: null, useCount: 0 },
  { id: 'nextjs', name: 'Next.js 15', slug: 'nextjs', description: 'Full-stack React framework with App Router', category: 'Full-stack', language: 'typescript', framework: 'Next.js', thumbnailUrl: null, useCount: 0 },
  { id: 'fastapi', name: 'FastAPI', slug: 'fastapi', description: 'Python REST API with automatic OpenAPI docs', category: 'Backend', language: 'python', framework: 'FastAPI', thumbnailUrl: null, useCount: 0 },
  { id: 'express-api', name: 'Express API', slug: 'express-api', description: 'Node.js REST API with TypeScript and Prisma', category: 'Backend', language: 'typescript', framework: 'Express', thumbnailUrl: null, useCount: 0 },
  { id: 'blank', name: 'Blank Project', slug: 'blank', description: 'Start from scratch', category: 'Other', language: 'typescript', framework: null, thumbnailUrl: null, useCount: 0 },
];

export function NewProjectRoute() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('react-vite');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) { setError('Project name is required'); return; }
    
    setCreating(true);
    setError(null);

    try {
      const project = await projectClient.createProject({
        name: name.trim(),
        template: selectedTemplate !== 'blank' ? selectedTemplate : undefined,
        visibility,
      });

      // Navigate to the new project's IDE
      navigate(`/p/${project.id}/f/src/main.tsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setCreating(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#c9d1d9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 680 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8, color: '#f0f6fc' }}>New project</h1>
        <p style={{ color: '#8b949e', marginBottom: 32 }}>Choose a template and start building.</p>

        {/* Template grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
          {BUILT_IN_TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedTemplate(t.id)}
              style={{
                background: selectedTemplate === t.id ? 'rgba(56,139,253,0.15)' : '#161b22',
                border: `1px solid ${selectedTemplate === t.id ? '#388bfd' : '#30363d'}`,
                borderRadius: 8,
                padding: '14px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                color: '#c9d1d9',
                transition: 'border-color 0.15s',
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4, color: '#f0f6fc' }}>{t.name}</div>
              <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.4 }}>{t.description}</div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#58a6ff' }}>{t.language} · {t.category}</div>
            </button>
          ))}
        </div>

        {/* Project name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#8b949e', marginBottom: 6 }}>Project name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="my-awesome-app"
            autoFocus
            style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: '10px 12px', color: '#f0f6fc', fontSize: 14, boxSizing: 'border-box' }}
          />
        </div>

        {/* Visibility */}
        <div style={{ marginBottom: 24, display: 'flex', gap: 12 }}>
          {(['private', 'public'] as const).map(v => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#c9d1d9' }}>
              <input type="radio" checked={visibility === v} onChange={() => setVisibility(v)} />
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </label>
          ))}
        </div>

        {error && <div style={{ color: '#f85149', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          style={{
            background: creating || !name.trim() ? '#21262d' : '#238636',
            border: '1px solid rgba(240,246,252,0.1)',
            borderRadius: 6,
            padding: '10px 20px',
            color: '#c9d1d9',
            fontSize: 14,
            cursor: creating || !name.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {creating ? 'Creating…' : `Create ${selectedTemplate !== 'blank' ? BUILT_IN_TEMPLATES.find(t=>t.id===selectedTemplate)?.name : 'blank'} project`}
        </button>
      </div>
    </div>
  );
}
```

#### Step 3 — Update `App.tsx`

```typescript
import { Navigate, Route, Routes } from 'react-router-dom';
import { IdeShellRoute } from './routes/IdeShellRoute';
import { NewProjectRoute } from './routes/NewProjectRoute';

export function App() {
  return (
    <Routes>
      {/* Root redirects to new project page */}
      <Route path="/" element={<Navigate to="/new" replace />} />
      
      {/* New project creation */}
      <Route path="/new" element={<NewProjectRoute />} />
      
      {/* Active project IDE — file path is in the splat */}
      <Route path="/p/:projectId/f/*" element={<IdeShellRoute />} />
      
      {/* Project root without file — default to main entry */}
      <Route path="/p/:projectId" element={<IdeShellRoute filePath="src/main.tsx" />} />
      
      {/* Catch all */}
      <Route path="*" element={<Navigate to="/new" replace />} />
    </Routes>
  );
}
```

### Acceptance criteria

1. Navigate to `/` — should show the project creation page
2. Click a template card — it should highlight with a blue border
3. Type a project name, press Enter or click Create
4. Should navigate to `/p/{uuid}/f/src/main.tsx`
5. The Preview panel should auto-boot with the selected template's files
6. If the backend is down, the error message should display clearly

---

## Gap 6 — Deployment Service (Real Provider SDK Calls)

### Priority: HIGH — one-click deploy is core to the product

### Root cause

`BuildOrchestrator` calls `getProvider(provider).deploy(...)` but the provider implementations in `services/deployment-service/src/providers/` are stubs that return placeholder data without making real API calls.

The database schema, deployment record lifecycle, Kafka events, and log streaming infrastructure are all correct. Only the provider SDK calls are missing.

### Files to change

```
services/deployment-service/src/providers/vercel.ts   — implement Vercel REST API
services/deployment-service/src/providers/railway.ts  — implement Railway GraphQL API
services/deployment-service/src/providers/index.ts    — keep as-is (already routes correctly)
services/deployment-service/package.json              — add @vercel/client if needed
```

### Do not touch

- `build_orchestrator.ts` — orchestration logic is correct
- `deploy_controller.ts` — controller is correct
- `log_streamer.ts` — log streaming is correct
- `env_injector.ts` — secrets injection is correct

---

### Implementation

#### Step 1 — Add environment variables to deployment-service `.env.example`

```env
VERCEL_TOKEN=your_vercel_token
VERCEL_ORG_ID=your_vercel_org_id
RAILWAY_TOKEN=your_railway_token
RAILWAY_PROJECT_ID=your_railway_project_id
```

#### Step 2 — Implement `services/deployment-service/src/providers/vercel.ts`

Replace the stub implementation with real Vercel REST API v9 calls:

```typescript
import { prisma } from '../lib/prisma.js';

const VERCEL_API = 'https://api.vercel.com';

interface DeployInput {
  projectId: string;       // platform project UUID
  projectName: string;     // used as Vercel project slug
  branch: string;
  commitSha: string;
  buildCommand?: string;
  outputDir?: string;
  nodeVersion?: string;
  envVars: Record<string, string>;
}

interface DeployResult {
  url: string;
  providerDeployId: string;
}

async function vercelFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN environment variable is not set');

  const teamParam = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';

  const res = await fetch(`${VERCEL_API}${path}${teamParam}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vercel API error ${res.status}: ${body}`);
  }

  return res;
}

/**
 * Ensure a Vercel project exists for this platform project.
 * Creates it if it doesn't exist.
 */
async function ensureVercelProject(projectName: string, nodeVersion?: string): Promise<string> {
  // Try to get existing project
  try {
    const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectName)}`);
    const data = await res.json();
    return data.id;
  } catch {
    // Project doesn't exist, create it
  }

  const createRes = await vercelFetch('/v9/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: projectName,
      framework: 'vite',
      nodeVersion: nodeVersion ?? '20.x',
      buildCommand: null,     // use project-level default
      outputDirectory: null,  // use project-level default
    }),
  });

  const created = await createRes.json();
  return created.id;
}

/**
 * Set environment variables on a Vercel project.
 */
async function setVercelEnvVars(vercelProjectId: string, envVars: Record<string, string>, target: 'preview' | 'production'): Promise<void> {
  if (Object.keys(envVars).length === 0) return;

  const vars = Object.entries(envVars).map(([key, value]) => ({
    key,
    value,
    target: [target],
    type: 'encrypted',
  }));

  await vercelFetch(`/v9/projects/${vercelProjectId}/env`, {
    method: 'POST',
    body: JSON.stringify(vars),
  });
}

export const VercelProvider = {
  async deploy(input: DeployInput): Promise<DeployResult> {
    const vercelProjectId = await ensureVercelProject(input.projectName, input.nodeVersion);

    const target = 'preview'; // BuildOrchestrator.deployPreview calls this
    await setVercelEnvVars(vercelProjectId, input.envVars, target);

    // Get project files from platform storage for deployment
    // Vercel deployments require file contents to be POSTed directly
    const files = await getProjectFilesForDeployment(input.projectId);

    const deployRes = await vercelFetch('/v13/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name: input.projectName,
        project: vercelProjectId,
        target,
        gitSource: input.commitSha
          ? { type: 'custom', ref: input.branch, sha: input.commitSha }
          : undefined,
        files,
        buildCommand: input.buildCommand,
        outputDirectory: input.outputDir,
        projectSettings: {
          nodeVersion: input.nodeVersion ?? '20.x',
        },
      }),
    });

    const deployment = await deployRes.json();

    return {
      url: `https://${deployment.url}`,
      providerDeployId: deployment.id,
    };
  },

  /**
   * Get deployment logs from Vercel.
   * Called by LogStreamer to stream build logs back to the IDE.
   */
  async getLogs(providerDeployId: string): Promise<AsyncIterable<string>> {
    const res = await vercelFetch(`/v2/deployments/${providerDeployId}/events`);
    const data = await res.json();

    // Convert Vercel build events to log lines
    const events: Array<{ type: string; payload: { text?: string } }> = data;

    async function* lines() {
      for (const event of events) {
        if (event.type === 'stdout' || event.type === 'stderr') {
          yield event.payload.text ?? '';
        }
      }
    }

    return lines();
  },
};

/**
 * Fetch project files from the platform for deployment.
 * Returns Vercel's required format: [{ file: path, data: content }]
 */
async function getProjectFilesForDeployment(projectId: string): Promise<Array<{ file: string; data: string; encoding?: 'base64' }>> {
  const files = await prisma.projectFile.findMany({
    where: {
      projectId,
      isDirectory: false,
      deletedAt: null,
    },
    select: {
      path: true,
      inlineContent: true,
      s3Key: true,
    },
  });

  const result: Array<{ file: string; data: string; encoding?: 'base64' }> = [];

  for (const file of files) {
    let content: string;

    if (file.inlineContent) {
      content = file.inlineContent.toString('utf-8');
    } else if (file.s3Key) {
      // Download from S3
      const { storageService } = await import('../services/storage.service.js');
      const downloaded = await storageService.downloadFile(file.s3Key);
      content = downloaded.content;
    } else {
      continue; // Skip files with no content
    }

    result.push({ file: file.path, data: content });
  }

  return result;
}
```

#### Step 3 — Implement Railway provider (abbreviated spec)

Railway uses a GraphQL API. Key mutation is `deploymentCreate`. Create `providers/railway.ts`:

```typescript
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

async function railwayMutation(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const token = process.env.RAILWAY_TOKEN;
  if (!token) throw new Error('RAILWAY_TOKEN not set');

  const res = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });

  const data: { data?: unknown; errors?: unknown[] } = await res.json();
  if (data.errors?.length) throw new Error(`Railway API error: ${JSON.stringify(data.errors[0])}`);
  return data.data;
}

export const RailwayProvider = {
  async deploy(input: DeployInput): Promise<DeployResult> {
    // 1. Create or find Railway service
    // 2. Set environment variables via serviceVariableUpsert mutation
    // 3. Trigger deployment via deploymentCreate mutation
    // 4. Return deployment URL

    const deploymentData = await railwayMutation(`
      mutation DeploymentCreate($input: DeploymentCreateInput!) {
        deploymentCreate(input: $input) {
          id
          url
        }
      }
    `, {
      input: {
        serviceId: process.env.RAILWAY_SERVICE_ID,
        environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
      }
    }) as { deploymentCreate: { id: string; url: string } };

    return {
      url: deploymentData.deploymentCreate.url,
      providerDeployId: deploymentData.deploymentCreate.id,
    };
  },
};
```

### Acceptance criteria

1. Set `VERCEL_TOKEN` in the deployment-service `.env`
2. Create a project, write some files via the AI, then click Deploy
3. A real Vercel deployment should appear in your Vercel dashboard
4. Build logs should stream to the IDE's deployment panel
5. The deployment URL should be stored in the `Deployment` database record
6. `deployment.status` should transition from `pending` → `building` → `deployed`

---

## Gap 7 — WebSocket Gateway (Real Upgrade, Not Stub)

### Priority: HIGH — all real-time features silently fail without this

### Root cause

`setupWebSocket()` in `websocket-gateway/src/app.ts` registers a Fastify route handler for `/gateway` but never performs the HTTP → WebSocket upgrade. The `reply.raw` trick it attempts is not how Fastify handles WebSocket upgrades. This means every WebSocket connection attempt from the IDE gets a regular HTTP response, not a `101 Switching Protocols` — the connection silently fails.

`ConnectionManager` in `connection/manager.ts` is fully implemented and handles message routing, channel subscriptions, presence, and pub/sub. It just needs to be called from a working WebSocket server.

### Files to change

```
services/websocket-gateway/src/app.ts                — register @fastify/websocket properly  
services/websocket-gateway/src/index.ts              — update startup to use new setup
services/websocket-gateway/package.json              — ensure @fastify/websocket is a dependency
```

### Do not touch

- `connection/manager.ts` — ConnectionManager is correct
- `connection/heartbeat.ts` — HeartbeatManager is correct
- `middleware/rate-limiter.ts` — already correct
- The IDE frontend `wsMultiplexer.ts` — correct (pending Gap 1 fix for wsUrl storage)

---

### Implementation

#### Step 1 — Verify `@fastify/websocket` is in `package.json`

```json
{
  "dependencies": {
    "@fastify/websocket": "^8.3.0"
  }
}
```

Run `pnpm install` in the `websocket-gateway` directory if needed.

#### Step 2 — Replace `setupWebSocket` in `app.ts`

The current `setupWebSocket` function is broken. Replace it entirely:

```typescript
// Remove the broken setupWebSocket function and replace with:

import websocket from '@fastify/websocket';
import { ConnectionManager } from './connection/manager';
import { HeartbeatManager } from './connection/heartbeat';
import { wsRateLimiterMiddleware } from './middleware/rate-limiter';

/**
 * Register the WebSocket endpoint on the Fastify instance.
 * Must be called after buildApp() so that @fastify/websocket is registered
 * before any WebSocket route handlers.
 */
export async function setupWebSocket(app: FastifyInstance): Promise<void> {
  // Register the websocket plugin BEFORE declaring any WS routes
  await app.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB max message size
      clientTracking: true,
    },
  });

  // WebSocket route — handles the upgrade from the IDE frontend
  app.get(
    '/gateway',
    {
      websocket: true,
      config: { rateLimit: { max: config.rateLimit.perSecond } },
    },
    async (socket, request) => {
      const ip = request.ip;
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        // Close with 4000 (application-defined) to distinguish from auth errors
        socket.close(4000, 'Missing authentication token');
        logger.warn({ ip }, 'WebSocket connection rejected: no token');
        return;
      }

      // Apply rate limiting
      const allowed = await wsRateLimiterMiddleware(request, socket);
      if (!allowed) {
        socket.close(4029, 'Too many connections');
        return;
      }

      // Authenticate and register the connection
      const connId = await ConnectionManager.handleConnection(socket, token);
      if (!connId) {
        // ConnectionManager already closed the socket with an error code
        return;
      }

      // Start heartbeat monitoring for this connection
      HeartbeatManager.trackConnection(connId, socket);

      // Handle incoming messages
      socket.on('message', async (raw: Buffer) => {
        try {
          await ConnectionManager.handleMessage(connId, raw);
        } catch (err) {
          logger.error({ err, connId }, 'Error handling WebSocket message');
        }
      });

      // Handle disconnection
      socket.on('close', async (code: number, reason: Buffer) => {
        logger.info({ connId, code, reason: reason.toString() }, 'WebSocket disconnected');
        HeartbeatManager.untrackConnection(connId);
        await ConnectionManager.handleDisconnect(connId);
      });

      // Handle errors
      socket.on('error', (err: Error) => {
        logger.error({ err, connId }, 'WebSocket error');
      });

      logger.info({ connId, ip }, 'WebSocket connection established');
    }
  );

  logger.info('WebSocket endpoint registered at /gateway');
}
```

#### Step 3 — Update `wsRateLimiterMiddleware` signature

The current `wsRateLimiterMiddleware` returns `void`. Update it to return a boolean so the gateway can close the socket:

In `middleware/rate-limiter.ts`, change the signature:

```typescript
export async function wsRateLimiterMiddleware(
  request: FastifyRequest,
  socket: WebSocket
): Promise<boolean> {
  const ip = request.ip;
  const key = `ws:ratelimit:${ip}`;
  
  // Use existing Redis rate limiting logic
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60); // 1 minute window
  }
  
  if (count > config.rateLimit.perMinute) {
    logger.warn({ ip, count }, 'WebSocket rate limit exceeded');
    return false; // Caller will close the socket
  }
  
  return true;
}
```

#### Step 4 — Update Redis pub/sub to forward to WebSocket clients

`ConnectionManager.broadcastToChannel` already sends to subscribed WS clients. The missing piece is that the Redis subscriber needs to call this. Add a Redis subscriber in `index.ts`:

```typescript
// In services/websocket-gateway/src/index.ts, after app setup:

import { createClient } from 'redis';
import { ConnectionManager } from './connection/manager';

const subscriber = createClient({ url: process.env.REDIS_URL });
await subscriber.connect();

// Subscribe to all broadcast channels
// Services publish to these channels; the gateway forwards to WebSocket clients
const SUBSCRIBED_CHANNELS = [
  'collab:*',
  'terminal:*',
  'ai:*',
  'notifications:*',
  'deploy:*',
  'presence:*',
  'preview.hmr:*',
];

// Use pSubscribe for pattern matching
for (const pattern of SUBSCRIBED_CHANNELS) {
  await subscriber.pSubscribe(pattern, (message, channel) => {
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      payload = message;
    }
    
    // Broadcast to all WebSocket clients subscribed to this channel
    ConnectionManager.broadcastToChannel(channel, {
      type: 'message',
      channel,
      payload,
    });
  });
}

logger.info('Redis pub/sub subscriber started');
```

### Acceptance criteria

1. Start the websocket-gateway service (`pnpm --filter websocket-gateway dev`)
2. Open the IDE and check DevTools → Network → WS tab
3. There should be a WebSocket connection to `ws://localhost:8012/gateway?token=...` with status `101 Switching Protocols`
4. The connection should stay open (ping/pong visible in WS frames)
5. Open two browser tabs with the same project — both should see each other's cursors in the Monaco editor
6. Trigger an AI generation — progress events should stream in real time without polling
7. The server log should show: `WebSocket connection established { connId: 'conn-xxx', ip: '...' }`

---

## Implementation Order and Dependencies

```
Gap 7 (WebSocket gateway)  ←— implement first: all real-time features depend on it
  ↓
Gap 1 (AI↔WC file sync)    ←— depends on WS events being delivered
  ↓
Gap 2 (Live preview)        ←— depends on Gap 1 for post-AI-edit HMR
  ↓
Gap 4 (Unified AI path)     ←— depends on Gaps 1+7 for end-to-end streaming
  ↓
Gap 3 (Terminal security)   ←— independent, can be done in parallel with Gap 4
  ↓
Gap 5 (Project creation)    ←— independent frontend work, no backend deps
  ↓
Gap 6 (Deployment)          ←— last: needs a working project to deploy
```

## Regression Tests

After implementing all 7 gaps, run through this E2E checklist:

| Step | Action | Expected |
|------|--------|---------|
| 1 | Navigate to `/new` | Template gallery renders |
| 2 | Select React+Vite, name `test-app`, click Create | Redirects to `/p/{uuid}/f/src/main.tsx` |
| 3 | Preview pane auto-boots | Vite app visible in iframe within 60s |
| 4 | Terminal pane opens | `$` prompt inside WebContainer |
| 5 | Type `ls` in terminal | Shows project files |
| 6 | Ask AI: "Add a blue header with 'Hello World'" | Preview updates without refresh |
| 7 | Click Deploy | Real Vercel deployment appears in dashboard |
| 8 | Open second browser tab with same project | Both cursors visible in editor |
| 9 | Kill and restart AI service | IDE reconnects automatically (Gap 7 reconnect) |

## Environment variables required before testing

```env
# .env in platform/
ANTHROPIC_API_KEY=sk-ant-...          # Required for AI agents
VERCEL_TOKEN=...                       # Required for Gap 6
VERCEL_TEAM_ID=...                     # Optional: if using a Vercel team
RAILWAY_TOKEN=...                      # Required for Railway deploy option

# apps/ide/.env.local
VITE_API_URL=http://localhost:8000/api/v1
VITE_AI_SERVICE_URL=http://localhost:8003
VITE_AI_SERVICE_WS_URL=ws://localhost:8003
VITE_WS_GATEWAY_URL=ws://localhost:8012
```
