# AI-Native IDE Platform — Project Context

> **Generated:** March 16, 2026
> **Purpose:** Comprehensive context for AI assistants working on this codebase

---

## 1. Project Overview

**AI-Native Cloud IDE Platform** — A next-generation development environment that enables developers to build production-grade applications through natural language prompts, guided by enterprise-level engineering processes.

### Core Differentiators
- **Multi-Agent AI Orchestration:** PM, Architect, Backend, Frontend, DevOps, QA, and Security agents working in parallel via LangGraph
- **Hybrid Execution:** Browser-based WebContainers (free tier) + Firecracker microVMs (Pro tier)
- **Real-Time Collaboration:** CRDT-based (Yjs) live collaboration with conflict-free editing
- **Enterprise Process Enforcement:** Automated Google/Stripe-level development standards

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend (IDE)** | React + Vite + TypeScript + Monaco Editor |
| **Frontend (Marketing/Admin)** | Next.js 15 (App Router) |
| **Backend Services** | Node.js + Fastify + TypeScript (14 microservices) |
| **AI Agents** | Python + LangGraph + FastAPI |
| **Database** | PostgreSQL 16 + Prisma ORM + pgvector |
| **Cache/Queue** | Redis 7 (Cluster) + BullMQ |
| **Message Queue** | Apache Kafka (event-driven architecture) |
| **Object Storage** | S3 / MinIO |
| **Search** | Elasticsearch 8 |
| **VM Runtime** | Firecracker microVMs |
| **Monorepo** | Turborepo + pnpm workspaces |
| **Auth** | Keycloak (OAuth2/OIDC) |
| **Secrets** | HashiCorp Vault |

---

## 2. Repository Structure

```
AI-Native-IDE/
├── platform/                    # Main monorepo root
│   ├── apps/                    # Client-facing applications
│   │   ├── ide/                 # Core IDE (React + Vite + Monaco)
│   │   ├── marketing-site/      # Landing page (Next.js)
│   │   └── admin/               # Admin dashboard (Next.js)
│   │
│   ├── services/                # Backend microservices (TypeScript)
│   │   ├── api-gateway/         # Kong + Fastify routing
│   │   ├── auth-service/        # Keycloak wrapper
│   │   ├── project-service/     # Project CRUD, Git ops
│   │   ├── ai-service/          # LangGraph orchestrator (TS wrapper)
│   │   ├── execution-service/   # Firecracker VM management
│   │   ├── collab-service/      # Yjs WebSocket server
│   │   ├── billing-service/     # Stripe integration
│   │   ├── notification-service/# WebSocket + email push
│   │   ├── search-service/      # Elasticsearch
│   │   ├── storage-service/     # S3/MinIO proxy
│   │   ├── deployment-service/  # Vercel/Railway/AWS deploy
│   │   ├── analytics-service/   # Usage tracking
│   │   ├── websocket-gateway/   # Central WS multiplexer
│   │   └── background-worker/   # BullMQ async jobs
│   │
│   ├── ai-agents/               # Python LangGraph agents
│   │   ├── orchestrator/        # Task DAG & state graph
│   │   ├── agents/              # PM, Architect, Backend, Frontend, etc.
│   │   ├── tools/               # File writer, bash executor, linter
│   │   └── llm-router/          # Cost optimization (multi-provider)
│   │
│   ├── packages/                # Shared libraries
│   │   ├── database/            # Prisma schema + client
│   │   ├── shared-types/        # TypeScript interfaces + Zod schemas
│   │   ├── ui/                  # Shared UI components (shadcn/Radix)
│   │   ├── config/              # ESLint, Prettier, TSConfig presets
│   │   └── logger/              # Shared logging config
│   │
│   ├── infra/                   # Infrastructure as Code
│   │   ├── terraform/           # AWS/GCP provisioning
│   │   ├── k8s/                 # Kubernetes manifests + Helm charts
│   │   └── firecracker/         # VM runtime configs
│   │
│   ├── scripts/                 # CI/CD + Dev tooling
│   ├── docker-compose*.yml      # Local dev orchestration
│   ├── turbo.json               # Turborepo pipeline config
│   ├── pnpm-workspace.yaml      # Workspace definition
│   └── package.json             # Root package (scripts only)
│
├── AI_CONTEXT.md                # AI system context
├── AI_Native_IDE_System_Design.md  # Full system design (2284 lines)
├── ARCHITECTURE_STANDARDS.md    # Canonical architecture rules
├── DATABASE_MIGRATION_STRATEGY.md  # Migration patterns
├── KAFKA_EVENT_CONTRACTS.md     # Event payload schemas
├── SYSTEM_BACKBONE_ARCHITECTURE.md # SAGA, idempotency, DLQ patterns
├── monorepo_architecture.md     # Monorepo structure guide
├── developer_guidelines.md      # Priority action items
└── Interactive_Schema_Design_ERD.md  # Database ERD
```

