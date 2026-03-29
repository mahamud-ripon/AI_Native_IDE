# AI-Native IDE - Agent Coding Guide

## Project Overview

Cloud-based, AI-native IDE (bolt.new/replit competitor). Users describe apps in natural language; a multi-agent AI system generates code.

**Stack:** pnpm + Turborepo monorepo. React/Vite + Next.js frontend. Fastify/Express microservices (TypeScript). Python LangGraph AI engine. PostgreSQL/Prisma. Redis. Kafka (Redpanda). S3/MinIO.

```
platform/
├── apps/
│   ├── ide/              # React+Vite IDE (port 5173) — core product
│   ├── admin/            # Next.js 15 admin panel (port 3000)
│   └── marketing-site/   # Next.js 15 stub (placeholder)
├── packages/
│   ├── config/           # @workspace/config — env validation, Kafka, constants
│   ├── database/         # @workspace/database — Prisma ORM, 40+ models
│   ├── shared-types/     # @workspace/shared-types — cross-boundary TS contracts
│   └── ui/               # @workspace/ui — shared React components
├── services/             # 14 microservices (see below)
│   ├── api-gateway/      # Port 8000 — single entry point, auth, rate limiting
│   ├── auth-service/     # Port 3100 — JWT RS256, refresh rotation, Argon2id
│   ├── project-service/  # Port 8002 — project CRUD, file tree, RBAC, Vault secrets
│   ├── ai-service/       # Port 8003 — LLM gateway (11 providers), agent orchestration
│   ├── execution-service/# Port 8004 — Firecracker microVMs, terminal PTY
│   ├── collab-service/   # Port 8005 — Yjs CRDT real-time editing
│   ├── billing-service/  # Port 8006 — Stripe, atomic Redis Lua metering
│   ├── notification-svc/ # Port 8007 — push (Redis), email (BullMQ+SES)
│   ├── search-service/   # Port 8008 — Elasticsearch full-text search
│   ├── storage-service/  # Port 8009 — S3/MinIO gateway, pre-signed URLs
│   ├── deployment-svc/   # Port 8010 — Vercel/Railway deploy, rollback
│   ├── analytics-service/# Port 8011 — admin metrics, feature flags
│   ├── websocket-gateway/# Port 8012 — real-time hub (collab/terminal/AI)
│   └── background-worker/# Headless — BullMQ queues, cron jobs, DLQ
└── ai-agents/            # Python LangGraph multi-agent engine (port 9000)
```

---

## Build/Lint/Test Commands

```bash
# Root (from platform/)
pnpm install / build / test / lint / lint:fix / typecheck / format / clean
pnpm db:generate / db:push / db:migrate
pnpm docker:build / docker:up / docker:dev

# Run single service test (Vitest)
cd platform/services/<service> && pnpm test -- --testPathPattern=<pattern>
pnpm test -- --testNamePattern="test name"

# Python AI agents (pytest)
cd platform/ai-agents
pytest tests/test_file.py        # specific file
pytest -k "test_name"            # pattern match
pytest --cov=src                 # coverage

# Dev mode
pnpm dev                                    # all services
cd platform/services/<service> && pnpm dev  # single service
cd platform/ai-agents && python -m uvicorn src.api.main:app --reload --port 9000
```

---

## Code Style

### TypeScript
- **Strict mode** enabled, ES2022 target, `bundler` module resolution
- No implicit `any` — use explicit types or `unknown`
- 2-space indent, single quotes, trailing commas, semicolons

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Components | PascalCase files | `UserProfile.tsx` |
| Utilities | kebab-case files | `format-date.ts` |
| Functions | camelCase | `getUserById()` |
| Classes/Interfaces | PascalCase | `UserService`, `ApiResponse` |
| Constants | UPPER_SNAKE | `MAX_RETRIES` |
| DB Tables | snake_case, plural | `project_files` |
| API Routes | `/api/v1/{resource}` | `/api/v1/projects/{id}` |

### Imports (group order)
1. External libraries (React, Fastify)
2. Internal packages (`@workspace/...`)
3. Relative imports (`./utils`, `../services/user`)

```typescript
import { useState } from 'react';
import { useAuthStore } from '@workspace/shared-types';
import { UserService } from '../services/user';
```

### React
- Functional components + hooks
- **Zustand** for state, **Tailwind CSS** with `clsx`/`tailwind-merge`
- **Radix UI** primitives for accessibility

### Error Handling

**Backend:**
```typescript
try { return await userService.getById(id); }
catch (error) {
  if (error instanceof NotFoundError) return reply.status(404).send({ error: 'Not found' });
  throw error;
}
```

**Frontend:**
```typescript
const [error, setError] = useState<Error | null>(null);
try { await fetchUser(id); }
catch (err) { setError(err instanceof Error ? err : new Error('Unknown error')); }
```

### API Response Envelope
```json
{ "success": true, "data": {...}, "error": null, "trace_id": "req-uuid" }
```

---

## Architecture

### Communication Patterns
- **Sync HTTP:** Frontend → API Gateway (port 8000) → Services (request-reply)
- **Async Kafka:** Inter-service state changes (20+ topics, SAGA choreography)
- **WebSocket:** Real-time push (terminal, collab, AI streaming, notifications)
- **Redis Pub/Sub:** Ephemeral data (cursor positions, typing indicators, VM metrics)

