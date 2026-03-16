## Approach

I’ll first map the repository at a **system level** (monorepo layout, apps, shared services/packages, ai-agents, and docs), then synthesize that into the **runtime/execution flows** you asked for (IDE startup + AI prompt flow), and finally call out **implemented vs missing** systems and **technical risks**.

I’m going to:
- Scan top-level architecture docs and PRD/design docs
- Locate the main app entry points for the IDE and agent runtime
- Identify integration boundaries (frontend ↔ backend ↔ agents ↔ storage)




I attempted to batch-read `services/`, `packages/`, `docker-compose.yml`, and the app/agent package metadata. One of the reads failed because `platform/apps/marketing-site/package.json` doesn’t exist at that path (likely different structure). I’ll re-run the batch excluding that file and instead list the [marketing-site/](cci:9://file:///d:/AI-Native-IDE/platform/apps/marketing-site:0:0-0:0) directory to find its actual manifest.















## 1. Platform Overview

The repository is a **pnpm + Turborepo monorepo** containing:
- **Frontend apps** (end-user IDE, admin dashboard, marketing site)
- **Backend microservices** (API gateway + domain services)
- A separate **Python [ai-agents/](cci:9://file:///d:/AI-Native-IDE/platform/ai-agents:0:0-0:0) module** that implements the multi-agent “engineering team” logic
- **Shared packages** ([database](cci:9://file:///d:/AI-Native-IDE/platform/packages/database:0:0-0:0), [shared-types](cci:9://file:///d:/AI-Native-IDE/platform/packages/shared-types:0:0-0:0), [config](cci:9://file:///d:/AI-Native-IDE/platform/packages/config:0:0-0:0), [ui](cci:9://file:///d:/AI-Native-IDE/platform/packages/ui:0:0-0:0)) intended to provide *single-source-of-truth* contracts and utilities across the platform

At a high level, the platform is designed as a **cloud IDE + AI orchestration system**:
- The **IDE app** provides editor, terminal, preview, file explorer, and AI chat panels.
- Backend services manage **auth, projects/files, execution, collaboration, AI workflows, billing, search, deployments, storage, notifications, analytics**.
- The AI layer is split into:
  - **[ai-service](cci:9://file:///d:/AI-Native-IDE/platform/services/ai-service:0:0-0:0) (TypeScript)** exposing workflow APIs + streaming
  - **[ai-agents](cci:9://file:///d:/AI-Native-IDE/platform/ai-agents:0:0-0:0) (Python/LangGraph)** implementing the agent DAG and tool calls.

---

## 2. System Architecture

### Architectural style
- **Microservices with an event-driven backbone**:
  - **Kafka** for durable business events (project lifecycle, AI completion/failure, billing, etc.)
  - **Redis pub/sub** for ephemeral high-frequency real-time signals (presence, cursor, streaming updates)
- **WebSocket-first real-time** for IDE experiences (collab, terminal, AI streaming, notifications)
- **SAGA choreography** is the intended pattern for cross-service workflows (project provisioning, AI refunds, etc.)
- **Shared types/contracts** are intended to live in `@workspace/shared-types`

### Key layers (logical)
- **Client layer**
  - IDE: React + Vite SPA using Monaco + Yjs + xterm, plus optional browser execution via WebContainers
  - Admin: Next.js app
  - Marketing: Next.js-style structure (manifest differs from expectation)
- **Gateway layer**
  - [api-gateway](cci:9://file:///d:/AI-Native-IDE/platform/services/api-gateway:0:0-0:0) (Fastify) routes `/api/v1/*` to internal services with rate limiting, tracing, idempotency, auth validation
  - [websocket-gateway](cci:9://file:///d:/AI-Native-IDE/platform/services/websocket-gateway:0:0-0:0) multiplexes real-time channels so the client maintains a single WS connection
- **Domain services**
  - [auth-service](cci:9://file:///d:/AI-Native-IDE/platform/services/auth-service:0:0-0:0), [project-service](cci:9://file:///d:/AI-Native-IDE/platform/services/project-service:0:0-0:0), [execution-service](cci:9://file:///d:/AI-Native-IDE/platform/services/execution-service:0:0-0:0), [collab-service](cci:9://file:///d:/AI-Native-IDE/platform/services/collab-service:0:0-0:0), [ai-service](cci:9://file:///d:/AI-Native-IDE/platform/services/ai-service:0:0-0:0), [billing-service](cci:9://file:///d:/AI-Native-IDE/platform/services/billing-service:0:0-0:0), [notification-service](cci:9://file:///d:/AI-Native-IDE/platform/services/notification-service:0:0-0:0), [search-service](cci:9://file:///d:/AI-Native-IDE/platform/services/search-service:0:0-0:0), [storage-service](cci:9://file:///d:/AI-Native-IDE/platform/services/storage-service:0:0-0:0), [deployment-service](cci:9://file:///d:/AI-Native-IDE/platform/services/deployment-service:0:0-0:0), [analytics-service](cci:9://file:///d:/AI-Native-IDE/platform/services/analytics-service:0:0-0:0), [background-worker](cci:9://file:///d:/AI-Native-IDE/platform/services/background-worker:0:0-0:0)
- **Data layer**
  - PostgreSQL (+pgvector intended)
  - Redis
  - Kafka
  - S3/MinIO (storage)
  - Elasticsearch (search) (documented, may not be fully implemented)
- **Execution layer**
  - Intended: **Hybrid execution**
    - Tier 1: Browser WebContainers/WASM
    - Tier 2: Firecracker microVMs managed by [execution-service](cci:9://file:///d:/AI-Native-IDE/platform/services/execution-service:0:0-0:0)
  - Current dev compose includes [execution-service](cci:9://file:///d:/AI-Native-IDE/platform/services/execution-service:0:0-0:0) as privileged container but does not prove Firecracker runtime is fully functional end-to-end.

---

## 3. Major Components

### A) Apps (frontend)
- **IDE ([platform/apps/ide](cci:9://file:///d:/AI-Native-IDE/platform/apps/ide:0:0-0:0))**
  - SPA with:
    - **Monaco editor**
    - **File explorer**
    - **Terminal** (xterm)
    - **Preview pane**
    - **AI chat panel**
    - **Patch preview / execution status UI**
  - Integrations:
    - **Execution Stream**: client-side WS subscription model updates a Zustand `executionStore`
    - **AI workflows**: can call backend workflow APIs and subscribe to workflow events
    - **Local fallback AI**: can call Groq directly in the browser and apply file writes locally
- **Admin ([platform/apps/admin](cci:9://file:///d:/AI-Native-IDE/platform/apps/admin:0:0-0:0))**
  - Next.js 15 dashboard scaffold with analytics-like dependencies (tables, charts)
- **Marketing ([platform/apps/marketing-site](cci:9://file:///d:/AI-Native-IDE/platform/apps/marketing-site:0:0-0:0))**
  - Present, but its package manifest isn’t in the expected root (likely a partial scaffold)

### B) Services (backend)
From [docker-compose.yml](cci:7://file:///d:/AI-Native-IDE/platform/docker-compose.yml:0:0-0:0) and API design docs, the intended service mesh is:

- **[api-gateway](cci:9://file:///d:/AI-Native-IDE/platform/services/api-gateway:0:0-0:0)**
  - Front door for HTTP APIs, routing `/api/v1/*` to domain services
  - Intended middleware: auth validation, rate limiting, idempotency, tracing, circuit breaker
- **[websocket-gateway](cci:9://file:///d:/AI-Native-IDE/platform/services/websocket-gateway:0:0-0:0)**
  - Single persistent WS per user, multiplexes channels:
    - `collab:*`, `terminal:*`, `ai:*`, `deploy:*`, `notifications:*`, etc.
- **[auth-service](cci:9://file:///d:/AI-Native-IDE/platform/services/auth-service:0:0-0:0)**
  - User auth flows (register/login/refresh/logout, MFA hooks) + emits Kafka auth/user events
- **[project-service](cci:9://file:///d:/AI-Native-IDE/platform/services/project-service:0:0-0:0)**
  - Project CRUD and file tree management
  - Emits Kafka events: `project.created`, `file.modified`, etc.
- **[ai-service](cci:9://file:///d:/AI-Native-IDE/platform/services/ai-service:0:0-0:0)**
  - Workflow API for multi-agent generation
  - Emits Kafka AI events (`ai.task.completed/failed`)
  - **Intended** to delegate to Python [ai-agents](cci:9://file:///d:/AI-Native-IDE/platform/ai-agents:0:0-0:0) module
- **[execution-service](cci:9://file:///d:/AI-Native-IDE/platform/services/execution-service:0:0-0:0)**
  - Run commands, stream terminal output, install packages
  - Intended to manage Firecracker lifecycle (pooling, snapshots, hibernation)
- **[collab-service](cci:9://file:///d:/AI-Native-IDE/platform/services/collab-service:0:0-0:0)**
  - Yjs CRDT sync + presence awareness
- **[billing-service](cci:9://file:///d:/AI-Native-IDE/platform/services/billing-service:0:0-0:0)**
  - Stripe integration + usage/quota enforcement and refund SAGA behaviors
- **[notification-service](cci:9://file:///d:/AI-Native-IDE/platform/services/notification-service:0:0-0:0)**
  - Push notifications and email dispatch
- **[search-service](cci:9://file:///d:/AI-Native-IDE/platform/services/search-service:0:0-0:0)**
  - Elasticsearch-backed code search + indexing on `file.modified`
- **[storage-service](cci:9://file:///d:/AI-Native-IDE/platform/services/storage-service:0:0-0:0)**
  - S3/MinIO proxy for uploads/downloads and cleanup
- **[deployment-service](cci:9://file:///d:/AI-Native-IDE/platform/services/deployment-service:0:0-0:0)**
  - Preview/prod deployments (Vercel/Railway/AWS tokens) + build log streaming
- **[analytics-service](cci:9://file:///d:/AI-Native-IDE/platform/services/analytics-service:0:0-0:0)**
  - Admin-facing analytics + feature flags
- **[background-worker](cci:9://file:///d:/AI-Native-IDE/platform/services/background-worker:0:0-0:0)**
  - BullMQ-driven async jobs (embeddings, cleanup, usage aggregation, etc.)

### C) Packages (shared libraries)
- **`@workspace/database`**
  - Prisma schema + Prisma client singleton
  - This is the intended **DB schema source of truth**
- **`@workspace/shared-types`**
  - Intended to define Zod schemas + DTOs + WS event contracts
  - Helps enforce API contract consistency
- **`@workspace/config`**
  - Intended to validate env variables and hold constants
- **`@workspace/ui`**
  - Shared UI components (note: docs mention MUI; architecture standards mention Radix/shadcn/tailwind—there’s a consistency gap)

### D) AI Agents (Python)
- **[platform/ai-agents](cci:9://file:///d:/AI-Native-IDE/platform/ai-agents:0:0-0:0)**
  - A *pure Python package* (no HTTP boundary inside) implementing:
    - LangGraph DAG (`PM -> Architect -> parallel Backend/Frontend/DevOps -> QA -> Security`)
    - Strong state schema via Pydantic
    - Cost routing across model tiers
    - Tooling stubs for “file modify” + “bash execute”
    - Streaming + validation + human-in-the-loop are documented as “complete” in PRD

---

## 4. Runtime Flow

### 4.1 Execution flow when a user opens the IDE
From the currently implemented IDE app:

1. **Browser loads IDE SPA**
   - `main.tsx` mounts React with React Router.
2. **Router selects project + file route**
   - Default route navigates to `/p/demo/f/src/index.ts`.
   - `/p/:projectId/f/*` renders the shell for a project and a file path.
3. **Shell initializes “IDE runtime state”**
   - Opens the active editor tab for `projectId + filePath`.
   - Initializes the **Execution Stream integration hook**:
     - Creates an `ExecutionStreamClient`
     - Connects automatically (`autoConnect: true`)
     - Subscribes to workspace events (`autoSubscribeWorkspace: true`)
     - **Currently defaults to `mockMode: true`** (important: implies backend is not required for this stream to function in dev UI mode).
4. **Panels render**
   - Sidebar shows AI Chat or file explorer.
   - Main area shows Monaco editor.
   - Bottom panel toggles terminal/preview.
   - Status bar reads from Zustand `executionStore`.

**Net effect:** the IDE can boot and appear functional even without full backend connectivity because execution streaming is mocked by default.

### 4.2 Execution flow when a user sends an AI coding prompt
The implemented path in `AIChatPanel` behaves like a 2-tier strategy:

#### A) Preferred: backend “AI Team Workflow”
1. User sends text prompt in the AI panel.
2. The panel checks **coding intent** ([isCodingIntent](cci:1://file:///d:/AI-Native-IDE/platform/apps/ide/src/services/localCodingService.ts:104:0-107:1)).
3. If it’s a coding request:
   - It connects a **workflow WebSocket** via `aiServiceClient.connectWebSocket()`.
   - Calls `aiServiceClient.startWorkflow(...)` to start a workflow run.
   - Subscribes to workflow events (`step_started`, `step_completed`, `workflow_completed`, etc.).
   - In parallel, it can **poll** workflow status as a fallback.
4. Output is shown progressively as agent steps complete.

This corresponds to the platform design: the IDE triggers [ai-service](cci:9://file:///d:/AI-Native-IDE/platform/services/ai-service:0:0-0:0), then streams progress back.

#### B) Fallback: client-side Groq “local coding”
If the backend workflow fails/unavailable:
1. The IDE builds a prompt containing:
   - “IDE context block” + selected code / file context
2. Calls Groq from the browser (`groqClient.chatStream`)
3. Parses response into “file patches” (very permissive parser)
4. Applies changes directly to Monaco models (`model.setValue(...)`)

**Important implication:** today there are *two AI systems* in the IDE:
- Backend workflow path (intended enterprise multi-agent)
- Local Groq path (fast fallback, but not aligned with CRDT/project-service persistence yet)

---

## 5. Current Implementation Status

### Implemented and visible in repo (high confidence)
- **Monorepo scaffolding**
  - Turborepo + pnpm workspaces for `apps/*`, `services/*`, `packages/*`
- **IDE frontend**
  - Monaco editor + panels + Zustand stores
  - AI chat UI that can:
    - start workflows via `aiServiceClient`
    - stream workflow updates via WebSocket
    - fallback to Groq streaming
- **Execution event model (frontend)**
  - `executionStore` supports tasks, events, patch previews, retention
  - [useExecutionStreamIntegration](cci:1://file:///d:/AI-Native-IDE/platform/apps/ide/src/hooks/useExecutionStreamIntegration.tsx:71:0-398:1) wires an `ExecutionStreamClient` into the store
- **AI agents module (Python)**
  - LangGraph orchestration design is present and structured
  - Tools & cost routing are described and partially represented
- **Docker compose dev environment**
  - Postgres + Redis + Kafka/Zookeeper + the full set of services are defined as containers

### Implemented “by design/docs” but not proven end-to-end (medium confidence)
- **Event-driven Kafka choreography + SAGA rollback**
  - Well-defined in docs, but you’d need to confirm each service actually produces/consumes those topics.
- **Hybrid execution (WebContainers + Firecracker)**
  - IDE includes `@webcontainer/api`
  - Backend includes [execution-service](cci:9://file:///d:/AI-Native-IDE/platform/services/execution-service:0:0-0:0) with privileged container
  - But the integrated provisioning + routing + security boundary likely isn’t fully complete yet.
- **Shared contracts via `@workspace/shared-types`**
  - Present as a package, but the IDE currently uses local clients and direct fetches rather than clearly importing shared DTOs everywhere.

---

## 6. Missing Systems (and Major Technical Risks)

### Missing / incomplete systems (compared to target architecture)
- **Authentication integration in IDE**
  - The IDE currently routes to a demo project and uses default `workspaceId/userId` placeholders in several spots.
  - Full JWT-based auth session management + RBAC enforcement in the IDE UI appears incomplete.
- **Real project filesystem persistence**
  - Local fallback AI writes directly into Monaco models; this does not guarantee persistence to [project-service](cci:9://file:///d:/AI-Native-IDE/platform/services/project-service:0:0-0:0) + storage, nor CRDT consistency.
- **CRDT-safe file modification pipeline for AI**
  - The Python agent PRD explicitly warns that AI must not write directly to DB and should use WS/CRDT-safe mechanisms.
  - The local fallback path bypasses that and can diverge from the intended collab model.
- **Unified streaming architecture**
  - There are multiple streaming paths:
    - “workflow WebSocket” from `aiServiceClient`
    - “execution stream” client with mock mode
    - “ws gateway” multiplexing model (documented)
  - Risk: duplicated protocols and inconsistent event schemas.
- **Firecracker microVM execution layer**
  - Present in documentation and docker compose, but typically requires substantial infra work (kernel images, jailer config, snapshots, volume mounts, networking).
- **Search/embeddings/RAG pipeline**
  - Documented (Elasticsearch + pgvector + embeddings worker), but not validated as implemented.
- **Billing/quotas enforcement**
  - Documented event flows and Stripe integration, but end-to-end enforcement in gateway + services + UI likely incomplete.
- **Deployment pipeline**
  - API designed; likely not fully operational without provider credentials, build runners, secure artifact flow.
- **Observability / tracing**
  - `trace_id` is part of the API envelope design, but full OpenTelemetry propagation isn’t confirmed.

### Major technical risks
- **Split-brain architecture between “docs” and “code reality”**
  - Docs describe an enterprise event-driven platform; IDE code currently uses mocks and local fallbacks that can bypass core invariants.
- **Consistency and data integrity risk (CRDT vs direct writes)**
  - If file state can be modified via multiple channels (CRDT, REST, local Monaco writes), reconciling source-of-truth becomes hard.
- **Security risk: client-side LLM + API key entry**
  - Letting the browser directly call Groq with user-provided keys is convenient but increases exposure risk and complicates enterprise compliance.
- **Operational complexity risk**
  - Kafka + many services + WS gateway + execution sandboxes + collab is a large distributed system; partial implementation can lead to fragile integration.
- **Contract drift**
  - Without strict use of `@workspace/shared-types` across all boundaries, API/WS drift becomes likely.

---

## Status Summary

- **Completed:** I mapped the platform’s monorepo layout, documented architecture, major components, and traced the IDE startup + AI prompt runtime flows.
- **Delivered:** Full platform overview in the exact sections you requested.
- **Open:** If you want, I can do a second pass that explicitly distinguishes **“implemented in code” vs “declared in docs only”** per subsystem by sampling each service’s actual runtime entry points (still at a high level, not file-by-file).