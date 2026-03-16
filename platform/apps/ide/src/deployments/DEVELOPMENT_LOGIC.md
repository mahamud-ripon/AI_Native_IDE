# 🚀 IDE Frontend — Deployment Manager UI Logic

> **Target:** `apps/ide/src/deployments/`
> **Goal:** Give users a Vercel-like experience inside the IDE. Allow them to deploy their App's specific `branch_name` to a production environment.
> **Standard:** WebSocket Log Streaming. Status indicators. Instant Rollbacks.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Build Log WebSockets
- **Constraint:** A deployment might take 2 minutes. The user must not stare at a static "Deploying..." text.
- **Elite Logic:**
  - When a deployment triggers (`trigger_type: 'manual'`), subscribe to the WebSocket channel `deployment_logs:{deployment_id}`.
  - Render a mini-terminal displaying the remote Docker/Vercel build logs. 
  - Ensure the mini-terminal automatically scrolls to the bottom on every new log chunk, unless the user intentionally scrolls up to inspect an error.

### 2. Immutable Deployment History
- **Constraint:** Users need to compare a failed deployment against a working one.
- **Elite Logic:**
  - Fetch the deployment branch array from the `deployments` database table.
  - Render each distinct deployment as a clickable row. Clicking it displays its specific URL, branch, duration, and status (Success/Failed/Pending).
  - Include an explicit "Rollback" action which simply re-triggers the CI/CD pipeline targeting the older git commit hash.
