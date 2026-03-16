# 📨 Kafka Event Payload Contracts — AI-Native IDE Platform

> **Purpose:** Strict, machine-readable payload schemas for EVERY Kafka topic.  
> **Rule:** Producers MUST publish, and consumers MUST validate, against EXACTLY these schemas.  
> **Source of Truth:** `@workspace/shared-types/src/kafka-events/` mirrors these interfaces.  
> **Serialization:** JSON. Partition keys specified per topic. All UUIDs are v4 strings.

---

## Common Envelope (ALL events wrap in this)

```typescript
interface KafkaEventEnvelope<T> {
  event_id: string;         // UUID v4 — unique per event, idempotency key
  event_type: string;       // Matches topic name, e.g. "project.created"
  timestamp: string;        // ISO 8601 UTC, e.g. "2026-03-12T04:00:00Z"
  source_service: string;   // Publisher service name
  trace_id: string;         // X-Trace-Id from original HTTP request (or generated)
  payload: T;               // The actual event data — typed per topic
}
```

---

## 1A. User & Auth Events

### `user.created`
```typescript
interface UserCreatedPayload {
  user_id: string;          // UUID — PARTITION KEY
  email: string;
  username: string;
  full_name: string | null;
  auth_provider: "email" | "github" | "google";
  created_at: string;       // ISO 8601
}
```

### `user.invited`
```typescript
interface UserInvitedPayload {
  invitation_id: string;    // UUID
  invitee_email: string;    // PARTITION KEY
  inviter_user_id: string;  // UUID
  project_id: string;       // UUID
  role: "editor" | "viewer";
  expires_at: string;       // ISO 8601
}
```

### `user.sessions_revoked`
```typescript
interface UserSessionsRevokedPayload {
  user_id: string;          // UUID — PARTITION KEY
  reason: "password_change" | "mfa_reset" | "admin_force_logout" | "account_compromised";
  revoked_at: string;       // ISO 8601
}
```

### `auth.email_action`
```typescript
interface AuthEmailActionPayload {
  user_id: string;          // UUID — PARTITION KEY
  email: string;
  action: "verify_email" | "password_reset" | "mfa_setup";
  token: string;            // Short-lived OTP or magic link token
  expires_at: string;       // ISO 8601
}
```

---

## 1B. Project & File Events

### `project.created`
```typescript
interface ProjectCreatedPayload {
  project_id: string;       // UUID — PARTITION KEY
  owner_id: string;         // UUID
  org_id: string | null;    // UUID
  name: string;
  slug: string;
  template: string;         // "nextjs" | "fastapi" | "blank" | ...
  language: string | null;
  visibility: "private" | "public" | "org";
  status: "pending";        // Always "pending" at creation
  created_at: string;       // ISO 8601
}
```

### `project.deleted`
```typescript
interface ProjectDeletedPayload {
  project_id: string;       // UUID — PARTITION KEY
  owner_id: string;         // UUID
  org_id: string | null;
  s3_prefix: string;        // e.g. "projects/{project_id}/" — for S3 cleanup
  deleted_at: string;       // ISO 8601
}
```

### `project.allocation.failed`
```typescript
interface ProjectAllocationFailedPayload {
  project_id: string;       // UUID — PARTITION KEY
  error_code: string;       // e.g. "VM_POOL_EXHAUSTED", "REGION_CAPACITY_FULL"
  error_message: string;
  attempted_region: string;
  failed_at: string;        // ISO 8601
}
```

### `file.modified`
```typescript
interface FileModifiedPayload {
  file_id: string;          // UUID
  project_id: string;       // UUID — PARTITION KEY
  path: string;             // e.g. "src/app/page.tsx"
  name: string;
  language: string | null;
  size_bytes: number;
  content_hash: string;     // SHA-256 of new content
  sequence_number: number;  // Monotonic version counter to reject stale out-of-order events
  modifier_user_id: string; // UUID
  modified_at: string;      // ISO 8601
}
```

### `file.deleted`
```typescript
interface FileDeletedPayload {
  file_id: string;          // UUID
  project_id: string;       // UUID — PARTITION KEY
  path: string;
  s3_key: string | null;    // If file was on S3, include key for deletion
  deleted_by: string;       // UUID
  deleted_at: string;       // ISO 8601
}
```

### `invitation.created`
```typescript
interface InvitationCreatedPayload {
  invitation_id: string;    // UUID
  invitee_email: string;    // PARTITION KEY
  inviter_user_id: string;  // UUID
  inviter_name: string;
  project_id: string;       // UUID
  project_name: string;
  role: "editor" | "viewer";
  token: string;            // Invitation acceptance token
  expires_at: string;       // ISO 8601
}
```

---

## 1C. AI Events

### `ai.task.completed`
```typescript
interface AITaskCompletedPayload {
  conversation_id: string;  // UUID — PARTITION KEY
  project_id: string;       // UUID
  user_id: string;          // UUID
  status: "completed" | "partial";
  agents_completed: string[];  // e.g. ["pm", "architect", "backend", "frontend"]
  agents_failed: string[];     // e.g. ["devops"]
  total_tokens: number;
  total_cost_usd: number;
  duration_ms: number;
  completed_at: string;     // ISO 8601
}
```

