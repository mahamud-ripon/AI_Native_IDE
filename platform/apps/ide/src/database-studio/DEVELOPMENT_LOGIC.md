# 🗄️ IDE Frontend — Database Studio (Viewer) Logic

> **Target:** `apps/ide/src/database-studio/`
> **Goal:** Let users view and edit the database tables (SQLite, Prisma, Postgres) of the project running inside their Firecracker VM natively within a browser tab.
> **Standard:** Paginator Grids. Secure SQL Proxying.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Database Proxy Driver
- **Constraint:** The browser cannot open raw TCP port 5432 to connect to a PostgreSQL database securely. Doing so would violate the WebSocket Gateway multiplexer design.
- **Elite Logic:**
  - Build a custom Database View (React DataGrid).
  - When the user selects "View Table `users`", send a JSON-RPC command via the `websocket-gateway` to the `execution-service`.
  - The `execution-service` runs a sidecar agent inside the VM. This agent securely establishes the database connection `(e.g., using pg or sqlite3)`, executes the `SELECT * FROM users LIMIT 100`, and streams the JSON rows back through the WebSocket.

### 2. Destructive Operations Warning
- **Constraint:** Users accidentally deleting rows in their Dev Database without a confirm dialog.
- **Elite Logic:**
  - When a user highlights a row and clicks `= Delete =`, pop up an immediate confirmation modal with a red, irreversible background.
  - Require the user to type `DELETE` for massive table drops to ensure the IDE protects them from critical data loss.
