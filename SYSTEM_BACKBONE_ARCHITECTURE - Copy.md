# 🏛️ AI-Native IDE — Master System Backbone Architecture

> **Purpose:** This document defines the exact engineering contracts, fault-tolerance mechanisms, and distributed communication rules for the entire microservices cluster.
> **Target Audience:** Principal Engineers, Backend Developers, DevOps.
> **Law:** No microservice PR shall be merged if it violates these distributed transaction constraints.

---

## 🚀 1. Event-Driven Matrix (for development using Redpanda & Redis)
Microservices **MUST NEVER** call each other synchronously (via HTTP/REST) for mutating operations that take longer than 50ms. All state changes must be broadcasted asynchronously to prevent cascading timeouts.

### 🟡 Primary Event Broker: (Development only) Redpanda Cloud (Kafka-compatible, Persistent, Replayable)
Used for critical business logic where losing an event means data corruption.

> **Rule:** Every topic payload MUST conform to the schema in `KAFKA_EVENT_CONTRACTS.md`. No ad-hoc field names.  
> **Serialization:** JSON with `@workspace/shared-types` TypeScript interfaces. Future: Avro with Schema Registry.

#### 1A. User & Auth Events

| Topic Name | Publisher | Subscribers | Triggered When | Partition Key |
| :--- | :--- | :--- | :--- | :--- |
| `user.created` | `auth-service` | `billing-service`, `notification-service`, `analytics-service` | A new user completes registration and email verification. | `user_id` |
| `user.invited` | `project-service` | `notification-service` | A project owner invites a collaborator by email. | `invitee_email` |
| `user.sessions_revoked` | `auth-service` | `websocket-gateway` | Password change, MFA reset, or admin force-logout. | `user_id` |
| `auth.email_action` | `auth-service` | `notification-service` | Password reset request, email verification resend. | `user_id` |

#### 1B. Project & File Events

| Topic Name | Publisher | Subscribers | Triggered When | Partition Key |
| :--- | :--- | :--- | :--- | :--- |
| `project.created` | `project-service` | `execution-service`, `billing-service`, `search-service` | A new project row is committed (status: `pending`). | `project_id` |
| `project.deleted` | `project-service` | `execution-service`, `billing-service`, `search-service`, `storage-service` | User hard-deletes a project. VM wiped, S3 cleaned. | `project_id` |
| `project.allocation.failed` | `execution-service` | `project-service`, `notification-service` | Firecracker VM allocation fails (SAGA rollback trigger). | `project_id` |
| `file.modified` | `project-service` | `search-service`, `background-worker` (embedding) | A file is created or updated in PostgreSQL/S3. | `file_id` |
| `file.deleted` | `project-service` | `search-service`, `background-worker` (embedding) | A file is deleted from the project tree. | `file_id` |
| `invitation.created` | `project-service` | `notification-service` | An invitation record is inserted into PostgreSQL. | `invitee_email` |

#### 1C. AI Events

| Topic Name | Publisher | Subscribers | Triggered When | Partition Key |
| :--- | :--- | :--- | :--- | :--- |
| `ai.task.completed` | `ai-service` | `notification-service`, `project-service` | Multi-agent generation finishes (success or partial). | `conversation_id` |
| `ai.task.failed` | `ai-service` | `notification-service`, `billing-service` | All retry attempts exhausted — generation failed. Triggers SAGA token refund. | `conversation_id` |
| `notification.alert` | Any service | `notification-service` | Generic alert trigger (deploy done, usage warning, etc.). | `user_id` |

#### 1D. Billing & Usage Events

| Topic Name | Publisher | Subscribers | Triggered When | Partition Key |
| :--- | :--- | :--- | :--- | :--- |
| `billing.invoice.paid` | `billing-service` | `project-service`, `auth-service` | Stripe webhook confirms payment. Unlock features. | `user_id` |
| `subscription.updated` | `billing-service` | `project-service`, `analytics-service` | Plan upgrade/downgrade/cancel. Cache flush needed. | `user_id` |
| `usage.limit_reached` | `billing-service` | `notification-service` | User hits 80% or 100% of plan quota (AI/compute/storage). | `user_id` |

#### 1E. Deployment Events

| Topic Name | Publisher | Subscribers | Triggered When | Partition Key |
| :--- | :--- | :--- | :--- | :--- |
| `deployment.completed` | `deployment-service` | `notification-service` | Build succeeds — live URL available. | `project_id` |
| `deployment.failed` | `deployment-service` | `notification-service` | Build or deploy failed after retries. | `project_id` |

### 🔵 Ephemeral Event Broker: Redis Pub/Sub
Used for high-frequency, transient data where missing 1 tick is acceptable if the client reconnects.

