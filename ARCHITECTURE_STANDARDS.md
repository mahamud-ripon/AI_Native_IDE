# 📐 Architecture Standards — Single Source of Truth

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Status:** APPROVED — All documents MUST conform to these standards.  
> **Rule:** If any other document conflicts with this file, **THIS FILE WINS**.

---

## 1. Technology Stack (Final Decision)

### 1.1 Core Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend (IDE)** | React + Vite + TypeScript | Desktop-like client runtime; no SSR needed for IDE |
| **Frontend (Marketing)** | Next.js 15 (App Router) | SEO, SSR, static generation for landing pages |
| **Frontend (Admin)** | Next.js 15 (App Router) | Dashboard with SSR for initial load |
| **Backend Services** | Node.js + Fastify + TypeScript | Monorepo shared types, Prisma compatibility, unified language |
| **AI Agents** | Python + LangGraph + FastAPI | LangChain/LangGraph ecosystem is Python-native |
| **Database** | Neon.tech (PostgreSQL 16) + Prisma ORM | Type-safe queries, migration tooling, serverless |
| **Cache** | Upstash Redis (serverless) | Caching, rate limiting, pub/sub, sessions |
| **Message Queue** | Redpanda Cloud (Kafka-compatible) | Event-driven inter-service communication |
| **Object Storage** | S3 / MinIO (local dev) | File content, snapshots, build logs |
| **Search** | Elasticsearch 8 | Full-text code search, project discovery |
| **Vector DB** | pgvector (PostgreSQL extension) | Code embeddings for RAG pipeline |
| **API Gateway** | Custom Fastify Gateway | Rate limiting, circuit breaker, auth, proxy |
| **Auth Provider** | Custom Auth Service (JWT) | GitHub/Google OAuth2, enterprise SAML (future) |
| **Secret Management** | HashiCorp Vault | Env vars, API keys, DB credentials |
| **VM Runtime** | Firecracker microVMs | Secure code execution sandboxes |
| **Monorepo Tooling** | Turborepo + pnpm | Build caching, workspace dependency resolution |

### 1.2 IDE Runtime Boundaries (Non-Negotiable)

- **COOP/COEP enforcement:** Production cross-origin isolation headers MUST be enforced at the **edge/CDN** layer for `ide.platform.io`.
- **Secrets:** Secrets are never handled by the IDE frontend framework. Flow MUST be: `IDE SPA → API Gateway → secrets-service → Vault`.
- **IDE hosting topology:** The IDE runs on `ide.platform.io`.
- **Preview isolation:** Preview runs on an isolated preview subdomain (e.g. `*.preview.platform.io`) and MUST use strict iframe sandboxing.

### 1.3 Language Decision Matrix

| Service | Language | Why |
|---------|----------|-----|
| auth-service | TypeScript (Node.js) | Shared types with frontend |
| project-service | TypeScript (Node.js) | Prisma ORM, shared types |
| ai-service | TypeScript (Node.js) | Orchestration endpoint, delegates to Python agents |
| execution-service | TypeScript (Node.js) | VM pool management, WebSocket terminal |
| billing-service | TypeScript (Node.js) | Stripe SDK (JS-native), shared types |
| collab-service | TypeScript (Node.js) | Yjs is JavaScript-native |
| notification-service | TypeScript (Node.js) | Simple CRUD + WebSocket push |
| search-service | TypeScript (Node.js) | Elasticsearch JS client |
| storage-service | TypeScript (Node.js) | AWS SDK (JS-native) |
| deployment-service | TypeScript (Node.js) | Vercel/Railway APIs (JS SDKs) |
| analytics-service | TypeScript (Node.js) | Shared Prisma schema |
| websocket-gateway | TypeScript (Node.js) | ws library, channel routing |
| background-worker | TypeScript (Node.js) | BullMQ (Redis-based job queue) |
| api-gateway | TypeScript (Node.js) | Fastify proxy, middleware |
| **ai-agents (LangGraph)** | **Python** | LangChain/LangGraph is Python-only |

> **Rule:** All backend microservices use **TypeScript + Node.js + Fastify**.  
> **Exception:** The `ai-agents/` module uses **Python + FastAPI** because LangGraph is Python-native.  
> The `ai-service` (TypeScript) calls `ai-agents` (Python) via HTTP/gRPC internally.

---

## 2. API Versioning Strategy

### Decision: **URL-Based Versioning**

```
✅ CORRECT:  /api/v1/projects
✅ CORRECT:  /api/v2/projects
❌ WRONG:    Header: X-API-Version: 1.0
```

### Rules:
1. All API routes MUST be prefixed with `/api/v1/`
2. Major breaking changes create a new version (`/api/v2/`)
3. Minor additions (new optional fields) do NOT require a new version
4. Deprecation policy: **12 months** after new version release
5. Sunset header: `Sunset: Sat, 01 Mar 2028 00:00:00 GMT`

### Rationale:
- Debugging friendly (URL visible in logs, browser, curl)
- CDN/cache friendly (different URL = different cache key)
- Industry standard (Stripe, GitHub, Twilio all use URL versioning)

