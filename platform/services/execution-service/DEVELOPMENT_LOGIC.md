# ☁️ Execution Service — Elite Engineering Logic & Architecture

> **Target:** `services/execution-service/` (TypeScript / Node.js)
> **Goal:** The heavy lifter. Safely runs arbitrary, untrusted user code in isolated environments. Manages both Free Tier (WebContainers proxy) and Pro Tier (Firecracker MicroVMs).
> **Standard:** Complete multi-tenant isolation. Zero container escapes. Sub-125ms startup latency.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── vm_manager/                   # Core Firecracker orchestrator
 │    ├── prewarmer.ts             # Maintains a pool of paused, booted VMs
 │    ├── jailer_cli.ts            # Wrapper around firecracker-jailer
 │    └── snapshot_manager.ts      # Saves/Restores memory state to S3 (Hibernation)
 ├── network/
 │    └── tap_interfaces.ts        # Provisions isolated CNI tap devices per VM
 ├── streams/
 │    ├── terminal_pty.ts          # Connects WebSocket to VM /dev/pts/0 (Pseudo-tty)
 │    └── fs_sync.ts               # Background process to sync PostgreSQL files to VM disk
 ├── security/
 │    └── vault_agent.ts           # Authenticates execution-service via K8s Service Account (KSA)
 └── rpc/
      └── gateway_handler.ts       # Listens to events from the websocket-gateway