### Key Patterns
- **SAGA:** project.created → VM alloc → storage → activate (rollback on failure via `project.allocation.failed`)
- **Idempotency:** Redis SETNX 24h TTL, `Idempotency-Key` header required for destructive ops
- **DLQ:** 3 retries + exponential backoff → dead letter queue + PagerDuty alert
- **Circuit Breaker:** `opossum` library on all external calls (Stripe, Vault, S3, LLM providers)
- **Outbox Pattern:** Events written to `outbox_events` table in same DB transaction before Kafka publish

### AI Agent Pipeline (Python LangGraph)
```
precheck (Jailbreak) → PM Agent → Architect Agent
    → [parallel: Backend + Frontend + DevOps]
    → QA Agent → Security Agent → Code Execution → END
    → (on failure: retry up to 3x, then human-in-the-loop)
```

| Agent | Tier | LLM | Role |
|-------|------|-----|------|
| PM | 1 | Claude 3.5 Sonnet | Prompt → structured PRD |
| Architect | 1 | Claude 3.5 Sonnet | PRD → system design, DB schema, API |
| Backend | 2 | Claude 3 Haiku | API routes, DB models, business logic |
| Frontend | 2 | Claude 3 Haiku | React components, pages, Tailwind |
| DevOps | 2 | Claude 3 Haiku | Dockerfile, docker-compose, K8s |
| QA | 2 | Claude 3 Haiku | Tests, coverage |
| Security | 3 | Llama-3 70B | Vulnerability scanning |

### Database
- **40+ models**, **25+ enums** in `platform/packages/database/prisma/schema.prisma`
- PostgreSQL with pgvector extension for code embeddings
- Self-referential file tree (`parentId`), soft deletes (`deletedAt`), UUID PKs
- Run `pnpm db:generate` after any schema change

### Services — Notable Details
- **api-gateway:** All traffic enters here. Proxies to 12+ services. Middleware: tracer → CORS → rate limit → DDoS → idempotency → JWT auth → proxy
- **ai-service:** LLM Gateway with 11 providers, 3-tier routing, prompt caching (90% savings), data masking for secrets
- **execution-service:** Uses Express (not Fastify). Firecracker microVMs in prod, local shells in dev. 20 pre-warmed VMs
- **billing-service:** Redis Lua script for atomic check+increment (prevents TOCTOU races). Plan limits: FREE (10k tokens), PRO (1M), TEAM (5M), ENTERPRISE (unlimited)
- **websocket-gateway:** Single WS per user multiplexing collab, terminal, AI, notifications, deploy logs
- **background-worker:** Headless daemon. BullMQ queues (ai/email/cleanup/embedding/usage). Cron: VM hibernation (60s), usage rollup (5min), GC (daily 03:00 UTC)

---

## Environment Variables

**Required:** `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (min 10 chars)
**AI:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`
**Infrastructure:** `KAFKA_BROKERS`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `VAULT_URL`
**Inter-service:** All 14 service URLs (e.g., `AUTH_SERVICE_URL=http://localhost:3100`)

---

## Quick Reference

**Adding a service:** Create `platform/services/<name>/` → add `package.json` → add to workspaces → add routes to API Gateway proxy_router

**Adding an API endpoint:** Add route → document in `DEVELOPMENT_LOGIC.md` → add circuit breaker if external call

**Modifying DB schema:** Edit `platform/packages/database/prisma/schema.prisma` → run `pnpm db:generate` → run `pnpm db:push`

**Adding Kafka events:** Define topic in `@workspace/config/kafka.ts` KafkaTopics enum → add schema to `KAFKA_EVENT_CONTRACTS.md` → implement producer/consumer

**AI agent changes:** Edit Python files in `platform/ai-agents/src/` → agents use Pydantic schemas for inter-agent communication → test with `pytest`

---

## Known Issues

- **Framework inconsistency:** execution-service, notification-service, deployment-service use Express; others use Fastify
- **JWT expiry:** auth-service sets 24h (PRD specifies 15min)
- **Dual config files:** Most services have both `src/config.ts` and `src/config/index.ts`
- **Auth middleware duplication:** Each service re-implements 3-tier auth (internal key → X-User-Id → Bearer JWT)
- **Inconsistent response envelopes:** Some services deviate from `{ success, data, error, trace_id }`
- **Mock DB in auth controller:** Controller imports in-memory mock instead of real Prisma client

---

## Document Hierarchy (conflict resolution)

1. `ARCHITECTURE_STANDARDS.md` (highest priority — single source of truth)
2. `platform/packages/database/prisma/schema.prisma`
3. `KAFKA_EVENT_CONTRACTS.md`
4. `platform/docs/API_DESIGN.md`
5. `AI_Native_IDE_System_Design.md`
6. `SYSTEM_BACKBONE_ARCHITECTURE.md`
7. Per-service `PRD.md`
8. Per-service `DEVELOPMENT_LOGIC.md`

---

**Docs:** [Architecture Standards](./ARCHITECTURE_STANDARDS.md) • [API Design](./platform/docs/API_DESIGN.md) • [DB Schema](./platform/packages/database/) • [Kafka Events](./KAFKA_EVENT_CONTRACTS.md) • [System Design](./AI_Native_IDE_System_Design.md)
