# 📝 IDE Editor — Monaco & Yjs CRDT Logic (Elite Standard)

> **Target:** `apps/ide/src/editor/`
> **Goal:** Connect Microsoft's Monaco Editor to the `collab-service` via Yjs to enable real-time, Google Docs-style multiplayer coding.
> **Standard:** Zero text conflicts. Live cursors. Sub-50ms keystroke sync.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Strict Y.Doc Binding
- **Constraint:** Do NOT read `editor.getValue()` or use React `useState` to manage the content of the file. React state is too slow for 60FPS typing and will cause render loops.
- **Elite Logic:**
  - Import `Y.Doc` from `yjs` and the `MonacoBinding` from `y-monaco`.
  - The single source of truth for the text is the `yText` instance inside the `Y.Doc`.
  - When the component mounts:
    ```typescript
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('monaco');
    const binding = new MonacoBinding(ytext, editor.getModel(), new Set([editor]), provider.awareness);
    ```
  - Let the `MonacoBinding` handle all text diffing internally.

### 2. Live Cursor & Awareness State
- **Constraint:** You must render other users' cursors (and the AI's cursor) physically on the screen with their names and avatars.
- **Elite Logic:**
  - Use `y-protocols/awareness`.
  - When a user joins, generate a random hex color or fetch their avatar. 
  - Send the local state to the awareness instance: `provider.awareness.setLocalStateField('user', { name: "Ripon", color: "#ff0000" })`.
  - The `MonacoBinding` will automatically draw CSS widgets of the remote cursors over the text based on this awareness state.

### 3. File Switching (Performance Trap)
- **Constraint:** If a user clicks between 10 files in the File Tree quickly, do NOT spawn 10 WebSocket connections or 10 Yjs instances. This will crash the browser tab.
- **Elite Logic:**
  - Maintain a **Pool** of `Y.Doc` instances in Zustand (`yjsStore.ts`).
  - When switching from `utils.ts` to `index.ts`:
    1. Unbind the old `MonacoBinding`.
    2. Retrieve the `Y.Doc` for `index.ts` from the Zustand store (if it exists) or trigger the WebSocket Gateway to subscribe to `collab:index.ts`.
    3. Re-bind the new `Ytext` to the exact same Monaco Editor instance using `editor.setModel()`. Do not destroy and remount the Monaco component itself.

### 4. Language Server Protocol (LSP) Coupling
- **Constraint:** Real-time syntax highlighting and autocomplete must work collaboratively.
- **Elite Logic:**
  - Connect Monaco to the remote LSP server running in the Firecracker VM (`execution-service`).
  - Use `monaco-languageclient` to proxy the LSP messages via JSON-RPC over the `websocket-gateway` (Channel: `lsp:proj-123:typescript`).
  - The LSP must validate the text based on the the *current remote state* of the file, not just the local edit.