---

## 3. Error Response Format

### Decision: **Custom Envelope (NOT RFC 7807)**

All API responses follow this envelope:

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "trace_id": "req-uuid-here"
}
```

### Error Response
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Project name is required",
    "details": {
      "field": "name",
      "rule": "required"
    }
  },
  "trace_id": "req-uuid-here"
}
```

### Standard Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body/params |
| `UNAUTHORIZED` | 401 | Missing or invalid JWT |
| `FORBIDDEN` | 403 | Insufficient permissions (RBAC) |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Duplicate resource (e.g., slug exists) |
| `RATE_LIMITED` | 429 | Too many requests |
| `QUOTA_EXCEEDED` | 429 | Plan limit reached (AI calls, storage) |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `SERVICE_UNAVAILABLE` | 503 | Downstream service is down |
| `AI_PROVIDER_ERROR` | 502 | All LLM providers failed |

### HTTP Status Codes Used

```
200 — OK (GET, PATCH, DELETE success)
201 — Created (POST success)
202 — Accepted (async job started)
400 — Bad Request
401 — Unauthorized
403 — Forbidden
404 — Not Found
409 — Conflict
422 — Unprocessable Entity
429 — Too Many Requests / Quota Exceeded
500 — Internal Server Error
503 — Service Unavailable
```

### Rationale:
- Consistent `success` boolean makes frontend parsing trivial
- `trace_id` enables distributed tracing (OpenTelemetry correlation)
- `error.code` is machine-readable (for i18n and programmatic handling)
- `error.details` provides field-level validation feedback
- RFC 7807 is powerful but overkill for our use case — our envelope is simpler and frontend-friendly

---

## 4. Pagination Strategy

### Decision: **Cursor-Based Pagination**

```
✅ CORRECT:  GET /api/v1/projects?cursor=abc123&limit=20
❌ WRONG:    GET /api/v1/projects?page=2&limit=20
```

### Standard Query Parameters

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `cursor` | string (optional) | null | — | Opaque cursor from previous response |
| `limit` | integer | 20 | 100 | Items per page |
| `sort` | string | `created_at` | — | Sort field |
| `order` | `asc` \| `desc` | `desc` | — | Sort direction |

### Standard Paginated Response

```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "next_cursor": "eyJpZCI6IjEyMy...",
      "has_more": true,
      "total_count": 150
    }
  }
}
```

### Rules:
1. `cursor` is a Base64-encoded composite key (typically `id` + `created_at`)
2. `total_count` is optional — include it only when the query is cheap (< 10K rows)
3. **Never use offset pagination** — it degrades at scale and causes inconsistency with concurrent inserts
4. All list endpoints MUST support cursor pagination
5. Default `limit` is 20. Frontend can request up to 100.

### Rationale:
- Consistent performance regardless of position (no `OFFSET N` penalty)
- Safe with real-time inserts/deletes (no missing or duplicate items)
- Industry standard for real-time systems (Twitter, Slack, Discord)

---

## 5. Project Lifecycle (SAGA Pattern)

### Status Enum

```
pending → active → archived → deleted
                 ↘ failed_creation
```

### State Transitions

| From | To | Trigger | Compensating Action |
|------|----|---------|---------------------|
| — | `pending` | User creates project | — |
| `pending` | `active` | All provisioning steps complete | — |
| `pending` | `failed_creation` | Any provisioning step fails | Rollback: delete repo, release VM, delete S3 files |
| `active` | `archived` | User archives project | Hibernate VM, disable API access |
| `archived` | `active` | User restores project | Restore VM snapshot |
| `archived` | `deleted` | User permanently deletes (or auto-delete after 90 days) | Purge all data, S3 files, embeddings |
| `active` | `deleted` | Admin force-delete | Purge all data |

### SAGA Choreography for Project Creation

```
1. project-service:  CREATE project (status = 'pending')
                     → Kafka: project.created

2. execution-service: ALLOCATE VM from pool
                      → Kafka: project.vm.allocated  OR  project.allocation.failed

3. storage-service:   CREATE S3 bucket prefix
                      → Kafka: project.storage.ready  OR  project.storage.failed

4. project-service:   LISTEN for all success events
                      → UPDATE project (status = 'active')
                      → Kafka: project.ready

   ON FAILURE:        → UPDATE project (status = 'failed_creation')
                      → Kafka: project.creation.rollback
                      → Each service cleans up its own resources
```

---

## 6. Inter-Service Communication

### Rules

| Communication Type | Technology | Use Case |
|-------------------|------------|----------|
| **Sync (request-reply)** | HTTP REST (via API gateway) | Frontend → Backend, Admin actions |
| **Async (fire-and-forget)** | Kafka events | State changes, audit logs, billing events |
| **Real-time (push)** | WebSocket (via WS gateway) | Collaboration, terminal, AI streaming |
| **Ephemeral (short-lived)** | Redis Pub/Sub | Cursor positions, typing indicators |

