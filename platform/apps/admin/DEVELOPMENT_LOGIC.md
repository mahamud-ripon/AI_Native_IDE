# 🛡️ Admin Panel — Development Logic & Architecture

> **Target:** `apps/admin/` (Next.js / Vite)
> **Goal:** Internal dashboard for platform administrators to monitor 1M+ active users, Firecracker VM pool stats, AI Token budgets, and system health.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── dashboard/               # Main overview metrics
 ├── users/                   # User management and bans
 ├── infrastructure/          # VM pool and Kubernetes metrics
 └── analytics/
      ├── TokenUsageTree.tsx  # D3.js Hierarchical map of token spend
      └── VmLoadHeatmap.tsx   # D3.js Heatmap of VM cold start delays
```

## 🧠 Core Logic Rules for Developer

### 1. Big Data Visualization Constraint (D3.js)
- **Constraint:** The admin panel handles millions of rows of telemetry and usage metadata. Basic chart libraries will freeze the browser.
- **Logic:**
  - **Exclusively use D3.js** for rendering performance graphs, token usage bursts, and infrastructure heatmaps.
  - **Zoom & Pan:** Ensure time-series charts (e.g., API Gateway latency, LLM Model failure rates) implement D3's zoom and brush features to allow admins to drill down into specific minute-by-minute spikes.
  - **Live Streaming:** Use WebSockets to pipe live data from `background-worker` into D3 real-time shifting graphs. Do not rely entirely on HTTP polling.

### 2. Security & Role-Based Access Control (RBAC)
- **Constraint:** A compromised admin panel means total platform takeover.
- **Logic:**
  - Enforce strict server-side RBAC validation via custom auth service for every API call.
  - Next.js Middleware must redirect unauthorized users back to the login screen before any JS loads.
  - Audit Logs: Every admin action (e.g., deleting a user, overriding a billing plan) must trigger an `audit_logs` insertion in PostgreSQL.

### 3. Server-Side Data Aggregation
- **Constraint:** Do not download 100,000 logs to the browser just to show a pie chart.
- **Logic:** Write specialized SQL aggregation queries (or Elasticsearch rollups) in the backend. Send ONLY the aggregated bucket data points (e.g., `[{"hour": "10:00", "errors": 50}]`) to the frontend D3 charts.