| Channel Pattern | Publisher | Subscriber | Data Format | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `collab:{project_id}:{file_id}` | `collab-service` | `websocket-gateway` | Yjs binary (`Uint8Array`) | CRDT document sync between editors |
| `awareness:{project_id}:{file_id}` | `collab-service` | `websocket-gateway` | Yjs Awareness binary | Live cursor positions, user presence. **Requires 15s TTL and client heartbeat (ping) to prevent Ghost Cursors**. |
| `notifications:{user_id}` | `notification-service` | `websocket-gateway` | JSON | Push notifications to client |
| `deploy:{deployment_id}` | `deployment-service` | `websocket-gateway` | UTF-8 stream | Real-time build log streaming |
| `user_offline:{user_id}` | `websocket-gateway` | `collab-service`, `execution-service` | JSON | Trigger file save, VM hibernate prep |
| `vm.metrics:{vm_id}` | `execution-service` | `websocket-gateway` | JSON | CPU/RAM telemetry for IDE status bar |
| `ai.stream:{conversation_id}` | `ai-service` | `websocket-gateway` | JSON (SSE-like) | Agent-by-agent streaming progress |
| `preview.hmr:{project_id}` | `execution-service` | `websocket-gateway` | JSON | HMR reload events for live preview |

---

## 🛡️ 2. The SAGA Pattern (Distributed Rollbacks)
**The Problem:** Microservice A (Database) succeeds, but Microservice B (VM Allocation) fails. We cannot have "Ghost Projects" sitting in the database with no physical storage.

**The Elite Developer Rule (Choreography SAGA):**
If you write a feature that touches 2 or more services, you MUST implement a compensating (rollback) transaction.

**Example Flow: "Create New Project"**
1. **[SUCCESS]** `api-gateway` routes user request to `project-service`.
2. **[SUCCESS]** `project-service` creates a `projects` row in Postgres (Status: `PENDING`).
3. **[EVENT]** `project-service` publishes `project.created` to Kafka.
4. **[FAILED]** `execution-service` consumes the event, tries to allocate a Firecracker VM, but the AWS region is out of IP addresses. It crashes.
5. **[COMPENSATION]** `execution-service` catches the fatal error and publishes `project.allocation.failed` to Kafka.
6. **[ROLLBACK]** `project-service` listens for `project.allocation.failed`, finds the `projects` row, and forcefully deletes it (or marks it `FAILED_CREATION`).
7. **[ALERT]** `notification-service` listens and pushes a WebSocket event to the user: *"Cloud allocation failed. Please try again."*

**Example Flow: "AI Token Refund"**
1. **[DEDUCT]** User triggers prompt. `billing-service` deducts 5,000 tokens immediately.
2. **[FAILED]** LangGraph agents repeatedly timeout. `ai-service` publishes `ai.task.failed`.
3. **[COMPENSATION]** `billing-service` listens, matches the `conversation_id`, and refunds the exactly deducted 5,000 tokens to the user's limit cache and DB.

**Rule:** NEVER leave the database in a pending state without a 5-minute timeout cron job sweeping for orphaned records.

---

## 🔒 3. Idempotency (The "Double-Click" Defense)
**The Problem:** A user is lagging and double-clicks the `[Deploy App]` button. The API receives 2 identical POST requests 100ms apart. If left unchecked, the system will spin up 2 expensive Vercel deployments and charge the user twice.

**The Elite Developer Rule (Redis Locking):**
Every destructive or expensive `POST / PUT / DELETE` operation MUST require an `Idempotency-Key` in the HTTP Header (generated by the frontend UUID package).
Furthermore, all mutating WebSocket events (e.g., triggering AI generation) MUST include a `message_id` or `idempotency_key` in the JSON payload to prevent "Ghost Generations".

**Implementation (Middleware):**
1. Request arrives at `api-gateway`.
2. Extract the `Idempotency-Key` (e.g., `req-99ab-221z`).
3. Query Redis: `SETNX idempotency:req-99ab-221z "PROCESSING"` with a TTL of `24 hours`.
4. If Redis returns `0` (Key already exists!):
   - If value is `PROCESSING`: Return `HTTP 409 Conflict` (Duplicate request, dropping).
   - If value is a cached JSON response (from the first successful try): Read it and return `HTTP 200 OK` instantly, bypassing the microservice entirely.
5. If Redis returns `1` (Unique request!):
   - Forward request to the microservice.
   - Upon success, overwrite the Redis key with the final JSON response payload.

---

## ☠️ 4. Dead Letter Queue (DLQ) & Poison Pills
**The Problem:** A developer pushes a bug that causes the `email.send_invitation` worker to crash due to a missing comma in the JSON payload. Kafka will infinitely retry delivering this "Poison Pill", blocking millions of other emails behind it.

**The Elite Developer Rule:**
1. Every Kafka consumer MUST have a strict `max_retries = 3`.
2. Implement Exponential Backoff: `[Attempt 1: +5s] -> [Attempt 2: +30s] -> [Attempt 3: +2min]`.
3. If Attempt 3 fails, the system MUST catch the exception, ACKnowledge the message from the main Kafka topic (to unblock the line), and immediately publish the exact payload to a `.DLQ` (Dead Letter Queue) topic (e.g., `email.send_invitation.DLQ`).
4. Fire a high-severity alert to PagerDuty/Slack for the DevOps team.
5. The Admin Dashboard UI must have a screen to manually view `.DLQ` messages, fix the JSON typo, and click "Replay" to push them back into the main pipeline.
