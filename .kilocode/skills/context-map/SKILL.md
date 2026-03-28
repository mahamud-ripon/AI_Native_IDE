---
name: context-map
description: >-
  Complete project context map for the AI-Native IDE monorepo. Contains
  architecture overview, all microservices analysis, frontend apps, shared
  packages, AI agents engine, data flow, infrastructure, and known issues.
  Load this skill to understand the entire codebase before making changes.
metadata:
  category: development
  source:
    repository: local
    path: .kilocode/skills/context-map
---

# AI-Native IDE — Complete Context Map

> Last updated: 2026-03-28
> Use this skill to understand the full codebase before making changes.

## Project Identity

Cloud-based, AI-native IDE (bolt.new/replit competitor). Users describe apps in natural language; a multi-agent AI system generates code.

**Stack:** pnpm + Turborepo monorepo. React/Vite + Next.js frontend. Fastify/Express microservices (TypeScript). Python LangGraph AI engine. PostgreSQL/Prisma. Redis. Kafka (Redpanda). S3/MinIO.

## Directory Structure

```
platform/
├── apps/
│   ├── ide/              # React+Vite IDE (port 5173) — core product
│   ├── admin/            # Next.js 15 admin panel (port 3000)
│   └── marketing-site/   # Next.js 15 stub (placeholder)
├── packages/
│   ├── config/           # @workspace/config — env validation, Kafka, constants
│   ├── database/         # @workspace/database — Prisma ORM, 40+ models, 1159-line schema
│   ├── shared-types/     # @workspace/shared-types — cross-boundary TypeScript contracts
│   └── ui/               # @workspace/ui — shared React components (Button only)
├── services/             # 14 microservices (see below)
└── ai-agents/            # Python LangGraph multi-agent engine
```

## Frontend Applications

### IDE App (`apps/ide/`)
- React 18 + Vite + TypeScript, port 5173, proxies API to :8000
- Monaco Editor, WebContainer (in-browser Node.js), Yjs CRDT collab, xterm.js terminal, isomorphic-git, D3 DAG viz
- 7 Zustand stores: ideStore, layoutStore, aiChatStore, executionStore, tabsStore, uiStore, gitStore
- Intent Classifier routes prompts: conversation (Groq) / simple_edit (ai-service) / complex_build (ai-agents SSE)
- Routes: `/` (landing), `/login`, `/new` (create project), `/p/:projectId` (IDE), `/p/:projectId/f/*` (file)
- Event bus: mitt-based typed event system

### Admin Panel (`apps/admin/`)
- Next.js 15 App Router, port 3000
- User management, VM pool monitoring, analytics (DAU/MAU/MRR), feature flags, AI settings, audit logs
- Edge middleware JWT auth (jose), RBAC admin/superadmin
- @tanstack/react-table + react-virtual, D3/recharts visualizations, WebSocket real-time metrics

## Shared Packages

### `@workspace/config`
- Zod env validation (lightweight `index.ts` + strict `env.ts`)
- Kafka client factory, `KafkaTopics` enum (20+ topics)
- Constants: DEFAULT_LIMITS, VM_SPECS, LLM_TIERS, DEPLOY_PROVIDERS

### `@workspace/database`
- Prisma ORM singleton, 1159-line schema, 40+ models, 25+ enums
- Domains: Users/Orgs (8), Projects/Files (12), AI/Agents (7), Execution/Deploy (4), Workflow Checkpoints (3), Billing/Usage (5)
- PostgreSQL with pgvector, UUID PKs, soft deletes, self-referential file tree

### `@workspace/shared-types`
- Pure TypeScript interfaces, no ORM dependency
- Modules: api.ts, user.ts, project.ts, ai.ts

### `@workspace/ui`
- Sandboxed React components, Tailwind CSS, dark theme
- Only Button component implemented so far

## 14 Microservices

| Service | Port | FW | Purpose |
|---------|------|----|---------|
| api-gateway | 8000 | Fastify | Reverse proxy, JWT auth, rate limiting, circuit breakers, idempotency, DDoS protection |
| auth-service | 3100 | Fastify | Registration, JWT RS256 + refresh rotation, Argon2id, audit logging |
| project-service | 8002 | Fastify | Project CRUD, file tree (S3), RBAC, secrets (Vault), templates |
| ai-service | 8003 | Fastify | LLM Gateway (11 providers), 3-mode agent, workflows, SSE streaming |
| execution-service | 8004 | Express | Firecracker microVMs, terminal PTY, VM pool (20 pre-warmed) |
| collab-service | 8005 | Fastify | Yjs CRDT editing, awareness, 3-tier persistence (Mem→Redis→Postgres) |
| billing-service | 8006 | Fastify | Stripe integration, atomic Redis Lua metering, plan limits |
| notification-service | 8007 | Express | Push (Redis Pub/Sub), email (BullMQ + SES), batching |
| search-service | 8008 | Fastify | Elasticsearch full-text search, per-project indices |
| storage-service | 8009 | Fastify | S3/MinIO gateway, pre-signed URLs, ClamAV virus scan |
| deployment-service | 8010 | Express | Vercel/Railway deploy, log streaming, rollback, custom domains |
| analytics-service | 8011 | Fastify | Admin metrics (DAU/WAU/MAU/MRR), feature flag engine |
| websocket-gateway | 8012 | Fastify | Real-time hub, multiplexes collab/terminal/AI/notifications |
| background-worker | — | — | BullMQ queues, cron jobs, DLQ, VM hibernation, usage rollup |