### `ai.task.failed`
```typescript
interface AITaskFailedPayload {
  conversation_id: string;  // UUID — PARTITION KEY
  project_id: string;       // UUID
  user_id: string;          // UUID
  error_code: string;       // e.g. "MAX_RETRIES_EXCEEDED", "ALL_PROVIDERS_DOWN"
  error_message: string;
  last_completed_agent: string | null;
  failed_at: string;        // ISO 8601
}
```

### `notification.alert`
```typescript
interface NotificationAlertPayload {
  user_id: string;          // UUID — PARTITION KEY
  type: "info" | "success" | "warning" | "error" | "ai_complete";
  title: string;
  message: string;
  action_url: string | null;  // Deep link, e.g. "/projects/{id}/deployments"
  metadata: Record<string, unknown> | null;
}
```

---

## 1D. Billing & Usage Events

### `billing.invoice.paid`
```typescript
interface BillingInvoicePaidPayload {
  user_id: string;          // UUID — PARTITION KEY
  subscription_id: string;  // UUID
  stripe_invoice_id: string;
  plan: "free" | "pro" | "team" | "enterprise";
  amount_cents: number;
  currency: string;         // "usd"
  period_start: string;     // ISO 8601
  period_end: string;       // ISO 8601
  paid_at: string;          // ISO 8601
}
```

### `subscription.updated`
```typescript
interface SubscriptionUpdatedPayload {
  user_id: string;          // UUID — PARTITION KEY
  subscription_id: string;  // UUID
  previous_plan: "free" | "pro" | "team" | "enterprise";
  new_plan: "free" | "pro" | "team" | "enterprise";
  action: "upgrade" | "downgrade" | "cancel" | "reactivate";
  effective_at: string;     // ISO 8601
}
```

### `usage.limit_reached`
```typescript
interface UsageLimitReachedPayload {
  user_id: string;          // UUID — PARTITION KEY
  resource: "ai_requests" | "compute_seconds" | "storage_bytes" | "api_calls";
  current_usage: number;
  plan_limit: number;
  percentage: number;       // 80 or 100
  plan: "free" | "pro" | "team" | "enterprise";
  period: string;           // "2026-03" (monthly)
}
```

---

## 1E. Deployment Events

### `deployment.completed`
```typescript
interface DeploymentCompletedPayload {
  deployment_id: string;    // UUID
  project_id: string;       // UUID — PARTITION KEY
  user_id: string;          // UUID
  provider: "vercel" | "railway" | "aws" | "gcp" | "azure";
  environment: "preview" | "staging" | "production";
  url: string;              // Live deployment URL
  build_duration_ms: number;
  completed_at: string;     // ISO 8601
}
```

### `deployment.failed`
```typescript
interface DeploymentFailedPayload {
  deployment_id: string;    // UUID
  project_id: string;       // UUID — PARTITION KEY
  user_id: string;          // UUID
  provider: "vercel" | "railway" | "aws" | "gcp" | "azure";
  environment: "preview" | "staging" | "production";
  error_code: string;       // e.g. "BUILD_FAILED", "DEPLOY_TIMEOUT"
  error_message: string;
  build_log_s3_key: string; // S3 key for full build log
  failed_at: string;        // ISO 8601
}
```

---

## 1F. VM & Infrastructure Events

> **NOTE:** The `file.deleted` event is defined in §1B above (published by `project-service`).
> It is NOT duplicated here. All file lifecycle events live under §1B.

### `vm.idle`
```typescript
// Publisher: execution-service | Partition key: project_id
// Consumers: background-worker (triggers VM hibernation)
interface VmIdlePayload {
  vm_id: string;
  project_id: string;       // UUID — PARTITION KEY
  idle_duration_seconds: number;
  last_activity_at: string;  // ISO 8601
}
```

### `usage.exceeded`
```typescript
// Publisher: billing-service | Partition key: user_id
// Consumers: notification-service (sends alert), api-gateway (enforces block)
interface UsageExceededPayload {
  user_id: string;           // UUID — PARTITION KEY
  org_id: string | null;
  metric: "ai_tokens" | "compute_minutes" | "storage_gb" | "deployments";
  current_usage: number;
  limit: number;
  period_start: string;      // ISO 8601
  period_end: string;        // ISO 8601
}
```

> **Reminder:** ALL events above are wrapped in the `KafkaEventEnvelope<T>` defined at the top of this document. Do NOT use inline envelope fields (e.g., `publisher`, `subscribers`) — use the standard wrapper.

---

## Consumer Implementation Rules

1. **Validate on consume:** Every consumer MUST validate the incoming payload against the interface above using Zod (TypeScript) or Pydantic (Python).
2. **Ignore unknown fields:** Consumers should use `.passthrough()` / `model_config = ConfigDict(extra='allow')` so new fields added by producers don't crash old consumers.
3. **Idempotency (EXACTLY-ONCE Defense):** Consumers MUST NEVER set a Redis processed flag *before* processing (which causes permanent data loss on crash). The consumer MUST process the event, and ONLY upon fully successful DB commit, write `SET event_processed:{event_id} 1 EX 86400`. During processing, it must acquire a transient lock if parallel consumption is possible.
4. **Out-of-Order Rejection:** Consumers (like Search Indexer or DB Sync) MUST check `sequence_number` against their stored state and drop the event if `incoming.sequence_number < current.sequence_number`.
5. **Dead Letter Queue:** On 3 consecutive failures → ACK from main topic → publish to `{topic_name}.DLQ`.
