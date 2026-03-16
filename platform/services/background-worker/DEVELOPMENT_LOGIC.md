# ⚙️ Background Worker — Development Logic & Architecture

> **Target:** `services/background-worker/` (TypeScript / Node.js)
> **Goal:** The unsung hero of the platform. Executes all asynchronous cron jobs, data cleanups, garbage collection, and usage aggregations. 
> **Standard:** Completely headless. No HTTP server. 100% resilient to crashes. Idempotent operations.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── jobs/
 │    ├── vm_hibernation_job.ts    # Scans for idle VMs and hibernates them via execution-service
 │    ├── usage_rollup_job.ts      # Flushes Redis billing counters into Postgres
 │    ├── garbage_collector.ts     # Deletes expired JWTs and orphaned S3 files
 │    └── telemetry_job.ts         # Aggregates system metrics for the Admin Dashboard
 ├── scheduler/
 │    └── cron_manager.ts          # Registers intervals (e.g., node-cron or BullMQ)
 └── queue/
      └── dead_letter_queue.ts     # Handles jobs that fail 3+ times
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. No HTTP Endpoints Allowed
- **Constraint:** This is a pure worker daemon. It does not serve web traffic. Do NOT install Express or Fastify here.
- **Logic:** The worker runs purely on `setInterval`, `cron` expressions, or by popping tasks off a Redis Queue (`BullMQ` / `Celery`).

### 2. Idempotency is Mandatory
- **Constraint:** If the worker crashes in the middle of a job and restarts, it might process the same data twice.
- **Logic:** 
  - Every job MUST be idempotent.
  - Example: For the `usage_rollup_job.ts`, do not just run `tokens = tokens + X`. 
  - Read `X` from Redis. Execute the SQL update. If successful, explicitly delete or zero out the exact Redis key it just read. If it crashes halfway, the Redis key won't be deleted, and it safely retries on the next tick.

### 3. The Big 3 Scheduled Tasks

#### A. The Idle VM Reaper (Runs Every 60 Seconds)
- **Constraint:** Firecracker VMs cost money while running. If a user closes the browser, the VM must hibernate. However, sending multiple hibernate commands during a slow S3 snapshot causes state corruption.
- **Logic:**
  - Query Redis: `GET vm_last_active:{vm_id}` (Updated by WebSocket Gateway).
  - If a VM's last active ping is > 10 minutes ago, acquire an exclusive lock: `SET lock:hibernate:{vm_id} "1" EX 300 NX`.
  - If lock acquired, send an internal command to `execution-service` to TRIGGER HIBERNATION (snapshot memory to S3 and kill Firecracker process).
  - Mark `status = hibernated` in `project_snapshots`.

#### B. The Billing Synchronizer (Runs Every 5 Minutes)
- **Constraint:** Redis holds real-time token counts, but PostgreSQL is the source of truth for monthly billing.
- **Logic:**
  - Scan all `usage:{user_id}:{date}:*` keys in Redis.
  - Batch Update `usage_daily` in Postgres using `prisma.$transaction`.
  - Delete processed Redis keys.

#### C. The Garbage Collector (Runs Nightly at 03:00 AM)
- **Constraint:** The database will bloat if we do not delete old temporary data.
- **Logic:**
  1. Delete all `refresh_tokens` where `expires_at < NOW()`.
  2. Delete all `invitations` where `expires_at < NOW()`.
  3. Scan `project_files` with `s3_key IS NULL` AND `inline_content IS NULL` (Orphaned DB rows) and purge them.

### 4. Distributed Locking for Multi-Instancing
- **Constraint:** In production, Kubernetes might run 3 replicas of the `background-worker` for high availability.
- **Logic:**
  - If all 3 pods try to run the "Billing Synchronizer" at the exact same minute, it will cause race conditions and DB deadlocks.
  - Use **Redis-based Distributed Locks** (e.g., `Redlock`).
  - When the Cron ticks, Pod 1 acquires the lock `lock:cron:billing_sync`. 
  - Pods 2 and 3 fail to get the lock and skip the job for that interval.

---

## 📋 Full Task Registry (synchronized with System Design §6.3)

> Every task listed below must be implemented with the exact queue assignment, trigger, and retry configuration. These are the platform's 17 background tasks across 5 dedicated queues.

### Queue Configuration

