# 📦 IDE Frontend — Package Manager UI Logic

> **Target:** `apps/ide/src/packages/`
> **Goal:** Allow users to search for npm/pip/cargo packages and install them via a clean UI, bypassing the terminal if desired.
> **Standard:** Remote execution proxying. Real-time log streaming.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Async Installation Trigger
- **Constraint:** Clicking "Install 'react-dom'" takes 10-30 seconds. The UI cannot freeze waiting for the API.
- **Elite Logic:**
  - Send a trigger to the `execution-service` (e.g., `POST /v1/packages/install { name: "react-dom", manager: "npm" }`).
  - Instantly add the package to a local Zustand `installingQueue`.
  - Render a spinning progress ring next to the package name in the UI.

### 2. Live Installation Streaming
- **Constraint:** Installations fail (e.g., peer dependency conflicts). The user must see exactly what went wrong in real-time.
- **Elite Logic:**
  - Subscribe to a specific WebSocket channel (e.g., `package_logs:{process_id}`).
  - Render an expanding accordion or a mini-terminal under the package name that streams the exact raw `stdout`/`stderr` from the `npm install` executing inside the Firecracker VM.

### 3. Automatic package.json Sync
- **Constraint:** When `npm install xyz` finishes in the VM, the physical `package.json` file changes. The IDE's currently open `package.json` tab might still show the old version.
- **Elite Logic:**
  - The `execution-service` must broadcast a file-change event (via `Yjs` or WebSocket).
  - The IDE must automatically ingest the remote `package.json` diff and visually inject it into the `package.json` file view without overriding the user's unsaved edits in other parts of the JSON file.