---

## 3. Building and Running

### Prerequisites
- Node.js >= 20.0.0
- pnpm >= 8.15.0
- Docker + Docker Compose
- Python 3.11+ (for ai-agents)

### Local Development

```bash
# Install dependencies
pnpm install

# Start all infrastructure (PostgreSQL, Redis, Kafka, MinIO, Keycloak)
pnpm docker:dev

# Initialize database schema
pnpm docker:db-init

# Start all services in dev mode
pnpm dev

# Run type checking across all packages
pnpm typecheck

# Run linter across all packages
pnpm lint

# Run tests across all packages
pnpm test
```

### Service-Specific Commands

```bash
# Database operations (in platform/packages/database)
pnpm --filter @workspace/database db:generate   # Generate Prisma client
pnpm --filter @workspace/database db:push       # Push schema to DB (dev)
pnpm --filter @workspace/database db:migrate    # Run migrations
pnpm --filter @workspace/database db:studio     # Open Prisma Studio

# Build specific service
pnpm --filter ide-client build
pnpm --filter project-service build

# Run specific service in dev mode
pnpm --filter ide-client dev
pnpm --filter project-service dev
```

### Docker Deployment

```bash
# Build all Docker images
pnpm docker:build

# Start production containers
docker-compose up -d

# Stop all containers
docker-compose down
```

---

## 4. Development Conventions

### Coding Style

| File Type | Naming Convention |
|-----------|-------------------|
| TypeScript (.ts) | `snake_case.ts` (e.g., `auth_controller.ts`) |
| Python (.py) | `snake_case.py` (e.g., `task_planner.py`) |
| React (.tsx) | `PascalCase.tsx` (e.g., `MonacoWrapper.tsx`) |
| Database tables | `snake_case`, plural (e.g., `users`, `project_files`) |
| Kafka topics | `{domain}.{entity}.{action}` (e.g., `project.created`) |

### API Design

- **Versioning:** URL-based (`/api/v1/projects`)
- **Response Envelope:**
  ```json
  {
    "success": true,
    "data": { ... },
    "error": null,
    "trace_id": "req-uuid"
  }
  ```