```

## 🧠 Elite Engineering Guidelines for Developer (DO NOT DEVIATE)

### 1. The Pre-warmed Pool (Cold Starts are Unacceptable)
- **Constraint:** A user clicking "Run" on a Python script cannot wait 5 seconds for a Linux kernel to boot. The target is < 125ms.
- **Elite Logic:**
  - The `prewarmer.ts` daemon MUST constantly maintain a pool of e.g., 20 `Ubuntu Base` Firecracker VMs that are successfully booted but geographically **paused** in memory.
  - When a user requests execution, the service takes a paused VM from the pool.
  - It mounts the user's specific project files (`ext4` block device or `virtio-fs`).
  - It unpauses the VM. Result: Instant execution.
  - Instantly spin up a new paused VM in the background to replenish the pool.

### 2. Multi-Tenant Hard Isolation (The Jailer)
- **Constraint:** Users will write malicious code (`rm -rf /`, fork-bombs, network scanners). Under NO circumstances can a user code escape the VM and see another user's code or the AWS Metadata API.
- **Elite Logic:**
  - **No Standard Docker.**
  - Every Firecracker process MUST run inside `jailer`.
  - Drop all Linux capabilities. Run as a non-root `uid/gid`.
  - **Network Constraint:** The TAP interface assigned to the VM must be restricted via `/sbin/tc` (Traffic Control) to 10Mbps bandwidth to prevent outgoing DDoS attacks.
  - **Disk IOPS Constraint:** Firecracker jailer MUST be configured with strict block device rate limiting (e.g., 1000 IOPS, 50MB/s) to prevent a "Noisy Neighbor" from exhausting the host's NVMe drive.
  - IPtables must strictly block access to `169.254.169.254` (AWS IMDS metadata endpoint).
  - **Internal Subnet Zero-Trust (Extreme Rule):** IPtables MUST aggressively `DROP` any packets originating from the VM targeting the internal Kubernetes cluster IP range (e.g., `10.96.0.0/12`), completely preventing the tenant from port-scanning HashiCorp Vault or other microservices.

### 3. Execution Data Flow (STDIO Streaming)
- **Constraint:** Code execution is not a simple REST request. A user running `node server.js` creates a persistent process that emits streams of text (`stdout`/`stderr`) over hours.
- **Elite Logic:**
  - Create a Pseudo-Terminal (PTY) on the Host that maps to the VM shell.
  - Stream the binary `stdout` from the VM directly to the `websocket-gateway` using the channel `terminal:{session_id}`.
  - Do NOT buffer the entire output in memory. Use Node.js / Go Streams (`io.Copy`).
  - If the user sends `Ctrl+C` via WebSocket, translate the UI event into a literal `SIGINT` (0x03) character and write it to the PTY `stdin`.

### 4. Memory Snapshotting (Hibernation)
- **Constraint:** VMs are expensive. If a user walks away for 10 minutes, the VM must sleep without losing their terminal history or running dev server.
- **Elite Logic:**
  - Listen for the `HIBERNATE_VM` command (triggered by `background-worker`).
  - Tell Firecracker to create a MicroVM memory snapshot and rootfs diff.
  - Save the snapshot files (`mem.img`, `diff.ext4`) to AWS S3.
  - Kill the local Firecracker process to free up host RAM.
  - When the user returns, download the snapshot, use the `Restoring` API of Firecracker, and the user's dev server continues exactly from the millisecond it paused.

### 5. File System Synchronization & Secret Injection
- **Constraint:** If a user types code in the browser (`project-service` -> PostgreSQL), that code must materialize inside the VM instantly so the user can run it. Setting secrets via `--env` leaves them exposed to the host OS `ps aux` command.
- **Elite Logic:**
  - The VM should NOT run a heavy `git pull` every time a file changes.
  - When a file is updated in the database, the `project-service` fires a Kafka event.
  - The `execution-service` catches it and writes the file directly to the VM's mounted volume via `virtio-fs` or a sidecar agent running inside the VM.
  - **Secret Injection (ps aux defense):** When running execution commands, the `execution-service` daemon must retrieve HashiCorp Vault secrets. It MUST NOT pass them via command-line arguments to the Firecracker binary. Instead, it creates a temporary `.env` file within the mounted `virtio-fs` directory to be sourced locally by the VM, deleting it upon session termination.

---

## 🚀 API Endpoints Contract (Must Implement Exactly)

### POST `/api/v1/exec/run`
- **Body:** `{ "project_id": "uuid", "command": "npm run dev", "env": { "PORT": "3000" } }` (Validate via Zod/Pydantic).
- **Action:** 
  1. Verify user RBAC (must have execute permissions for project).
  2. Allocate a VM from the pre-warmed pool. Mount project files.
  3. Execute command via Firecracker agent.
- **Response:** `200 OK` | `Body: { "success": true, "session_id": "uuid", "status": "running" }`

### GET `/api/v1/exec/ws/{session_id}`
- **Note:** This is an upgrade request handler (WebSocket) that proxies PTY binary streams.
- **Action:** Bind the incoming WebSocket connection to the Firecracker `/dev/pts/0` file descriptor.
- **Response:** `101 Switching Protocols` (Raw UTF-8 binary stream).

### POST `/api/v1/exec/install`
- **Body:** `{ "project_id": "uuid", "package_manager": "npm", "packages": ["react", "lodash"] }`
- **Action:** 
  1. Trigger package installation inside the VM.
  2. Stream output back to WebSocket (if connected).
  3. Publish Kafka event `file.modified` for `package.json` updates so DB syncs.
- **Response:** `202 Accepted` | `Body: { "success": true, "job_id": "uuid" }`

---

## ⚠️ ACTION ITEMS (Priority Order)

### Priority 1: Critical

#### 1.1 Add Circuit Breaker
- **Current:** No circuit breaker for upstream service calls
- **Required:** Add circuit breaker to prevent cascading failures
- **File:** `src/rpc/gateway_handler.ts`
- **Reference:** `@developer_guidelines.md` Section 1.3

### Priority 2: High

#### 2.1 Add Pagination to Execution History
- **Current:** No pagination on execution list
- **Required:** Add cursor-based pagination for code_executions
- **File:** `src/controllers/execution_controller.ts`
- **Reference:** `@developer_guidelines.md` Section 3.4

---

*Last Updated: March 12, 2026 - Action items from analysis*