### Kafka Event Envelope (Standard)

Every Kafka message MUST use this envelope:

```typescript
interface KafkaEventEnvelope<T> {
  event_id: string;        // UUID v4
  event_type: string;      // e.g. 'project.created'
  timestamp: string;       // ISO 8601
  source_service: string;  // e.g. 'project-service'
  trace_id: string;        // OpenTelemetry trace ID
  version: '1.0';          // Schema version
  payload: T;              // Typed payload
}
```

### Consumer Rules
1. **Validate** every message with Zod before processing
2. **Idempotency**: Check `event_id` in Redis SET before processing
3. **DLQ**: After 3 retries with exponential backoff → send to Dead Letter Queue
4. **Ordering**: Partition by `resource_id` (e.g., `project_id`) for guaranteed order per entity

---

## 7. File Storage Strategy

### Decision: **Dual Storage (Inline + S3)**

| File Size | Strategy | Field |
|-----------|----------|-------|
| ≤ 64 KB | Store inline in PostgreSQL (`inline_content` BYTEA) | `project_files.inline_content` |
| > 64 KB | Store in S3, reference by key | `project_files.s3_key` |

### Rationale:
- Most code files are < 64KB (typical `.ts`, `.py`, `.css` files)
- Inline storage avoids S3 round-trip latency for small reads (~30ms saving)
- S3 is used for large files (images, binaries, node_modules snapshots)
- The `content_hash` (SHA-256) field enables deduplication in both storage paths

### Consistency Strategy: **S3 First**
1. Write file content to S3 (or inline if < 64KB)
2. Update `project_files` metadata in PostgreSQL
3. On read failure: check S3 → rebuild metadata if needed

---

## 8. Authentication & Authorization

### JWT Configuration
- **Algorithm:** RS256 (asymmetric)
- **Access token TTL:** 15 minutes
- **Refresh token TTL:** 7 days (rolling)
- **Token rotation:** Issue new refresh token on every refresh call

### RBAC Hierarchy
```
Platform Level:  super_admin > admin > user
Org Level:       owner > admin > developer > viewer
Project Level:   owner > editor > viewer
```

### Auth Flow
1. Login → Custom Auth Service → JWT pair (access + refresh)
2. Every request → API Gateway validates JWT (RS256 signature + expiry)
3. Service-level middleware checks RBAC role for the resource

---

## 9. Background Job Processing

### Decision: **BullMQ (Node.js) with Redis**

> **NOTE:** The original design referenced Python Celery. Since all services are TypeScript/Node.js, we use **BullMQ** — the Node.js equivalent with the same Redis-backed queue architecture.

### Queue Configuration

| Queue Name | Concurrency | Purpose |
|------------|-------------|---------|
| `ai` | 2 workers | AI generation orchestration |
| `email` | 10 workers | Transactional emails |
| `cleanup` | 5 workers | Garbage collection, idle VM cleanup |
| `embedding` | 3 workers | Code embedding generation (CPU-heavy) |
| `usage` | 2 workers | Scheduled usage aggregation |
| `notification` | 5 workers | Push notifications via WebSocket |

### Retry Policy
- **Max retries:** 3
- **Backoff:** Exponential (60s, 120s, 240s)
- **DLQ:** Failed after max retries → Redis list `dlq:{queue}:{job_name}`
- **Alerting:** Critical failures → PagerDuty; Others → Slack

---

## 10. Naming Conventions

### API Routes
```
/api/v1/{resource}            — Collection (GET list, POST create)
/api/v1/{resource}/{id}       — Single item (GET, PATCH, DELETE)
/api/v1/{resource}/{id}/{sub} — Nested resource
```

### Kafka Topics
```
{domain}.{entity}.{action}
Examples:
  project.created
  project.vm.allocated
  ai.generation.completed
  billing.invoice.paid
```

### Database Tables
```
snake_case, plural
Examples: users, project_files, ai_conversations
```

### Code Files
```
TypeScript:  snake_case.ts  (e.g. auth_controller.ts, jwt_service.ts)
Python:      snake_case.py  (e.g. task_planner.py, pm_agent.py)
React:       PascalCase.tsx (e.g. MonacoWrapper.tsx, FileTree.tsx)
```

---

## 📋 Document Hierarchy

When documents conflict, resolve using this priority:

```
1. ARCHITECTURE_STANDARDS.md          ← THIS FILE (highest priority)
2. packages/database/prisma/schema.prisma  ← Database source of truth
3. KAFKA_EVENT_CONTRACTS.md           ← Event payload source of truth
4. platform/docs/API_DESIGN.md        ← API endpoint source of truth
5. AI_Native_IDE_System_Design.md     ← High-level architecture reference
6. SYSTEM_BACKBONE_ARCHITECTURE.md    ← Event-driven patterns reference
7. Per-service PRD.md                 ← Service-specific requirements
8. Per-service DEVELOPMENT_LOGIC.md   ← Implementation guidance
```

---

*This document is the canonical reference for all architectural decisions. All team members MUST read this before contributing code.*