- **Pagination:** Cursor-based (`?cursor=abc&limit=20`)
- **Error Codes:** `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `RATE_LIMITED`, etc.

### Database Patterns

- **Soft Deletes:** Use `deletedAt` timestamp or `status` enum (never hard delete)
- **File Storage:** Dual storage strategy
  - Files ≤ 64KB → `inline_content` (PostgreSQL BYTEA)
  - Files > 64KB → S3 with `s3_key` reference
- **Indexes:** Composite indexes for common query patterns
- **Migrations:** Expand-contract pattern for zero-downtime changes

### Inter-Service Communication

| Pattern | Technology | Use Case |
|---------|------------|----------|
| Sync (request-reply) | HTTP REST via API Gateway | Frontend → Backend |
| Async (fire-and-forget) | Kafka events | State changes, audit logs |
| Real-time (push) | WebSocket via WS Gateway | Collaboration, terminal, AI streaming |
| Ephemeral | Redis Pub/Sub | Cursor positions, typing indicators |

### Kafka Event Envelope

All Kafka messages MUST use this envelope:

```typescript
interface KafkaEventEnvelope<T> {
  event_id: string;         // UUID v4
  event_type: string;       // e.g. "project.created"
  timestamp: string;        // ISO 8601 UTC
  source_service: string;   // e.g. "project-service"
  trace_id: string;         // OpenTelemetry trace ID
  version: '1.0';           // Schema version
  payload: T;               // Typed payload
}
```

### SAGA Pattern (Distributed Rollbacks)

For operations spanning multiple services:
1. Execute step, publish success event
2. On failure, publish compensating event
3. Original service listens and rolls back

Example: Project creation failure triggers `project.allocation.failed` → `project-service` deletes pending project.

### Idempotency

All destructive/expensive POST/PUT/DELETE operations require `Idempotency-Key` header:
1. Extract key, check Redis `SETNX`
2. If exists → return cached response or `409 Conflict`
3. If unique → process, cache result in Redis

---

## 5. Key Architecture Decisions

### Hybrid Execution Model
- **Tier 1 (Browser):** WebContainers/WASM for standard web projects (free tier)
- **Tier 2 (Cloud):** Firecracker microVMs for heavy compute, non-JS languages (Pro tier)

### AI Cost Optimization
- **LLM Routing:** Tier 1 (Claude/GPT-4) for reasoning, Tier 2 (Haiku/Flash) for code generation
- **Prompt Caching:** System context cached to reduce input token cost
- **Token Budgets:** Hard cap of 500k tokens per generation run

### File Storage Consistency
- **S3 First:** Upload to S3 → Update PostgreSQL metadata
- **Orphan Cleanup:** Weekly background job removes unreferenced S3 objects

### Background Jobs (BullMQ)

| Queue | Concurrency | Purpose |
|-------|-------------|---------|
| `ai` | 2 | AI generation orchestration |
| `email` | 10 | Transactional emails |
| `cleanup` | 5 | Garbage collection, VM cleanup |
| `embedding` | 3 | Code embedding generation |
| `usage` | 2 | Usage aggregation |
| `notification` | 5 | Push notifications |

---

## 6. Document Hierarchy

When documents conflict, resolve using this priority:

1. `ARCHITECTURE_STANDARDS.md` ← **Canonical reference**
2. `packages/database/prisma/schema.prisma` ← Database source of truth
3. `KAFKA_EVENT_CONTRACTS.md` ← Event payload source of truth
4. `platform/docs/API_DESIGN.md` ← API endpoint source of truth
5. `AI_Native_IDE_System_Design.md` ← High-level architecture
6. `SYSTEM_BACKBONE_ARCHITECTURE.md` ← Event-driven patterns
7. Per-service `PRD.md` / `DEVELOPMENT_LOGIC.md` ← Implementation details

---

## 7. Important Directories

| Directory | Purpose |
|-----------|---------|
| `platform/packages/database/prisma/` | Single source of truth for database schema (24 tables) |
| `platform/packages/shared-types/` | Shared TypeScript interfaces + Zod schemas |
| `platform/services/api-gateway/src/proxy/` | Circuit breaker, rate limiting, auth middleware |
| `platform/ai-agents/src/orchestrator/` | LangGraph state graph + task DAG definitions |
| `platform/apps/ide/src/webcontainers/` | Browser-based execution logic (Tier 1) |
| `platform/services/execution-service/src/vm-pool/` | Firecracker VM pool manager (Tier 2) |
| `platform/infra/k8s/` | Kubernetes manifests + Helm charts |

---

## 8. Current Development Status

### Priority 1 (Critical)
- ✅ Database soft deletes — Implemented via `status` enum + `deletedAt`
- ✅ File storage strategy — Documented, schema ready
- 🟡 Circuit breaker — Gateway has it, individual services need implementation
- ⬜ Disaster recovery — Not started

### Priority 2 (High)
- ⬜ AI provider fallback — Not started
- ✅ Composite indexes — Added to schema
- ✅ API versioning — Documented, gateway uses URL-based
- ⬜ Frontend bundle optimization — Not started

### Priority 3 (Medium)
- ⬜ OpenAPI documentation — Not started
- ⬜ PWA offline support — Not started
- ⬜ Spot instances for batch jobs — Not started
- ⬜ Cursor pagination — Not started

---

## 9. Testing Practices

- **Unit Tests:** Vitest for TypeScript, pytest for Python
- **Integration Tests:** Docker Compose with test database
- **E2E Tests:** Playwright for IDE frontend
- **Contract Tests:** Validate Kafka payloads against `KAFKA_EVENT_CONTRACTS.md`

---

## 10. Quick Reference

### Common Query Patterns

```typescript
// Cursor-based pagination
const projects = await prisma.project.findMany({
  where: { ownerId: userId, status: 'active' },
  take: limit + 1,
  cursor: cursor ? { id: cursor } : undefined,
  orderBy: { createdAt: 'desc' }
});

// Soft delete filter
const projects = await prisma.project.findMany({
  where: { deletedAt: null }
});

// File storage threshold
const storageStrategy = fileSize <= 64 * 1024 
  ? 'inline'  // PostgreSQL BYTEA
  : 's3';     // S3 with s3_key reference
```

### Kafka Event Publishing

```typescript
// TypeScript service
await kafka.producer.send({
  topic: 'project.created',
  messages: [{
    key: project.id,
    value: JSON.stringify({
      event_id: crypto.randomUUID(),
      event_type: 'project.created',
      timestamp: new Date().toISOString(),
      source_service: 'project-service',
      trace_id: req.headers['x-trace-id'],
      payload: { project_id: project.id, ... }
    })
  }]
});
```

### BullMQ Job Dispatch

```typescript
// Queue a background job
await bullmqClient.add('ai', 'generate-project', {
  conversation_id: id,
  user_id: userId,
  prompt: userPrompt
}, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60000 }
});
```

---

*This document is auto-generated from the codebase. For authoritative references, see the source documents listed in §6.*
