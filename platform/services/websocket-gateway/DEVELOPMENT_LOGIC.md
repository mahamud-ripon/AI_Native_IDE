# 🔌 WebSocket Gateway — Development Logic & Architecture

> **Target:** `services/websocket-gateway/` (TypeScript / Node.js)
> **Goal:** The central nervous system for real-time IDE features. Multiplexes Collab, Terminal, AI, and Notifications into a single persistent WS connection per user.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── connection/
 │    ├── manager.py               # Manages active connections and JWT auth
 │    └── heartbeat.py             # Parses ping/pongs to clear dead connections
 ├── channels/
 │    ├── collab_handler.py        # Routes Yjs to collab-service
 │    ├── eval_handler.py          # Routes terminal.js output to execution-service
 │    └── ai_handler.py            # SSE/JSON streaming from ai-service
 └── redis/
      └── pubsub.py                # Pub-sub client for intra-service events
```

## 🧠 Core Logic Rules for Developer

### 1. Connection Multiplexing & Thundering Herd Defense (§6.4)
- **Constraint:** Do NOT let the IDE client open 5 separate WebSockets. That will exhaust file descriptors and increase latency. Furthermore, if a frontend node restarts, 50,000 users attempting to reconnect simultaneously will self-DDoS the auth and project services.
- **Logic:**
  - Expose ONE endpoint: `wss://ws.platform.io/gateway?token=JWT`.
  - Validate the `JWT` securely via the Auth-Service (or shared JWT secret decoding).
  - The client must send JSON to subscribe to internal channels: `{ "type": "subscribe", "channel": "collab:proj123" }`.
  - Store the active connection in memory dict and update `Redis` state: `SET ws:{conn_id} {user_id...}`.
  - **DDoS Defense (Extreme Rule):** You MUST instruct the Frontend developers to implement **Jittered Exponential Backoff** for reconnects. Example: `Math.random() * Math.pow(2, retryCount) * 1000`. The Gateway MUST actively rate-limit HTTP Upgrade requests exceeding 500/sec per pod, returning `HTTP 429 Too Many Requests` with a `Retry-After` header.
  - **Idempotency (Ghost Generation Defense):** Every mutating WebSocket payload (like triggering AI) MUST contain a `message_id`. The gateway must check Redis (`SETNX msg:{message_id}`) to drop accidental double-sends before routing to AI or Execution services.

### 2. The Routing Table & Binary Stream Bottleneck
- **Constraint:** The gateway shouldn't process data, it just routes it. However, routing heavy binary Y.js CRDT buffers through Redis Pub/Sub will block Redis's single-threaded core and cause cluster-wide OOM or latency failures during high concurrency.
- **Logic:**
  - **The Pub/Sub Ban:** Do NOT use Redis Pub/Sub for high-throughput binary streaming. The Gateway MUST route `collab:{project_id}:{file_id}` binary buffers to the internal `collab-service` using dedicated **gRPC streams** or pure TCP multiplexing. Keep Redis strictly for lightweight control signals (like user online/offline presence).
  - `awareness:{project_id}:{file_id}` ➔ Forward awareness/cursor updates to `collab-service`.
  - `terminal:{vm_id}` ➔ Forward UTF-8 chunks to `execution-service` (where the VM is running) via gRPC.
  - `ai:{conversation_id}` ➔ Accept Server-Sent Events (SSE) JSON streaming from `ai-service` and push to the frontend.

### 3. Cleanup & Disconnect Lifecycles
- **Constraint:** Zombie processes and memory leaks will crash the system.
- **Logic:**
  - Expect a `ping` message every 30 seconds from the client.
  - If no `ping` for 90 seconds, forcefully disconnect.
  - On disconnect: Publish `user_offline` event to Redis Pub/Sub, so `collab-service` can save file state and `execution-service` can prepare to hibernate the VM if no one is left.
  - Cleanup Redis state: `DEL ws:{conn_id}`.
