# 💻 IDE Client — Development Logic & Architecture

> **Target:** `apps/ide/` (Next.js 15 / React 19)
> **Goal:** Build the browser-based IDE frontend using the App Router. No standard Cloud VMs for basic projects; must use WebContainers (Hybrid Tier 1) to save server costs.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── editor/
 │    └── MonacoWorkspace.tsx      # Monaco Editor implementation
 ├── webcontainers/
 │    ├── boot.ts                  # WASM WebContainer initialization
 │    └── network-interceptor.ts   # ServiceWorker for localhost proxy
 ├── preview/
 │    └── LiveIframe.tsx           # Displays the WebContainer output
 ├── terminal/
 │    └── XtermTerminal.tsx        # xterm.js UI linked to WebContainer shell
 ├── state/
 │    ├── yjs-store.ts             # CRDT collaboration state
 │    └── zustand-store.ts         # Editor UI state (active tab, theme)
 ├── visualization/
 │    └── D3Graph.tsx              # D3.js implementation for AI workflows & Token analytics
 └── websocket/
      └── multiplexer.ts           # Single connection to websocket-gateway
```

## 🧠 Core Logic Rules for Developer

### 1. The Editor Integration (Monaco + LSP)
- **Constraint:** Do NOT use standard textareas. Use `@monaco-editor/react`.
- **Logic:**
  - On file open, check if an LSP connection is active.
  - Send JSON-RPC over the WebSocket multiplexer (Channel: `lsp:{project_id}:{lang}`) to the `execution-service`.
  - Do NOT run heavy language servers in the browser; proxy them via WS to the cloud VM if required, OR run a lightweight JS-based LSP in WebContainers.

### 2. Hybrid Execution (Tier 1: WebContainers)
- **Constraint:** Free tiers MUST NOT trigger a Cloud VM. WebContainers require `SharedArrayBuffer` which is blocked by default in modern browsers.
- **Logic:**
  1. **Crucial Next.js Config:** You MUST configure `next.config.ts` to attach `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` headers. Without this, WebContainers will crash on boot with a DOMException.
  2. User clicks "Run" → Instantiate `@webcontainer/api`.
  3. Mount the in-memory virtual filesystem (sync'd from Yjs state).
  4. Run node process: `webcontainerInstance.spawn('npm', ['run', 'dev'])`.
  5. **Port Interception:** Listen to `server-ready` event. Get the local WebContainer URL and inject it into the `<LiveIframe />`.
  6. **Iframe Sandboxing (Security Critical):** The `<iframe src={url}>` MUST have strict sandbox attributes (`sandbox="allow-scripts allow-forms allow-same-origin"`) and MUST NOT have `allow-top-navigation`. Furthermore, preview domains must be hosted on a separate subdomain (e.g., `*.preview.platform.io`) to prevent the user's running code from reading `window.parent.document.cookie` (XSS Session Hijacking).

### 3. Collaboration (Yjs + WebSockets)
- **Constraint:** Avoid race conditions when two users edit the same file. Two files in the same project MUST NOT share a CRDT doc.
- **Logic:**
  - Initialize `Y.Doc()`. Bind it to Monaco Editor using `y-monaco`.
  - Connect to `wss://ws.platform.io/gateway`.
  - Subscribe to channel: `collab:{project_id}:{file_id}` (File-Level isolation).
  - Subscribe to channel: `awareness:{project_id}:{file_id}` (Live cursors).
  - Rely entirely on Yjs for conflict resolution, do NOT manually merge strings.

### 4. Zero API Key Friction
- **Constraint:** System Design dictates HashiCorp Vault.
- **Logic:** The IDE should never store plain text API keys in LocalStorage. Make an HTTP call to `/api/secrets/` with a temporary session token to securely inject environment variables into the WebContainer on boot.

### 5. Next.js 15 Server Components (SSR Authorization Gap)
- **Constraint:** React Server Components (RSC) fetch data on the Node.js server, not the browser. If an RSC calls `http://api-gateway:3000/api/v1/projects`, it lacks the user's `Authorization` header and will be blocked with `401 Unauthorized`.
- **Logic:** You MUST extract the session cookie (`next-auth.session-token` or similar) inside the Server Component using `cookies()`, and explicitly attach it as an `Authorization: Bearer <token>` header to the internal `fetch()` call. The API Gateway will then blindly trust this forwarded token and execute edge auth successfully.

### 6. Advanced DAG & Analytics Visualization
- **Constraint:** Do NOT use simple CSS charts or basic charting libraries (like Chart.js) for AI logic workflows.
- **Logic:** 
  - MUST use **D3.js** for rendering complex Directed Acyclic Graphs (DAGs) of the LangGraph AI orchestrator.
  - MUST use **D3.js** for interactive cost calculation and token usage tracking dashboards.
  - Use `d3-force` and `d3-selection` within React `useRef` hooks to ensure D3 controls the DOM elements efficiently without conflicting with React's virtual DOM.
