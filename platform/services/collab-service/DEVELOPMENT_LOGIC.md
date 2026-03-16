# 🤝 Collab Service — Development Logic & Architecture

> **Target:** `services/collab-service/` (Node.js)
> **Goal:** Manage real-time, conflict-free document editing (like Google Docs/Figma) for multiple users typing in the same file simultaneously. Handle live cursors and user presence.
> **Standard:** Sub-50ms latency. Zero data loss during concurrent edits. Pure CRDT (Conflict-free Replicated Data Type) architecture.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── core/
 │    ├── yjs_manager.ts           # Core Yjs Document pool in memory
 │    └── awareness_manager.ts     # Yjs Awareness (Live cursors & Who is online)
 ├── persistence/
 │    ├── leveldb_adapter.ts       # Fast memory-to-disk Yjs snapshotting
 │    └── postgres_sync.ts         # Periodic flush of final text to project_files DB
 ├── rpc/
 │    └── gateway_handler.ts       # Listens to binary messages from websocket-gateway
 └── events/
      └── kafka_consumer.ts        # Listen to project.deleted to clear LevelDB
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Pure CRDT Architecture (Yjs)
- **Constraint:** Do NOT attempt to build custom Operational Transformation (OT) logic or write manual string diffing algorithms. It will break.
- **Logic:** 
  - MUST use `yjs` as the core data structure to hold the text state.
  - MUST use `y-protocols/awareness` to handle user cursors (line 5, column 12) and presence (color, name).
  - **Ghost Cursor Prevention:** The awareness data MUST have a strict 15-second TTL in Redis. The frontend must send a heartbeat (ping) every 10 seconds. If a heartbeat is missed, the connection is dropped and the cursor is immediately purged to prevent memory leaks.
  - The `Y.Doc` for a specific file is kept actively in RAM as long as at least 1 user is viewing it.

### 2. The WebSocket Gateway Decoupling
- **Constraint:** The `collab-service` MUST NOT expose a public WebSocket endpoint `wss://`. 
- **Logic:**
  - All clients connect ONLY to the `websocket-gateway` (which multiplexes all data).
  - The Gateway routes binary Yjs updates (`Uint8Array`) to the internal `collab-service` via Redis Pub/Sub or gRPC streams.
  - *Data flow:* Client A types → `Gateway` → `Redis Pub/Sub` → `Collab Service` applies update to memory `Y.Doc` → `Collab Service` broadcasts the new binary diff → `Gateway` → Client B sees the typing.

### 3. High-Speed Persistence (Redis / StatefulSets) & CRDT Garbage Collection
- **Constraint:** Writing every single keystroke to PostgreSQL compiles huge latencies and crashes the database. Conversely, storing the `Y.Doc` in local memory/disk (e.g., standard LevelDB) in a Kubernetes Deployment guarantees catastrophic data loss when a Pod is evicted or crashes before the 5-minute Postgres flush.
- **Logic:**
  - **The Stateless Pod Defense (Extreme Rule):** You MUST back the CRDT binary persistence using a highly available **Redis Cluster (via `y-redis`)** or deploy the `collab-service` as a strict K8s **StatefulSet** with Persistent Volume Claims (PVCs). Local ephemeral disk storage is banned.
  - If the `collab-service` Pod crashes and restarts, it instantly re-hydrates the `Y.Doc` state from the centralized Redis store or PVC before accepting new WebSocket updates.
  - **CRDT Garbage Collection (Extreme Rule):** You MUST implement a nightly cron-job (or threshold trigger every 1000 updates) that runs `Y.encodeStateAsUpdate(ydoc)` and overwrites the un-compacted history with a squashed Tombstone state, keeping the binary size strictly under 1MB.
  - **CRDT Garbage Collection (Extreme Rule):** You MUST implement a nightly cron-job (or threshold trigger every 1000 updates) that runs `Y.encodeStateAsUpdate(ydoc)` and overwrites the un-compacted history with a squashed Tombstone state in LevelDB/Postgres, keeping the binary size strictly under 1MB.

### 4. Eventual PostgreSQL Synchronization
- **Constraint:** `project-service` and `ai-service` need to read the actual text content from PostgreSQL (`project_files`), not a binary Y.Doc.
- **Logic:**
  - When the last user disconnects from a file (or every 5 minutes), the `postgres_sync.ts` job runs.
  - It converts the `Y.Doc` into a standard string: `const text = ydoc.getText('monaco').toString()`.
  - It pushes this plain text string to PostgreSQL (`project_files.inline_content`) via the `@workspace/database` Prisma client.

### 5. AI Agent Real-Time Collaboration
- **Constraint:** The AI is not a magic black box; it is treated as a "Collaborator".
- **Logic:**
  - When the `ai-service` is modifying code, it connects to the `collab-service` just like a normal user would.
  - The AI Agent gets an Awareness state (Avatar: 🤖, Color: Purple).
  - Users will physically see the AI's cursor moving and typing the code block by block in real-time, leveraging the exact same Yjs CRDT logic.

---

## 🚀 Internal API Contract (Used by Gateway)

*(Note: These are internal hooks called via Redis/gRPC by the `websocket-gateway`, NOT HTTP endpoints).*

### HOOK: `onUserJoinFile({ projectId, fileId, userId })`
- **Action:** Load `Y.Doc` from LevelDB into RAM (if not already loaded). Send the full binary `Y.Doc` state to the new user so their Monaco Editor gets in sync.

### HOOK: `onYjsUpdate({ fileId, binaryUpdate })`
- **Action:** Apply `Y.applyUpdate(ydoc, binaryUpdate)`. Broadcast the difference to all other active users in that `fileId`.

### HOOK: `onAwarenessUpdate({ fileId, awarenessBinary })`
- **Action:** Update the local awareness state (cursors, selections). Broadcast to others.

### HOOK: `onUserLeaveFile({ fileId, userId })`
- **Action:** Remove user from awareness state. If 0 users remain, flush string text to PostgreSQL and purge the `Y.Doc` from RAM to save memory.

---

## ⚠️ ACTION ITEMS (Priority Order)

### Priority 1: Critical

#### 1.1 Add Circuit Breaker
- **Current:** No circuit breaker for WebSocket connections
- **Required:** Add circuit breaker for upstream service calls
- **File:** `src/gateway/websocket_handler.ts`
- **Reference:** `@developer_guidelines.md` Section 1.3

### Priority 2: High

#### 2.1 Add Pagination to Collab History
- **Current:** No pagination on document list
- **Required:** Add cursor-based pagination for collab_documents
- **File:** `src/controllers/collab_controller.ts`
- **Reference:** `@developer_guidelines.md` Section 3.4

---

*Last Updated: March 12, 2026 - Action items from analysis*