| Queue | Workers | Priority | Purpose |
| :--- | :---: | :--- | :--- |
| `ai` | 2 | HIGH | AI orchestration and security scanning |
| `email` | 10 | HIGH | Transactional emails |
| `cleanup` | 5 | LOW | Resource cleanup and archival |
| `embedding` | 3 (CPU-heavy) | MEDIUM | Code embedding generation |
| `usage` | 2 | MEDIUM | Usage aggregation and billing sync |

### AI Tasks (Queue: `ai`)

| Task Name | Trigger | Priority | Retry | Description |
| :--- | :--- | :--- | :--- | :--- |
| `ai.generate_orchestrate` | User prompt via API | HIGH | 2x (60s, 120s) | Main LangGraph orchestrator entry point |
| `ai.scan_generated_code` | After AI generation completes | MEDIUM | 3x (30s, 60s, 120s) | Scan for embedded secrets, malicious patterns, unsafe eval/exec |
| `ai.fallback_provider` | Primary LLM provider 5xx | HIGH | 1x (immediate) | Switch to fallback model (GPT-4o → Gemini Flash) |

### Embedding Tasks (Queue: `embedding`)

| Task Name | Trigger | Priority | Retry | Description |
| :--- | :--- | :--- | :--- | :--- |
| `embedding.update_file` | Kafka `file.modified` event | MEDIUM | 3x (60s, 120s, 240s) | Re-embed single file chunks into pgvector |
| `embedding.full_reindex` | Project import from GitHub | LOW | 2x (120s, 300s) | Re-embed ALL files in project. **OOM Constraint:** MUST stream files in batches of 50 via Cursor. Store progress checkpoint in Redis to avoid restarting from 0 on failure. |
| `embedding.remove_file` | Kafka `file.deleted` event | LOW | 3x (30s, 60s, 120s) | Remove file's embeddings from pgvector |

### Email Tasks (Queue: `email`)

| Task Name | Trigger | Priority | Retry | Description |
| :--- | :--- | :--- | :--- | :--- |
| `email.send_verification` | Kafka `user.created` event | HIGH | 3x (60s, 120s, 240s) | Welcome + email verification link |
| `email.send_invitation` | Kafka `invitation.created` event | MEDIUM | 3x (60s, 120s, 240s) | Project/Org invitation email |
| `email.send_deploy_status` | Kafka `deployment.completed` event | MEDIUM | 2x (60s, 120s) | "Your deployment is live" notification |
| `email.send_usage_alert` | Kafka `usage.limit_reached` event | MEDIUM | 3x (60s, 120s, 240s) | "You've used 80% of your AI quota" |

### Cleanup Tasks (Queue: `cleanup`)

| Task Name | Trigger | Priority | Retry | Description |
| :--- | :--- | :--- | :--- | :--- |
| `cleanup.idle_vms` | Scheduled: every 60 seconds | LOW | 1x (30s) | Hibernate VMs idle >5min (see Rule 3A) |
| `cleanup.expired_invitations` | Scheduled: daily 02:00 UTC | LOW | 1x (300s) | DELETE FROM invitations WHERE expires_at < NOW() |
| `cleanup.orphan_s3` | Scheduled: weekly Sunday 03:00 UTC | LOW | 1x (600s) | Find S3 keys not in project_files, delete if >24h old |
| `cleanup.archive_projects` | Scheduled: daily 04:00 UTC | LOW | 1x (300s) | Projects inactive >90 days → cold S3 archival |
| `cleanup.expired_tokens` | Scheduled: hourly | LOW | 1x (60s) | DELETE FROM refresh_tokens WHERE expires_at < NOW() |

### Usage Tasks (Queue: `usage`)

| Task Name | Trigger | Priority | Retry | Description |
| :--- | :--- | :--- | :--- | :--- |
| `usage.aggregate_daily` | Scheduled: daily midnight UTC | MEDIUM | 3x (60s, 120s, 240s) | Roll up usage_daily counters into monthly aggregates |
| `usage.sync_stripe_usage` | Scheduled: hourly | MEDIUM | 3x (60s, 120s, 240s) | Report metered usage to Stripe for overage billing |

### Global Retry & DLQ Policy

```
Retry: 3 attempts with exponential backoff (60s, 120s, 240s)
DLQ:   Failed tasks after max_retries → Redis list "dlq:{task_name}"
       → Alert to PagerDuty (critical tasks: ai.*, email.send_verification)
       → Alert to Slack (all others)
       → Admin Dashboard: /admin/queues shows DLQ item count + manual retry/dismiss
Crash Recovery: task_acks_late=True → re-queue on worker crash
```
