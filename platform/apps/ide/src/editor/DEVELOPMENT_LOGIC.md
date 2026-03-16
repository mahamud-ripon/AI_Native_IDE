# 📝 IDE Editor — Monaco & Yjs CRDT Logic

> **Target:** `apps/ide/src/editor/`
> **Goal:** Bind Microsoft's Monaco Editor to the Yjs (CRDT) engine to enable real-time collaboration with human and AI Agents.
> **Standard:** Yjs `MonacoBinding`. Sub-50ms latency. LSP Autocomplete sync.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Single Source of Truth (`y-monaco`)
- **Constraint:** Do not use React `useState` to store the editor's text content. Doing so causes infinite loop cursor jumping.
- **Elite Logic:**
  - The text content natively lives inside `Y.Text` within the `yjsStore.ts`.
  - Use the `MonacoBinding` from `y-monaco` to bind the remote text exactly to the `editor.getModel()`.
  - When the user types, `MonacoBinding` generates a differential update and broadcasts it over the WebSocket Gateway without React knowing or caring.

### 2. Live Cursor & Awareness
- **Constraint:** You must render remote collaborators' exact cursor positions and highlighted selections.
- **Elite Logic:**
  - Utilize `y-protocols/awareness`.
  - The `MonacoBinding` automatically accepts the `awareness` array as its fourth argument.
  - When a user joins the project, update their specific state: `awareness.setLocalStateField('user', { color: '#ff0000', name: 'John' })`. The binding will physically draw a red cursor over the syntax-highlighted code.

### 3. Remote LSP Integration (JSON-RPC)
- **Constraint:** Monaco does not know TypeScript or Python natively; it needs a Language Server (LSP) running on the Execution VM to provide autocomplete.
- **Elite Logic:**
  - Use `monaco-languageclient` to connect the editor's Language hooks directly to a WebSocket.
  - The WebSocket (connected to `websocket-gateway` -> `execution-service`) proxies the JSON-RPC messages payload.
  - Ensure autocomplete requests only fire *after* the local file changes have successfully synced via Yjs to the remote VM to prevent autocomplete hallucinations.