### Communication Patterns
- **Sync HTTP:** Frontend → API Gateway → Services
- **Async Kafka:** Inter-service state changes (20+ topics, SAGA choreography)
- **WebSocket:** Real-time push (terminal, collab, AI streaming)
- **Redis Pub/Sub:** Ephemeral data (cursors, typing, VM metrics)

### Key Patterns
- SAGA: project.created → VM alloc → storage → activate (rollback on failure)
- Idempotency: Redis SETNX 24h TTL, Idempotency-Key header
- DLQ: 3 retries + exponential backoff → dead letter queue + alert
- Circuit Breaker: opossum on all external calls

## AI Agents Engine (`platform/ai-agents/`)

Python 3.11+, LangGraph, LangChain, Pydantic v2, FastAPI (port 9000)

### Agent Pipeline
```
precheck (Jailbreak) → PM Agent → Architect Agent
    → [parallel: Backend + Frontend + DevOps]
    → QA Agent → Security Agent → Code Execution → END
    → (on failure: retry up to 3x, then human-in-the-loop)
```

### Agent Roles
| Agent | Tier | LLM | Role |
|-------|------|-----|------|
| PM | 1 | Claude 3.5 Sonnet | Prompt → structured PRD |
| Architect | 1 | Claude 3.5 Sonnet | PRD → system design, DB schema, API endpoints |
| Backend | 2 | Claude 3 Haiku | API routes, DB models, business logic |
| Frontend | 2 | Claude 3 Haiku | React components, pages, Tailwind |
| DevOps | 2 | Claude 3 Haiku | Dockerfile, docker-compose, K8s |
| QA | 2 | Claude 3 Haiku | Tests, coverage |
| Security | 3 | Llama-3 70B | Vulnerability scanning |
| Code Execution | — | None | Bridges workflow → VM execution |

### Key Features
- 3-tier LLM routing with 90% prompt caching savings
- 15 tools (file ops, shell exec, scaffold, DB)
- 3 security layers: jailbreak classifier → instruction guard → schema validation
- MAX_RETRIES=3, parallel execution with deadlock detection
- 312+ tests

## End-to-End Data Flow: "Build an App"

1. User types prompt in IDE chat
2. Intent Classifier → complex_build route
3. IDE SSE → ai-service → Python ai-agents :9000
4. JailbreakClassifier validates prompt
5. PM Agent (Claude 3.5) → PRD
6. Architect Agent (Claude 3.5) → system design
7. Parallel: Backend + Frontend + DevOps agents generate code
8. QA Agent runs tests; retries up to 3x on failure
9. Security Agent scans for vulnerabilities
10. Code Execution Agent writes files via project-service API, runs in VM
11. SSE/WS streams progress to IDE chat
12. Billing deducts tokens atomically (Redis Lua); refunds on failure

## Infrastructure

- **Monorepo:** Turborepo + pnpm workspaces
- **Database:** Neon.tech PostgreSQL 16 + pgvector
- **Cache:** Upstash Redis (serverless)
- **Queue:** Redpanda Cloud (Kafka-compatible)
- **Storage:** S3 / MinIO (local dev)
- **Search:** Elasticsearch 8
- **Secrets:** HashiCorp Vault
- **VMs:** Firecracker microVMs (prod) / local shells (dev)
- **Docker:** docker-compose.yml (prod) + docker-compose.dev.yml (dev)

## Build/Lint/Test Commands

```bash
# Root (from platform/)
pnpm install / build / test / lint / lint:fix / typecheck / format / clean
pnpm db:generate / db:push / db:migrate

# Single service test
cd platform/services/<service> && pnpm test -- --testPathPattern=<pattern>

# Python AI agents
cd platform/ai-agents
pytest tests/test_file.py
pytest -k "test_name"

# Dev mode
pnpm dev                                    # all services
cd platform/services/<service> && pnpm dev  # single service
cd platform/ai-agents && python -m uvicorn src.api.main:app --reload --port 9000
```

## Known Issues & Tech Debt

| Issue | Location | Impact |
|-------|----------|--------|
| Framework inconsistency | execution/notification/deployment use Express, others Fastify | Maintenance |
| JWT 24h expiry | auth-service (PRD says 15min) | Security |
| Dual config files | Most services have src/config.ts + src/config/index.ts | Confusion |
| Auth middleware duplication | Each service re-implements 3-tier auth | Code duplication |
| Inconsistent response envelopes | Some services deviate from standard envelope | Frontend parsing |
| Mock DB in auth controller | Imports in-memory mock instead of real Prisma | Non-functional |
| Marketing site stub | Only placeholder page | No SEO |
| UI package minimal | Only Button component | Limited shared UI |

## Document Hierarchy (conflict resolution)

1. ARCHITECTURE_STANDARDS.md (highest priority)
2. packages/database/prisma/schema.prisma
3. KAFKA_EVENT_CONTRACTS.md
4. platform/docs/API_DESIGN.md
5. AI_Native_IDE_System_Design.md
6. SYSTEM_BACKBONE_ARCHITECTURE.md
7. Per-service PRD.md
8. Per-service DEVELOPMENT_LOGIC.md
