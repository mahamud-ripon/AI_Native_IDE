# ⏳ IDE Frontend — Local History & Snapshots Logic

> **Target:** `apps/ide/src/history/`
> **Goal:** Provide a "Local History" or "Timeline" view (similar to Google Docs history or VS Code Timeline view) where users can rollback specific file changes independently of full Git commits. 
> **Standard:** Read-only Monaco Diffs. Micro-snapshot polling.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Snapshot Hydration API
- **Constraint:** A file can have 500 snapshot versions (`file_versions` / `project_snapshots` table) over a month. Fetching them all kills network bandwidth.
- **Elite Logic:**
  - Fetch history in paginated chunks: `GET /v1/projects/:id/files/:file_id/history?limit=20`.
  - Render a vertical timeline component in the sidebar. Label each snapshot automatically (e.g., "Saved by John" vs "AI Agent generated").

### 2. Time-Travel Diffing
- **Constraint:** A user clicking sequentially backward through 10 snapshots should instantly see the code morph to that point in time.
- **Elite Logic:**
  - Create a temporary, unlinked `Monaco Editor` instance initialized in Diff-Mode.
  - Set the right pane strictly to the current active `Y.Text` document state.
  - Set the left pane strictly to the HTTP-fetched text content of the older Snapshot.
  - Include a large "Restore this version" button in the UI. If clicked, overwrite the active `Y.Doc` state with the historical text string. The `MonacoBinding` will automatically calculate the diff and spray the update across the multiplayer network.
