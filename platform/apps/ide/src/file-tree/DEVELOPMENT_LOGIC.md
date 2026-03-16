# 🗂️ IDE Frontend — Virtual File Tree Logic

> **Target:** `apps/ide/src/file-tree/`
> **Goal:** Render a VS Code style file explorer sidebar capable of smoothly rendering 10,000+ files without DOM lag. Handle drag-and-drop, folder expansion, and file creation/renaming.
> **Standard:** DOM Virtualization. O(1) State Lookups. Context Menu API.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Virtualized DOM rendering (React Window)
- **Constraint:** A standard `<ul>` with 10,000 nested `<li>` elements will freeze the browser tab upon expanding the `node_modules` folder.
- **Elite Logic:**
  - You MUST use a virtualization library like `@tanstack/react-virtual` or `react-window`.
  - The API provides a deep nested JSON tree: `{ name: "root", children: [ ... ] }`.
  - You must **flatten** this representation into a 1D Array of visible nodes based on which folders are expanded:
    `[{ id: 1, name: "src", depth: 0 }, { id: 2, name: "index.ts", depth: 1 }]`
  - React virtualizes the scrolling, rendering only the ~40 files currently visible in the sidebar viewport.

### 2. Optimistic UI Updates via Zustand
- **Constraint:** If a user clicks "Rename File", waiting 150ms for the `project-service` HTTP response before visually updating the name makes the IDE feel extremely laggy.
- **Elite Logic:**
  - Store the flat file map in Zustand: `fileMap: Record<string, FileNode>`.
  - When the user presses "Enter" to rename, update the Zustand `fileMap` *instantly* (Optimistic Update).
  - Fire the `PUT /api/v1/projects/:id/files` API call in the background.
  - If the API catches an error (e.g., "File name already exists 409"), revert the Zustand state back to the original name and pop a toast notification.

### 3. File System Syncing with AI & Collab
- **Constraint:** The AI Agent might generate 5 new files in the background. The file tree needs to reflect this live.
- **Elite Logic:**
  - The WebSocket `websocket-gateway` will emit `file.created` or `file.deleted` events.
  - Listen to these events in the global layout effect.
  - Update the Zustand tree, which instantly re-renders the specific row. Do not re-fetch the entire tree API endpoint.

### 4. Custom Context Menu
- **Constraint:** The browser's native right-click menu is ugly and lacks "New Folder" / "Delete" options.
- **Elite Logic:**
  - Intercept the `onContextMenu` React event on the file tree rows.
  - Prevent default `e.preventDefault()`.
  - Trigger a Radix UI `<ContextMenu>` at the exact `e.clientX, e.clientY` coordinates.
