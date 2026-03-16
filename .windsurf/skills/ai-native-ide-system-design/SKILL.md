**SYSTEM DESIGN DOCUMENT**

AI-Native Cloud IDE Platform

  -----------------------------------------------------------------------
  Document Version                    1.0.0
  ----------------------------------- -----------------------------------
  Classification                      CONFIDENTIAL --- INTERNAL

  Status                              DRAFT --- PENDING REVIEW

  Author                              Platform Architecture Team

  Date                                March 11, 2026

  Target Audience                     Engineering, Product,
                                      Infrastructure
  -----------------------------------------------------------------------

**Table of Contents**

**1. Executive Summary**

This document describes the complete system design for an AI-Native
Cloud IDE Platform --- a next-generation software development
environment that enables developers to build production-grade
applications through natural language prompts, guided by
enterprise-level engineering processes.

Unlike existing tools such as Replit or GitHub Codespaces, this platform
uniquely integrates a multi-agent AI orchestration layer that mirrors
the processes of elite software engineering teams --- spanning
requirements analysis, architecture design, database modeling, API
planning, sprint management, security review, and DevOps automation.

**1.1 Vision Statement**

  ------------ -------------------------------------------------------------
  **VISION**   To democratize elite-level software engineering by enabling
               any developer to build, deploy, and scale production-grade
               applications through an AI-driven platform that thinks,
               plans, and codes like a world-class engineering team.

  ------------ -------------------------------------------------------------

**1.2 Core Differentiators**

  -----------------------------------------------------------------------
  **Differentiator**                  **Description**
  ----------------------------------- -----------------------------------
  Multi-Agent AI Orchestration        PM Agent, Architect Agent,
                                      Backend/Frontend Agents working in
                                      parallel like a real engineering
                                      team

  Enterprise Process Enforcement      Every project follows
                                      Google/Stripe-level development
                                      standards automatically

  Secure microVM Execution            Firecracker-based isolated
                                      environments --- sub-125ms boot,
                                      kernel-level isolation

  Real-Time Collaboration             CRDT-based (Yjs) live collaboration
                                      --- conflict-free, offline-first

  Intelligent Cost Control            Auto-hibernation, predictive
                                      scaling, and per-project resource
                                      budgeting

  AI-Driven Code Review               Automated security scanning,
                                      performance profiling, and
                                      architecture validation
  -----------------------------------------------------------------------

**2. System Overview**

**2.1 High-Level Architecture**

The platform is built as a distributed microservices system, organized
into five distinct layers:

+-----------------------------------------------------------------------+
| ┌─────────────────────────────────────────────────────────────────┐   |
|                                                                       |
| │ CLIENT LAYER │                                                      |
|                                                                       |
| │ Browser IDE (Monaco) · Desktop App · Mobile (View) │                |
|                                                                       |
| └─────────────────────────┬───────────────────────────────────────┘   |
|                                                                       |
| │ HTTPS / WSS                                                         |
|                                                                       |
| ┌─────────────────────────▼───────────────────────────────────────┐   |
|                                                                       |
| │ EDGE / CDN LAYER │                                                  |
|                                                                       |
| │ Cloudflare (DDoS, WAF, Global CDN, WebSocket) │                     |
|                                                                       |
| └─────────────────────────┬───────────────────────────────────────┘   |
|                                                                       |
| │                                                                     |
|                                                                       |
| ┌─────────────────────────▼───────────────────────────────────────┐   |
|                                                                       |
| │ API GATEWAY + AUTH LAYER │                                          |
|                                                                       |
| │ Kong Gateway · JWT Validation · Rate Limiting │                     |
|                                                                       |
| └────────┬────────────────┬─────────────┬───────────────┬─────────┘   |
|                                                                       |
| │ │ │ │                                                               |
|                                                                       |
| ┌────────▼──────┐ ┌──────▼──────┐ ┌───▼────────┐ ┌───▼──────────┐     |
|                                                                       |
| │ Auth Service │ │ AI Service │ │ Collab Svc │ │ Project Svc │        |
|                                                                       |
| │ (Keycloak) │ │ (Orchestr.) │ │ (Yjs) │ │ (CRUD+Git) │               |
|                                                                       |
| └───────────────┘ └──────┬──────┘ └────────────┘ └──────────────┘     |
|                                                                       |
| │ Kafka                                                               |
|                                                                       |
| ┌─────────────────────────▼───────────────────────────────────────┐   |
|                                                                       |
| │ HYBRID EXECUTION LAYER │                                            |
|                                                                       |
| │ Tier 1: Browser WebAssembly (WASM) / WebContainers (Zero-cost) │    |
| │ Tier 2: Kubernetes · Firecracker microVMs (Pro / Heavy compute) │   |
|                                                                       |
| └─────────────────────────┬───────────────────────────────────────┘   |
|                                                                       |
| │                                                                     |
|                                                                       |
| ┌─────────────────────────▼───────────────────────────────────────┐   |
|                                                                       |
| │ DATA LAYER │                                                        |
|                                                                       |
| │ PostgreSQL · Redis · S3/MinIO · Elasticsearch │                     |
|                                                                       |
| └─────────────────────────────────────────────────────────────────┘   |
+-----------------------------------------------------------------------+

**2.2 Technology Stack**

  -------------------------------------------------------------------------------
  **Layer**           **Technology**    **Purpose**           **Justification**
  ------------------- ----------------- --------------------- -------------------
  **Frontend**        Next.js 15 +      Web application       SSR, App Router,
                      React             framework             edge-ready

  **Editor**          Monaco Editor     In-browser code       VS Code core ---
                                        editor                industry standard

  **Realtime**        Yjs + y-websocket CRDT collaboration    Conflict-free,
                                                              offline-first

  **API Gateway**     Kong (OSS)        Traffic management    Plugin ecosystem,
                                                              rate limiting

  **Auth**            Keycloak          Identity provider     OIDC/OAuth2,
                                                              enterprise SSO

  **AI                LangGraph +       Multi-agent workflows Stateful agent
  Orchestration**     Claude API                              graphs

  **Backend           FastAPI (Python)  Core microservices    Async, type-safe,
  Services**                                                  fast

  **Container         Firecracker +     Secure sandboxed exec Sub-125ms boot,
  Runtime**           containerd                              KVM-based

  **Orchestration**   Kubernetes        Service orchestration Auto-scaling,
                      (K3s/EKS)                               self-healing

  **Message Queue**   Apache Kafka      Event streaming       High-throughput,
                                                              durable

  **Primary DB**      PostgreSQL 16     Relational data       ACID, JSON support,
                                                              mature

  **Cache**           Redis Cluster     Session + cache layer Sub-ms latency,
                                                              pub/sub

  **Object Storage**  S3 / MinIO        Files, artifacts,     Cost-effective,
                                        logs                  scalable

  **Search**          Elasticsearch     Code search, logs     Full-text + vector
                                                              search

  **Observability**   Prometheus +      Metrics + dashboards  Industry standard
                      Grafana                                 stack

  **Tracing**         OpenTelemetry +   Distributed tracing   Vendor-neutral,
                      Jaeger                                  CNCF

  **LSP Support**     LSP Servers       Autocomplete,         IDE-grade editor
                      (tsserver,        go-to-definition,     experience — not
                      pyright,          error highlighting     just syntax
                      rust-analyzer)                           highlighting

  **Live Preview**    iframe proxy      Real-time web app      Side-by-side preview
                      + Vite HMR        preview in IDE         like Replit

  **Background        Celery +          Async job processing   Reliable, retryable,
  Jobs**              Redis broker                             scheduled tasks

  **WebSocket         Custom FastAPI    Single WS per user,    Reduces 3 WS to 1
  Gateway**           service           channel multiplexing   per user

  **Secrets**         HashiCorp Vault   Secret management,     Zero secrets in env
                                        key rotation           files or code
  -------------------------------------------------------------------------------

**2.3 IDE Core Features**

Beyond a simple code editor, the platform provides a complete
IDE experience with these features running inside the user's microVM:

**2.3.1 LSP (Language Server Protocol) Integration**

LSP servers run inside the user's Firecracker VM, giving full
access to the project filesystem (node_modules, venv, etc.):

+-----------------------------------------------------------------------+
| Browser: Monaco Editor ←→ MonacoLanguageClient (npm)                   |
|           │                                                            |
|           │ JSON-RPC via WS channel: lsp:{project_id}:{language}       |
|           ▼                                                            |
| WebSocket Gateway → Forward to VM                                      |
|           │                                                            |
|           ▼                                                            |
| VM: LSP Proxy → spawns correct Language Server:                        |
|                                                                        |
|   .ts/.js  → tsserver (TypeScript)      ~100MB RAM                     |
|   .py      → pyright / pylsp            ~80MB RAM                      |
|   .rs      → rust-analyzer                                             |
|   .go      → gopls                                                     |
|   .java    → jdtls                                                     |
|   .c/.cpp  → clangd                                                    |
|                                                                        |
| Features: Autocomplete, go-to-definition, hover types, error           |
|           highlighting, rename symbol, find references                  |
|                                                                        |
| Lifecycle: Lazy start on file open, stop on project close              |
| Phase: MVP Sprint 4-5 (tsserver + pyright first)                       |
+-----------------------------------------------------------------------+

**2.3.2 Live Preview Pane**

Web projects get a side-by-side live preview, like Replit:

+-----------------------------------------------------------------------+
| IDE Layout:                                                            |
| ┌──────────────────────┬────────────────────────┐                      |
| │ Monaco Editor        │ Preview Pane (iframe)  │                      |
| │                      │ src={previewUrl}        │                      |
| │                      │ Hot reload on save      │                      |
| └──────────────────────┴────────────────────────┘                      |
|                                                                        |
| How it works:                                                          |
| 1. VM starts dev server (npm run dev) on port 3000                     |
| 2. Reverse proxy maps: VM:3000 →                                      |
|    https://{project_id}.preview.platform.io                            |
| 3. iframe loads the preview URL                                        |
| 4. On file save → Vite HMR auto-refreshes (no full reload)            |
|                                                                        |
| Security:                                                              |
| • Preview runs inside sandboxed VM (no host access)                    |
| • CSP: frame-src *.preview.platform.io                                 |
| • Private projects: preview URL includes short-lived token             |
| Phase: MVP Sprint 5-6                                                  |
+-----------------------------------------------------------------------+

**2.3.3 Package Manager UI**

A visual panel for installing/updating/removing packages:

  -----------------------------------------------------------------------
  **Action**                          **Implementation**
  ----------------------------------- -----------------------------------
  View installed                      Parse package.json / requirements.txt
                                      inside VM, display with versions

  Search                              Query npm registry / PyPI API,
                                      show results with install button

  Install / Update / Remove           Execute npm install / pip install
                                      inside VM terminal, stream output

  Audit (CVE scan)                    Run npm audit / pip-audit, flag
                                      vulnerable packages in UI
  -----------------------------------------------------------------------

  API: GET|POST /projects/{id}/packages, GET /packages/search?q=
  Phase: Phase 2 Sprint 12-13

**2.3.4 Environment Variables UI**

Secure env var management with Vault-backed encryption:

+-----------------------------------------------------------------------+
| Flow:                                                                  |
| 1. User adds env var in UI → encrypted client-side                     |
| 2. POST /projects/{id}/env-vars → stored in HashiCorp Vault           |
| 3. DB stores only key names (never values) for UI display              |
| 4. VM startup: fetch values from Vault → inject as process.env         |
| 5. UI shows masked values (••••), reveal on click                      |
|                                                                        |
| Security: Values NEVER stored in PostgreSQL or env files.              |
|           AES-256 encryption in Vault. Per-project isolation.           |
| Phase: MVP Sprint 6                                                    |
+-----------------------------------------------------------------------+

**2.4 File Storage Consistency Strategy**

Files have dual storage: content in S3, metadata in PostgreSQL.
This creates a consistency challenge solved by "S3 First" approach:

+-----------------------------------------------------------------------+
| FILE SAVE FLOW (Transactional):                                        |
|                                                                        |
| Step 1: Generate unique S3 key (no overwrite of previous)              |
|         s3_key = "projects/{project_id}/files/{uuid4()}"               |
|                                                                        |
| Step 2: Upload to S3                                                   |
|         → If S3 FAILS → return error, nothing changed                  |
|         → If S3 OK → continue                                          |
|                                                                        |
| Step 3: Update PostgreSQL (atomic transaction)                         |
|         BEGIN; UPDATE project_files SET s3_key, content_hash,           |
|         size_bytes, updated_at; COMMIT;                                |
|         → If DB FAILS → cleanup: delete new S3 object                  |
|         →                old S3 object still valid                      |
|         → If DB OK → success                                           |
|                                                                        |
| Step 4: Async cleanup old S3 object (background worker)                |
|                                                                        |
| Small file optimization: Files < 64KB stored directly in               |
| PostgreSQL (inline_content BYTEA), avoiding S3 round-trip.             |
|                                                                        |
| Orphan Collector: Weekly background job finds S3 objects                |
| not referenced in project_files and deletes them (24hr safety margin). |
+-----------------------------------------------------------------------+

**2.5 AI Generation Retry & Resume**

AI generation runs server-side via Celery (not client-dependent),
with checkpointing for resume support:

+-----------------------------------------------------------------------+
| PIPELINE:                                                              |
|                                                                        |
| User submits prompt                                                    |
|   → POST /ai/generate                                                 |
|   → Creates ai_conversations record (status: QUEUED)                   |
|   → Dispatches Celery task: ai_orchestrate(conversation_id)            |
|   → Returns immediately: { conversation_id, ws_channel }              |
|   → Client subscribes to WS: "ai:{conversation_id}"                   |
|                                                                        |
| Server processes (even if client disconnects):                         |
|   → Each agent saves output to ai_messages on completion               |
|   → Redis checkpoint: orchestrator:{conv_id} stores progress           |
|   → WS push to client on each milestone                               |
|                                                                        |
| RESUME (after disconnect):                                             |
|   → GET /ai/status/{conversation_id}                                   |
|   → Returns: status, agent progress, elapsed time, ETA                 |
|   → If still running: reconnect to WS stream                          |
|   → If complete: show all results                                      |
|                                                                        |
| RETRY (after failure):                                                 |
|   → POST /ai/retry/{conversation_id}                                   |
|   → Body: { "agents": ["backend"] } — retry specific agents           |
|   → Already-completed agents NOT re-run                                |
|                                                                        |
| CANCEL:                                                                |
|   → POST /ai/cancel/{conversation_id}                                  |
|   → Partial results preserved, status = "cancelled"                    |
+-----------------------------------------------------------------------+

**3. AI Multi-Agent Orchestration Engine**

The AI engine is the platform\'s core differentiator. It uses a directed
acyclic graph (DAG) of specialized agents that collaborate to produce
enterprise-grade outputs from simple natural language prompts.

**3.1 Agent Architecture**

+-----------------------------------------------------------------------+
| User Prompt: \'Build an ecommerce website\'                           |
|                                                                       |
| │                                                                     |
|                                                                       |
| ▼                                                                     |
|                                                                       |
| ┌───────────────────┐                                                 |
|                                                                       |
| │ Orchestrator │ ← Analyzes intent, creates execution plan            |
|                                                                       |
| │ (LangGraph) │                                                       |
|                                                                       |
| └──────┬────────────┘                                                 |
|                                                                       |
| │ spawns parallel agents                                              |
|                                                                       |
| ┌────┼─────────────────────────────────────┐                          |
|                                                                       |
| │ │ │ │ │                                                             |
|                                                                       |
| ▼ ▼ ▼ ▼ ▼                                                             |
|                                                                       |
| \[PM\] \[Architect\] \[Backend\] \[Frontend\] \[DevOps\]              |
|                                                                       |
| │ │ │ │ │                                                             |
|                                                                       |
| Reqs SysDesign API+DB UI/UX Docker+CI                                 |
|                                                                       |
| │ │ │ │ │                                                             |
|                                                                       |
| └────┴────────────────┴───────────┴─────────┘                         |
|                                                                       |
| │                                                                     |
|                                                                       |
| \[QA Agent\]                                                          |
|                                                                       |
| Tests + Coverage                                                      |
|                                                                       |
| │                                                                     |
|                                                                       |
| \[Security Agent\]                                                    |
|                                                                       |
| OWASP scan, CVE check                                                 |
|                                                                       |
| │                                                                     |
|                                                                       |
| FINAL PROJECT OUTPUT                                                  |
+-----------------------------------------------------------------------+

**3.2 Agent Specifications**

  ----------------------------------------------------------------------------
  **Agent**     **Responsibility**   **Input**             **Output**
  ------------- -------------------- --------------------- -------------------
  **PM Agent**  Requirements & user  Raw prompt            PRD document, user
                stories                                    stories, acceptance
                                                           criteria

  **Architect   System design        PRD + constraints     Architecture
  Agent**                                                  diagram, tech
                                                           stack, ADRs

  **Backend     API & database       Architecture spec     OpenAPI schema, DB
  Agent**       design                                     migrations, service
                                                           code

  **Frontend    UI/UX implementation Architecture + API    React components,
  Agent**                            spec                  routing, state
                                                           management

  **DevOps      Infrastructure &     Tech stack            Dockerfile, K8s
  Agent**       CI/CD                                      manifests, GitHub
                                                           Actions

  **QA Agent**  Test suite           Codebase              Unit tests,
                generation                                 integration tests,
                                                           E2E tests

  **Security    Security review      Full codebase         Vulnerability
  Agent**                                                  report, OWASP
                                                           checklist, fixes
  ----------------------------------------------------------------------------

**3.3 Context Management**

Each project maintains a persistent context graph enabling agents to
reason over the entire codebase:

-   Code Graph: AST-based representation of all files, functions, and
    dependencies

-   RAG Pipeline: Chunked embeddings stored in pgvector for semantic
    code search

-   Conversation Memory: Full interaction history per project (LangChain
    memory)

-   Architecture ADR Log: All decisions recorded with rationale for
    future reference

**3.4 AI Orchestration Engine**

To prevent "agent chaos" and ensure deterministic code generation, 
the system utilizes a rigorous Orchestration Engine powered by LangGraph:

**Task Graph & Dependency DAG:**
1. **Task Planner:** The PM Agent breaks the user's prompt into a structured Task DAG.
2. **Execution Manager:** LangGraph schedules tasks to Celery workers based on the DAG.
3. **Dependency Resolution:**
   - *Sequential:* `PM` → `Architect` → `Database`
   - *Parallel:* `Backend API` + `Frontend UI` + `DevOps CI/CD`
   - *Gatekeepers:* `QA Agent` and `Security Agent` block final merge until passing.
4. **State Passing Protocol:** Agents do not chat freely. They output structured JSON state diffs (added files, updated ADRs, schema changes) that are merged into the global project state graph.

**3.5 AI Cost Control & Token Optimization**

Given that generating a full project requires 20-50 LLM calls, costs are aggressively optimized:

**LLM Routing Table:**
  -------------------------------------------------------------------------
  **Task Type**           **Model Tier**          **Example Model**
  ----------------------- ----------------------- -------------------------
  Reasoning / Planning    Tier 1 (Frontier)       Claude 3.5 Sonnet, GPT-4o
  Code Generation         Tier 2 (Fast/Cheap)     Claude 3.5 Haiku, Gemini Flash
  Error Fixes / Lints     Tier 3 (Local/OSS)      Llama-3 70B
  -------------------------------------------------------------------------

**Optimization Techniques:**
- **Prompt Caching:** System context, rules, and project PRDs are cached using API prompt caching (reduces input token cost by ~90%).
- **AST-Based Context Pruning:** RAG pipeline extracts and sends only relevant AST nodes (function signatures, type definitions) instead of full files.
- **Token Budgets:** Hard cap of 500k tokens per generation run to prevent runaway loops.

**4. Microservices Architecture**

**4.1 Service Inventory**

  -----------------------------------------------------------------------
  **Service**            **Port**               **Responsibility**
  ---------------------- ---------------------- -------------------------
  api-gateway            8000                   Kong --- routing, auth
                                                validation, rate
                                                limiting, SSL termination

  auth-service           8001                   Keycloak --- user
                                                registration, login,
                                                OAuth2, JWT issuance

  project-service        8002                   Project CRUD, Git
                                                operations, file tree
                                                management

  ai-service             8003                   LangGraph orchestrator,
                                                agent execution,
                                                streaming SSE

  execution-service      8004                   Firecracker VM
                                                management, code
                                                execution, output
                                                streaming

  collab-service         8005                   Yjs CRDT WebSocket
                                                server, presence, cursor
                                                sync

  billing-service        8006                   Stripe integration, usage
                                                metering, plan
                                                enforcement

  notification-service   8007                   WebSocket push, email
                                                (SES), in-app
                                                notifications

  search-service         8008                   Elasticsearch --- code
                                                search, project discovery

  storage-service        8009                   S3/MinIO proxy --- file
                                                uploads, artifact storage

  analytics-service      8010                   Usage tracking,
                                                telemetry, feature flag
                                                evaluation

  deployment-service     8011                   One-click deploy to
                                                Vercel, Railway, AWS,
                                                GCP, Azure

  websocket-gateway      8012                   Central WebSocket
                                                multiplexer --- single
                                                WS per user, channel
                                                routing (collab,
                                                terminal, notifications)

  background-worker      N/A (worker)           Celery/Dramatiq async
                                                workers --- embeddings,
                                                emails, usage
                                                aggregation, cleanup,
                                                AI code scanning
  -----------------------------------------------------------------------

**4.2 Inter-Service Communication**

  -----------------------------------------------------------------------
  **Pattern**                         **Usage**
  ----------------------------------- -----------------------------------
  REST / HTTP                         Synchronous request-response
                                      between services (internal)

  WebSocket (WSS)                     Real-time: editor sync, terminal
                                      output, AI streaming

  Kafka Topics                        Async events: project created,
                                      build completed, deploy triggered

  gRPC                                High-performance internal calls:
                                      execution ↔ AI service

  Server-Sent Events                  AI agent streaming output to
                                      browser
  -----------------------------------------------------------------------

**4.3 Execution Service --- Firecracker VM Lifecycle**

+-----------------------------------------------------------------------+
| Request: POST /execute {project_id, language, code}                   |
|                                                                       |
| │                                                                     |
|                                                                       |
| ├─ 1. Check pool for warm VM (Redis lookup) ─ HIT: assign in \~10ms   |
|                                                                       |
| │ MISS: cold start                                                    |
|                                                                       |
| │                                                                     |
|                                                                       |
| ├─ 2. Cold Start Sequence (\~125ms):                                  |
|                                                                       |
| │ └─ containerd pulls rootfs snapshot                                 |
|                                                                       |
| │ └─ Firecracker spawns microVM (KVM)                                 |
|                                                                       |
| │ └─ jailer isolates process (chroot + seccomp)                       |
|                                                                       |
| │ └─ Mount project filesystem (overlayFS)                             |
|                                                                       |
| │                                                                     |
|                                                                       |
| ├─ 3. Code Injection: rsync project files into VM                     |
|                                                                       |
| │                                                                     |
|                                                                       |
| ├─ 4. Execution: run command inside VM                                |
|                                                                       |
| │ └─ stdout/stderr → WebSocket → browser                              |
|                                                                       |
| │                                                                     |
|                                                                       |
| ├─ 5. Resource Enforcement (Pro/Cloud Tier):                            |
|                                                                       |
| │ └─ CPU: 1 vCPU (cgroup limit)                                       |
|                                                                       |
| │ └─ Memory: 512MB hard limit                                         |
|                                                                       |
| │ └─ Disk: 2GB overlay                                                |
|                                                                       |
| │ └─ Network: egress allowlist only                                   |
|                                                                       |
| │ └─ Time: 30s max execution timeout                                  |
|                                                                       |
| │                                                                     |
|                                                                       |
| └─ 6. Post-execution: snapshot state, return VM to pool               |
+-----------------------------------------------------------------------+

**4.4 Hybrid Execution Architecture (Cost Optimizer)**

To drastically reduce server overhead (targeting ~100% compute cost reduction for standard sessions), the platform operates on a **Hybrid Execution Model**, similar to StackBlitz's WebContainers:

**Tier 1: Browser Runtime (WebContainers / WASM) — Default**
All Free tier and standard web projects execute *entirely within the user's browser*.
- **No Server Compute:** Code execution, Node.js process simulation, and terminal commands (`npm install`, `npm run dev`) run via WebAssembly using the local CPU/RAM.
- **Virtual Network:** Requests to `localhost:3000` are internally mapped by a Service Worker to the browser's iframe preview.
- **Virtual File System:** Project files are synced and stored in the user's IndexedDB / OPFS.

**Tier 2: Cloud VM Strategy (Firecracker) — Pro/Fallback**
Used only when the browser runtime is insufficient:
- Languages that cannot run efficiently in WASM (Java, heavy C++).
- Docker composition required (database containers).
- Pro subscribers demanding consistent, heavy compile times (e.g., Rust compilation).

**4.5 Cloud Build & Runtime System (For Tier 2)**

To execute AI-generated code, the platform provides a dedicated Build Service and Runner:

**Language Runtime Management (Rootfs):**
Pre-built Docker-compatible rootfs images optimize VM boot times and provide standardized environments:
- `base-node:20` (Loaded with npm, yarn, pnpm)
- `base-python:3.11` (Loaded with pip, poetry, uv)
- `base-go:1.22`
- `base-rust:1.76`

**Dependency Installer:**
When the AI Backend/Frontend agent adds dependencies, the `project-service` invokes the Package Manager API. This runs the respective installer (`npm install`, `pip install`) inside the VM via gRPC, caching the `node_modules` or `.venv` to the persistent EBS/overlayFS before the application runs.

**CI Runner & Process Manager:**
1. **Build Step:** Compiles assets (e.g., `npm run build`, `tsc`, `go build`).
2. **Execution:** The built artifact runs via a supervisor process (e.g., PM2 for Node). 
3. **Port Binding:** The application binds to `0.0.0.0:3000` inside the VM, which is reverse-proxied by the Gateway to the user's Live Preview iframe.
4. **Log Streaming:** `stdout`/`stderr` are piped continuously via WebSocket to the frontend IDE Terminal.

**5. Database Design**

**5.1 Database Architecture**

  -----------------------------------------------------------------------
  **Database**                        **Usage**
  ----------------------------------- -----------------------------------
  PostgreSQL (Primary)                Users, projects, organizations,
                                      billing, audit logs

  PostgreSQL + pgvector               Code embeddings for RAG-based AI
                                      context

  Redis Cluster                       Sessions, VM pool state, pub/sub,
                                      distributed locks

  Elasticsearch                       Full-text code search, log
                                      aggregation

  S3 / MinIO                          Source files, build artifacts, user
                                      uploads
  -----------------------------------------------------------------------

**5.2 Core Schema**

**5.2.1 Users & Organizations**

+-----------------------------------------------------------------------+
| TABLE users                                                           |
|                                                                       |
| id UUID PRIMARY KEY DEFAULT gen_random_uuid()                         |
| email VARCHAR(255) UNIQUE NOT NULL                                    |
| username VARCHAR(50) UNIQUE NOT NULL                                  |
| hashed_password TEXT                                                  |
| full_name VARCHAR(255)                                                |
| avatar_url TEXT                                                       |
| -- NOTE: plan is NOT stored here. It is derived from the              |
| --   subscriptions table (SSOT). See billing-service §SSOT Rule.      |
| stripe_customer_id VARCHAR(255) UNIQUE                                |
| is_verified BOOLEAN DEFAULT false                                     |
| is_active BOOLEAN DEFAULT true                                        |
| mfa_enabled BOOLEAN DEFAULT false                                     |
| mfa_secret TEXT -- Encrypted TOTP secret                              |
| last_active_at TIMESTAMPTZ                                            |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
| updated_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE oauth_accounts                                                  |
| id UUID PRIMARY KEY                                                   |
| user_id UUID REFERENCES users(id)                                     |
| provider ENUM('github','google','gitlab')                             |
| provider_user_id VARCHAR(255) NOT NULL                                |
| access_token TEXT -- Encrypted                                        |
| refresh_token TEXT -- Encrypted                                       |
| token_expires_at TIMESTAMPTZ                                          |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE refresh_tokens  ← NEW                                          |
| id UUID PRIMARY KEY                                                   |
| user_id UUID REFERENCES users(id) ON DELETE CASCADE                   |
| token_hash VARCHAR(64) UNIQUE NOT NULL                                |
| device_info JSONB -- {browser, os, ip}                                |
| expires_at TIMESTAMPTZ NOT NULL                                       |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE api_keys  ← NEW                                                |
| id UUID PRIMARY KEY                                                   |
| user_id UUID REFERENCES users(id) ON DELETE CASCADE                   |
| name VARCHAR(100) NOT NULL                                            |
| key_prefix VARCHAR(8) NOT NULL -- Show in UI: 'sk_live_abcd...'       |
| key_hash VARCHAR(64) UNIQUE NOT NULL                                  |
| scopes JSONB NOT NULL -- ['projects:read','ai:generate']              |
| last_used_at TIMESTAMPTZ                                              |
| expires_at TIMESTAMPTZ                                                |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE user_settings  ← NEW                                           |
| user_id UUID PRIMARY KEY REFERENCES users(id)                         |
| theme ENUM('dark','light','system') DEFAULT 'dark'                    |
| editor_font_size INTEGER DEFAULT 14                                   |
| editor_tab_size INTEGER DEFAULT 2                                     |
| keybindings ENUM('default','vim','emacs') DEFAULT 'default'           |
| ai_model_preference VARCHAR(50)                                       |
| notification_prefs JSONB                                              |
| updated_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE organizations                                                   |
| id UUID PRIMARY KEY DEFAULT gen_random_uuid()                         |
| name VARCHAR(255) NOT NULL                                            |
| slug VARCHAR(100) UNIQUE NOT NULL                                     |
| owner_id UUID REFERENCES users(id)                                    |
| plan ENUM('team','enterprise') NOT NULL                               |
| seat_limit INTEGER DEFAULT 5                                          |
| logo_url TEXT                                                         |
| stripe_subscription_id VARCHAR(255) UNIQUE                            |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE org_members                                                     |
| org_id UUID REFERENCES organizations(id) ON DELETE CASCADE            |
| user_id UUID REFERENCES users(id) ON DELETE CASCADE                   |
| role ENUM('owner','admin','developer','viewer')                       |
| invited_by UUID REFERENCES users(id)                                  |
| joined_at TIMESTAMPTZ DEFAULT now()                                   |
| PRIMARY KEY (org_id, user_id)                                         |
+-----------------------------------------------------------------------+

**5.2.2 Projects & Files**

+-----------------------------------------------------------------------+
| TABLE projects                                                        |
| id UUID PRIMARY KEY DEFAULT gen_random_uuid()                         |
| owner_id UUID REFERENCES users(id)                                    |
| org_id UUID REFERENCES organizations(id)                              |
| name VARCHAR(255) NOT NULL                                            |
| slug VARCHAR(100) NOT NULL                                            |
| description TEXT                                                      |
| template VARCHAR(100) -- 'nextjs', 'fastapi', 'blank'                |
| language VARCHAR(50) -- primary language                              |
| framework VARCHAR(100)                                                |
| visibility ENUM('private','public','org') DEFAULT 'private'           |
| status ENUM('pending','active','failed_creation','archived','deleted')|
|        DEFAULT 'pending'  -- SAGA lifecycle (see SYSTEM_BACKBONE)     |
| git_repo_url TEXT                                                     |
| -- NOTE: env vars stored in HashiCorp Vault, NOT in DB (see §2.3.4)  |
| last_opened_at TIMESTAMPTZ                                            |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
| updated_at TIMESTAMPTZ DEFAULT now()                                  |
| UNIQUE (owner_id, slug)                                               |
|                                                                       |
| TABLE project_files  (updated — see §2.4 File Sync)                  |
| id UUID PRIMARY KEY                                                   |
| project_id UUID REFERENCES projects(id) ON DELETE CASCADE             |
| branch_id UUID REFERENCES project_branches(id) -- see ERD             |
| parent_id UUID REFERENCES project_files(id) -- dir tree               |
| path TEXT NOT NULL -- e.g. 'src/app/page.tsx'                         |
| name VARCHAR(255) NOT NULL                                            |
| content_hash VARCHAR(64) -- SHA-256                                   |
| s3_key TEXT -- S3 object key (null if inline)                         |
| inline_content BYTEA -- Direct content for files <64KB                |
| size_bytes INTEGER                                                    |
| language VARCHAR(50)                                                  |
| is_directory BOOLEAN NOT NULL                                         |
| created_by UUID REFERENCES users(id)                                  |
| updated_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE project_snapshots                                               |
| id UUID PRIMARY KEY                                                   |
| project_id UUID REFERENCES projects(id) ON DELETE CASCADE             |
| firecracker_vm_id VARCHAR(255)                                        |
| snapshot_path TEXT -- S3 path                                         |
| size_bytes BIGINT                                                     |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE project_collaborators                                           |
| project_id UUID REFERENCES projects(id) ON DELETE CASCADE             |
| user_id UUID REFERENCES users(id) ON DELETE CASCADE                   |
| role ENUM('owner','editor','viewer')                                  |
| invited_by UUID REFERENCES users(id)                                  |
| PRIMARY KEY (project_id, user_id)                                     |
|                                                                       |
| TABLE invitations  ← NEW                                             |
| id UUID PRIMARY KEY                                                   |
| project_id UUID REFERENCES projects(id) ON DELETE CASCADE             |
| email VARCHAR(255) NOT NULL                                           |
| role ENUM('editor','viewer') DEFAULT 'editor'                         |
| invited_by UUID REFERENCES users(id)                                  |
| token VARCHAR(255) UNIQUE NOT NULL -- email invite link               |
| status ENUM('pending','accepted','expired')                           |
| expires_at TIMESTAMPTZ NOT NULL                                       |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
+-----------------------------------------------------------------------+

**5.2.3 AI Conversations & Executions**

+-----------------------------------------------------------------------+
| TABLE ai_conversations                                                |
| id UUID PRIMARY KEY DEFAULT gen_random_uuid()                         |
| project_id UUID REFERENCES projects(id) ON DELETE CASCADE             |
| user_id UUID REFERENCES users(id)                                     |
| title TEXT                                                            |
| agent_plan JSONB -- orchestrator execution plan                       |
| status ENUM('queued','running','completed','failed','cancelled')      |
| total_tokens INTEGER DEFAULT 0  -- standardized with ERD              |
| total_cost_usd NUMERIC(10,6) DEFAULT 0  -- USD, not cents             |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE ai_messages                                                     |
| id UUID PRIMARY KEY DEFAULT gen_random_uuid()                         |
| conversation_id UUID REFERENCES ai_conversations(id) ON DELETE CASCADE|
| agent_name VARCHAR(50) -- 'pm', 'architect', 'backend', etc.          |
| role ENUM('user','assistant','system','tool')                         |
| content TEXT NOT NULL                                                 |
| metadata JSONB -- file changes, diffs, tool calls                     |
| tokens_used INTEGER                                                   |
| model_used VARCHAR(50) -- 'claude-3.5-sonnet', 'gpt-4o' (fallback)   |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE ai_generated_files  ← NEW                                      |
| id UUID PRIMARY KEY                                                   |
| conversation_id UUID REFERENCES ai_conversations(id)                  |
| file_path TEXT NOT NULL                                               |
| content TEXT NOT NULL                                                 |
| language VARCHAR(50)                                                  |
| agent_name VARCHAR(50)                                                |
| status ENUM('pending','accepted','rejected','modified')               |
| snapshot_content TEXT -- Previous version for rollback                 |
| version INTEGER DEFAULT 1                                             |
| previous_version_id UUID REFERENCES ai_generated_files(id)            |
| applied_at TIMESTAMPTZ                                                |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE code_issues  ← NEW                                             |
| id UUID PRIMARY KEY                                                   |
| project_id UUID REFERENCES projects(id) ON DELETE CASCADE             |
| conversation_id UUID REFERENCES ai_conversations(id)                  |
| file_path TEXT NOT NULL                                               |
| line_start INTEGER                                                    |
| line_end INTEGER                                                      |
| severity ENUM('critical','high','medium','low','info')                |
| category ENUM('security','performance','style','bug','a11y')          |
| message TEXT NOT NULL                                                 |
| suggested_fix TEXT                                                    |
| is_resolved BOOLEAN DEFAULT false                                     |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE code_embeddings                                                 |
| id UUID PRIMARY KEY                                                   |
| project_id UUID REFERENCES projects(id) ON DELETE CASCADE             |
| file_path TEXT NOT NULL                                               |
| chunk_index INTEGER NOT NULL                                          |
| content TEXT NOT NULL                                                 |
| embedding VECTOR(1024) -- pgvector, text-embedding-3-large            |
| model_name VARCHAR(50) DEFAULT 'text-embedding-3-large'               |
| updated_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE code_executions                                                 |
| id UUID PRIMARY KEY DEFAULT gen_random_uuid()                         |
| project_id UUID REFERENCES projects(id)                               |
| user_id UUID REFERENCES users(id)                                     |
| vm_id VARCHAR(255)                                                    |
| command TEXT NOT NULL                                                 |
| stdout TEXT                                                           |
| stderr TEXT                                                           |
| exit_code INTEGER                                                     |
| duration_ms INTEGER                                                   |
| memory_used_mb INTEGER                                                |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE ai_feedback  ← NEW (RLHF)                                      |
| id UUID PRIMARY KEY                                                   |
| message_id UUID REFERENCES ai_messages(id) ON DELETE CASCADE          |
| user_id UUID REFERENCES users(id)                                     |
| rating INTEGER NOT NULL -- 1 to 5 stars                               |
| user_comment TEXT                                                     |
| agent_name VARCHAR(50)                                                |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE ai_generation_tasks  ← NEW (Prompt-to-App)                     |
| id UUID PRIMARY KEY                                                   |
| conversation_id UUID REFERENCES ai_conversations(id)                  |
| project_id UUID REFERENCES projects(id)                               |
| status ENUM('pending','architect','db_setup','ui','complete','failed')|
| current_agent VARCHAR(50)                                             |
| progress_percent INTEGER -- 0-100                                     |
| started_at TIMESTAMPTZ                                                |
| completed_at TIMESTAMPTZ                                              |
+-----------------------------------------------------------------------+

**5.2.4 Billing, Usage & Notifications**

+-----------------------------------------------------------------------+
| TABLE subscriptions  (existing)                                       |
| -- See ERD for full field list                                        |
|                                                                       |
| TABLE usage_records  (existing)                                       |
| -- See ERD for full field list                                        |
|                                                                       |
| TABLE usage_daily  ← NEW                                             |
| id UUID PRIMARY KEY                                                   |
| user_id UUID REFERENCES users(id) ON DELETE CASCADE                   |
| date DATE NOT NULL                                                    |
| ai_requests INTEGER DEFAULT 0                                         |
| compute_seconds INTEGER DEFAULT 0                                     |
| storage_bytes_delta BIGINT DEFAULT 0                                  |
| api_calls INTEGER DEFAULT 0                                           |
| UNIQUE (user_id, date)                                                |
|                                                                       |
| TABLE notifications  ← NEW                                           |
| id UUID PRIMARY KEY                                                   |
| user_id UUID REFERENCES users(id) ON DELETE CASCADE                   |
| type ENUM('info','success','warning','error','ai_complete')           |
| title VARCHAR(255) NOT NULL                                           |
| message TEXT                                                          |
| action_url TEXT                                                       |
| is_read BOOLEAN DEFAULT false                                         |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
+-----------------------------------------------------------------------+

**5.2.5 Deployments & Audit**

+-----------------------------------------------------------------------+
| TABLE deployments                                                     |
| id UUID PRIMARY KEY                                                   |
| project_id UUID REFERENCES projects(id) ON DELETE CASCADE             |
| user_id UUID REFERENCES users(id)                                     |
| provider ENUM('vercel','railway','aws','gcp','azure')                 |
| status ENUM('pending','building','deployed','failed')                 |
| url TEXT -- Live deployment URL                                       |
| build_log_s3_key TEXT                                                 |
| env_snapshot JSONB -- AES-256 encrypted env vars at deploy time       |
| environment ENUM('preview','staging','production')                    |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
| updated_at TIMESTAMPTZ DEFAULT now()                                  |
|                                                                       |
| TABLE audit_logs                                                      |
| id UUID PRIMARY KEY                                                   |
| user_id UUID REFERENCES users(id)                                     |
| org_id UUID REFERENCES organizations(id)                              |
| action VARCHAR(100) NOT NULL -- e.g. 'project.delete', 'user.login'  |
| resource_type VARCHAR(50) -- 'project','user','org','deployment'      |
| resource_id UUID                                                      |
| ip_address INET                                                       |
| user_agent TEXT                                                       |
| metadata JSONB -- Action-specific details                             |
| created_at TIMESTAMPTZ DEFAULT now()                                  |
+-----------------------------------------------------------------------+

**Schema Summary: All tables across 7 schema groups.**
For the complete interactive ERD with all fields, constraints,
and relationships, see: Interactive_Schema_Design_ERD.md

**6. API Design**

**6.1 API Conventions**

-   Base URL: https://api.yourplatform.io/v1

-   Authentication: Bearer JWT (access token, 15min expiry) + Refresh
    token (7 days)

-   Versioning: URL-based (/v1, /v2) with 12-month deprecation policy

-   Rate Limiting: Per-user sliding window via Kong (Free: 60 req/min,
    Pro: 600 req/min)

-   Pagination: Cursor-based for all list endpoints (no offset
    pagination)

-   Errors: RFC 7807 Problem Details JSON format

**6.2 Core API Endpoints**

**Authentication**

  --------------------------------------------------------------------------------
  **Method**    **Endpoint**             **Auth**              **Description**
  ------------- ------------------------ --------------------- -------------------
  **POST**      /auth/register           None                  Create new user
                                                               account

  **POST**      /auth/login              None                  Email/password
                                                               login → JWT pair

  **POST**      /auth/refresh            Refresh token         Rotate access +
                                                               refresh tokens

  **POST**      /auth/logout             Bearer                Revoke refresh
                                                               token

  **POST**      /auth/oauth/{provider}   None                  GitHub / Google
                                                               OAuth2 callback

  **GET**       /auth/me                 Bearer                Get current user
                                                               profile
  --------------------------------------------------------------------------------

**Projects**

  -------------------------------------------------------------------------------------
  **Method**    **Endpoint**                  **Auth**              **Description**
  ------------- ----------------------------- --------------------- -------------------
  **GET**       /projects                     Bearer                List user\'s
                                                                    projects (cursor
                                                                    paginated)

  **POST**      /projects                     Bearer                Create project from
                                                                    template or blank

  **GET**       /projects/{id}                Bearer                Get project
                                                                    metadata

  **PATCH**     /projects/{id}                Bearer                Update name,
                                                                    description,
                                                                    visibility

  **DELETE**    /projects/{id}                Bearer + owner        Delete project and
                                                                    all resources

  **GET**       /projects/{id}/files          Bearer                Get file tree
                                                                    (recursive)

  **PUT**       /projects/{id}/files/{path}   Bearer                Create or update a
                                                                    file

  **DELETE**    /projects/{id}/files/{path}   Bearer                Delete a file

  **POST**      /projects/{id}/fork           Bearer                Fork project to own
                                                                    account

  **POST**      /projects/{id}/invite         Bearer + owner        Invite collaborator
                                                                    by email
  -------------------------------------------------------------------------------------

**AI Orchestration**

  ------------------------------------------------------------------------------
  **Method**    **Endpoint**           **Auth**              **Description**
  ------------- ---------------------- --------------------- -------------------
  **POST**      /ai/generate           Bearer                Start multi-agent
                                                             generation from
                                                             prompt

  **GET**       /ai/stream/{conv_id}   Bearer                SSE stream of agent
                                                             outputs

  **GET**       /ai/conversations      Bearer                List project
                                                             conversations

  **POST**      /ai/chat               Bearer                Single-turn AI chat
                                                             within project
                                                             context

  **POST**      /ai/review             Bearer                Trigger AI code
                                                             review on project

  **POST**      /ai/fix/{issue_id}     Bearer                Apply AI-suggested
                                                             fix to codebase

  **GET**       /ai/status/{conv_id}   Bearer                Get generation
                                                             progress, agent
                                                             states, ETA

  **POST**      /ai/retry/{conv_id}    Bearer                Retry specific
                                                             failed agents
                                                             (body: agents[])

  **POST**      /ai/cancel/{conv_id}   Bearer                Cancel running
                                                             generation, keep
                                                             partial results
  ------------------------------------------------------------------------------

**Package Manager**

  -----------------------------------------------------------------------------------------
  **Method**    **Endpoint**                   **Auth**              **Description**
  ------------- ------------------------------ --------------------- ----------------------
  **GET**       /projects/{id}/packages        Bearer                List installed
                                                                     packages with versions

  **GET**       /projects/{id}/packages/       Bearer                Check for available
                outdated                                             updates

  **POST**      /projects/{id}/packages/       Bearer                Install package
                install                                              (runs in VM terminal)

  **POST**      /projects/{id}/packages/       Bearer                Uninstall package
                remove

  **GET**       /packages/search               None                  Search npm/PyPI
                                                                     registries
  -----------------------------------------------------------------------------------------

**Environment Variables**

  -----------------------------------------------------------------------------------------
  **Method**    **Endpoint**                   **Auth**              **Description**
  ------------- ------------------------------ --------------------- ----------------------
  **GET**       /projects/{id}/env-vars        Bearer                List env var keys
                                                                     (values masked)

  **POST**      /projects/{id}/env-vars        Bearer                Add env var (stored
                                                                     in Vault, not DB)

  **PATCH**     /projects/{id}/env-vars/{key}  Bearer                Update env var value

  **DELETE**    /projects/{id}/env-vars/{key}  Bearer                Remove env var

  **POST**      /projects/{id}/env-vars/       Bearer                Import from .env
                import                                               file upload
  -----------------------------------------------------------------------------------------

**Execution & Deployment**

  -----------------------------------------------------------------------------------------
  **Method**    **Endpoint**                   **Auth**              **Description**
  ------------- ------------------------------ --------------------- ----------------------
  **POST**      /exec/run                      Bearer                Execute code in
                                                                     sandboxed microVM

  **GET**       /exec/ws/{session_id}          Bearer (WS)           WebSocket terminal
                                                                     session

  **POST**      /exec/install                  Bearer                Install packages
                                                                     (npm/pip/etc)

  **POST**      /deploy/preview                Bearer                Deploy to ephemeral
                                                                     preview URL

  **POST**      /deploy/production             Bearer + Pro          Deploy to production
                                                                     (Vercel/Railway/AWS)

  **GET**       /deploy/history/{project_id}   Bearer                List deployment
                                                                     history
  -----------------------------------------------------------------------------------------

**Search & Discovery**

  -----------------------------------------------------------------------------------------
  **Method**    **Endpoint**                   **Auth**              **Description**
  ------------- ------------------------------ --------------------- ----------------------
  **GET**       /search/code                   Bearer                Full-text code search
                                                                     within project

  **GET**       /search/projects               Bearer (optional)     Discover public
                                                                     projects

  **GET**       /search/files                  Bearer                Search files by name
                                                                     across project
  -----------------------------------------------------------------------------------------

**Git Operations**

  -----------------------------------------------------------------------------------------
  **Method**    **Endpoint**                   **Auth**              **Description**
  ------------- ------------------------------ --------------------- ----------------------
  **POST**      /projects/{id}/git/commit      Bearer                Create a commit with
                                                                     message

  **POST**      /projects/{id}/git/push        Bearer                Push to remote origin

  **GET**       /projects/{id}/git/log         Bearer                Get commit history

  **POST**      /projects/{id}/git/branch      Bearer                Create/switch branch

  **GET**       /projects/{id}/git/diff        Bearer                Get working tree diff

  **POST**      /projects/{id}/git/pull        Bearer                Pull from remote

  **GET**       /projects/{id}/git/status      Bearer                Working tree
                                                                     status: staged,
                                                                     modified, untracked
  -----------------------------------------------------------------------------------------

  Git Architecture: Every project has a git repo inside its VM.
  git init on project creation, auto .gitignore per template.
  Push/Pull use user's GitHub OAuth token. Branches reflected
  in file tree and Monaco buffers.

  Response schemas:
  · POST /git/commit → { sha, message, timestamp }
  · POST /git/push   → { status, commits_pushed, remote_url }
  · GET  /git/log    → { commits: [{ sha, message, author, date, files_changed }] }
  · GET  /git/diff   → { files: [{ path, status, additions, deletions, patch }] }
  · GET  /git/status → { branch, staged: [...], modified: [...], untracked: [...] }

**File Content**

  -----------------------------------------------------------------------------------------
  **Method**    **Endpoint**                   **Auth**              **Description**
  ------------- ------------------------------ --------------------- ----------------------
  **GET**       /projects/{id}/files/{path}/   Bearer                Read file content
                content                                              from S3

  **POST**      /projects/{id}/import/github   Bearer                Import project from
                                                                     GitHub repository

  **GET**       /projects/{id}/download        Bearer                Download project as
                                                                     zip archive
  -----------------------------------------------------------------------------------------

**Templates & Admin**

  -----------------------------------------------------------------------------------------
  **Method**    **Endpoint**                   **Auth**              **Description**
  ------------- ------------------------------ --------------------- ----------------------
  **GET**       /templates                     None                  List available project
                                                                     templates

  **GET**       /templates/{id}                None                  Template details and
                                                                     preview

  **GET**       /admin/users                   Bearer + Admin        List/search users
                                                                     (paginated)

  **PATCH**     /admin/users/{id}              Bearer + Admin        Suspend/activate/
                                                                     change_plan

  **DELETE**    /admin/users/{id}              Bearer + Admin        Soft delete + GDPR
                                                                     data anonymization

  **GET**       /admin/users/{id}/audit-log    Bearer + Admin        User's audit trail

  **GET**       /admin/analytics/overview      Bearer + Admin        DAU, MAU, MRR,
                                                                     churn rate

  **GET**       /admin/analytics/usage         Bearer + Admin        AI calls, compute
                                                                     hours, storage used

  **GET**       /admin/analytics/revenue       Bearer + Admin        Revenue by plan,
                                                                     growth trends

  **GET**       /admin/reports                 Bearer + Admin        Reported projects/
                                                                     users list

  **PATCH**     /admin/reports/{id}            Bearer + Admin        Dismiss / warn / ban

  **GET**       /admin/flagged-code            Bearer + Admin        AI-flagged malicious
                                                                     code review

  **GET**       /admin/feature-flags           Bearer + Admin        List all flags

  **POST**      /admin/feature-flags           Bearer + Admin        Create flag with
                                                                     target plans

  **PATCH**     /admin/feature-flags/{id}      Bearer + Admin        Toggle flag

  **GET**       /admin/health                  Bearer + Admin        All service health

  **GET**       /admin/queues                  Bearer + Admin        Celery queue depths,
                                                                     DLQ item count

  **POST**      /admin/maintenance             Bearer + Admin        Toggle maintenance
                                                                     mode with message
  -----------------------------------------------------------------------------------------

**6.3 Background Job System**

The platform uses Celery (Python) with Redis as broker for async job
processing. 5 separate queues handle different priority levels:

  Queue config: ai (2 workers), email (10), cleanup (5),
  embedding (3, CPU-heavy), usage (2, scheduled)

  -----------------------------------------------------------------------
  **Task Name**                       **Trigger**      **Priority**
  ----------------------------------- ---------------- -----------------
  AI TASKS (queue: ai)
  ai.generate_orchestrate             User prompt      HIGH
  ai.scan_generated_code              After AI gen     MEDIUM
  ai.fallback_provider                Primary fails    HIGH

  EMBEDDING TASKS (queue: embedding)
  embedding.update_file               File save        MEDIUM
  embedding.full_reindex              Project import   LOW
  embedding.remove_file               File delete      LOW

  EMAIL TASKS (queue: email)
  email.send_verification             User register    HIGH
  email.send_invitation               Project invite   MEDIUM
  email.send_deploy_status            Deploy complete  MEDIUM
  email.send_usage_alert              80% plan limit   MEDIUM

  CLEANUP TASKS (queue: cleanup)
  cleanup.idle_vms                    Scheduled 1hr    LOW
  cleanup.expired_invitations         Scheduled daily  LOW
  cleanup.orphan_s3                   Scheduled weekly LOW
  cleanup.archive_projects            Scheduled daily  LOW
  cleanup.expired_tokens              Scheduled hourly LOW

  USAGE TASKS (queue: usage)
  usage.aggregate_daily               Scheduled daily  MEDIUM
  usage.generate_monthly_report       Scheduled monthly LOW
  usage.sync_stripe_usage             Scheduled hourly MEDIUM

  NOTIFICATION TASKS
  notify.push_websocket               Event-driven     HIGH
  notify.persist_notification         Event-driven     MEDIUM
  -----------------------------------------------------------------------

  Retry: 3 attempts with exponential backoff (60s, 120s, 240s).
  DLQ: Failed tasks after max_retries → Redis list "dlq:{task_name}"
       → Alert to PagerDuty (critical) / Slack (others)
       → Admin dashboard for manual retry/dismiss.
  Crash recovery: task_acks_late=True → re-queue on worker crash.

**6.4 WebSocket Gateway Strategy**

Instead of maintaining 3+ separate WebSocket connections per user,
a central WebSocket Gateway multiplexes all real-time communication
over a single connection with channel-based routing:

**Message Protocol (JSON):**

  Client → Server: { type: subscribe|unsubscribe|message,
                     channel: "collab:proj-123", payload: {...} }
  Server → Client: { type: data|error|ack|system,
                     channel: "...", payload: {...}, timestamp: ... }

**Channel Routing Table:**

  --------------------------------------------------------------------------------
  **Channel**                         **Routes To**          **Protocol**
  ----------------------------------- ---------------------- ---------------------
  collab:{project_id}:{file_id}       collab-service         Yjs binary
  awareness:{project_id}:{file_id}    collab-service         Yjs binary
  terminal:{session_id}               execution-service      UTF-8 stream
  notifications:{user_id}             notification-service   JSON events
  ai:{conversation_id}                ai-service             SSE-like JSON
  lsp:{project_id}:{lang}             execution-service      JSON-RPC (LSP)
  preview:{project_id}                execution-service      HMR events
  --------------------------------------------------------------------------------

**Connection Lifecycle:**

+-----------------------------------------------------------------------+
| 1. CONNECT: wss://ws.platform.io/gateway?token=JWT                    |
|    → Validate JWT → Redis: ws:{conn_id} = {user_id, channels:[]}     |
|                                                                       |
| 2. SUBSCRIBE: {type:subscribe, channel:"collab:proj1:file1"}          |
|    → Check access → Redis SADD channel:collab:proj1:file1 conn_id    |
|    → Forward to collab-service: new subscriber                        |
|                                                                       |
| 3. MESSAGE: {type:message, channel:"terminal:s-1", payload:"ls\n"}   |
|    → Route to execution-service → stdout → Gateway → Client          |
|                                                                       |
| 4. UNSUBSCRIBE: on file close or panel switch                         |
|    → Remove from channel, notify backend service                      |
|                                                                       |
| 5. DISCONNECT: browser close / network drop                          |
|    → Cleanup all subscriptions → notify services                      |
|    → Redis DEL ws:{conn_id}                                           |
|                                                                       |
| 6. HEARTBEAT: Client ping every 30s                                   |
|    → No ping for 90s → assume disconnected → cleanup                  |
+-----------------------------------------------------------------------+

**6.5 Caching Strategy (Redis)**

**Complete Cache Key Patterns:**

  -----------------------------------------------------------------------
  **Cache Key Pattern**               **TTL**    **Invalidation**
  ----------------------------------- ---------- -------------------------
  USER DATA
  user:{id}:profile                   15 min     On profile update
  user:{id}:settings                  30 min     On settings change
  user:{id}:plan                      5 min      On subscription webhook
  user:{id}:sessions                  7 days     On login/logout

  PROJECT DATA
  project:{id}:meta                   10 min     On project update
  project:{id}:tree                   5 min      On file create/delete
  project:{id}:collabs                10 min     On collaborator change
  project:{id}:vm                     No TTL     On VM assign/release

  RATE LIMITING
  rate:{user_id}:{endpoint}           1 min      Sliding window
  ai_limit:{user_id}:{date}           24 hr      Daily AI request counter
  login_attempts:{email}              15 min     On successful login

  VM MANAGEMENT
  vm_pool:{language}                  No TTL     On VM assign/release
  vm_active:{vm_id}                   No TTL     On VM lifecycle events
  vm_project:{project_id}             No TTL     On VM assign

  PLATFORM
  templates:all                       1 hour     On admin template change
  features:{flag_name}                5 min      On admin flag toggle
  platform:maintenance                No TTL     On admin toggle

  REAL-TIME
  presence:{project_id}:{file_id}     30 sec     On cursor move
  ws:{connection_id}                  No TTL     On connect/disconnect
  ai_job:{conversation_id}            1 hr       On AI generation progress
  -----------------------------------------------------------------------

**Cache Invalidation Events:**

  User profile update → DEL user:{id}:profile
  User plan change → DEL user:{id}:plan, user:{id}:profile
  File create/delete → DEL project:{id}:tree
  Collaborator add/remove → DEL project:{id}:collabs
  Subscription webhook → DEL user:{id}:plan
  User logout → SREM user:{id}:sessions {token}
  Template change → DEL templates:all

  Pattern: Cache-aside with decorator. On write → invalidate.
  No cache-through. Small Redis memory footprint.
  Implementation: Python decorator @cached(key, ttl) on service methods.

**6.6 AI Agent Error Handling Strategy**

**Agent State Machine:**
  QUEUED → RUNNING → SUCCESS | FAILED → RETRYING | SKIPPED

**Scenario 1: Single Agent Failure**

+-----------------------------------------------------------------------+
| PM ✅ → Architect ✅ → Backend ❌ (API timeout)                        |
|                        Frontend ✅ (parallel, continues)               |
|                        DevOps ✅ (parallel, continues)                 |
|                                                                       |
| Recovery:                                                              |
| 1. Backend retries 3x with backoff (2s, 4s, 8s)                      |
| 2. If still fails: mark FAILED, continue with others                  |
| 3. QA Agent runs on available code only (partial coverage)            |
| 4. User sees: ✅PM ✅Arch ❌Backend ✅Frontend ✅DevOps                |
|    with [Retry Backend] button                                        |
| 5. On retry: only Backend re-runs with same context                   |
|    → if succeeds, QA/Security re-run on full code                     |
+-----------------------------------------------------------------------+

**Scenario 2: Claude API Outage**

+-----------------------------------------------------------------------+
| Each agent has fallback model config:                                  |
|   { primary: "claude-3.5-sonnet",                                     |
|     fallback: "gpt-4o",                                               |
|     fallback_2: "gemini-2.0-flash" }                                  |
|                                                                       |
| On primary 503 → auto-switch to fallback                              |
| If ALL providers down → queue job with ETA                            |
|   "AI services busy. Position: #3. ETA: ~2min"                        |
|   → Send notification when complete                                   |
| Health check every 30s per provider → auto-update preferred            |
+-----------------------------------------------------------------------+

**Scenario 3: Connection Drop**

+-----------------------------------------------------------------------+
| User submits prompt → 30s in → Internet drops                         |
|                                                                       |
| 1. Generation continues on server (Celery worker, NOT cancelled)      |
| 2. Each agent output saved to ai_messages immediately                 |
| 3. Conversation state in DB (not in-memory)                           |
| 4. On reconnect:                                                      |
|    GET /ai/status/{conv_id}                                           |
|    → Returns: {status, completed_agents, pending, elapsed, ETA}       |
|    → If running: reconnect to WS channel ai:{conv_id}                |
|    → If complete: show all results at once                             |
+-----------------------------------------------------------------------+

**Scenario 4: Orchestrator Crash**

+-----------------------------------------------------------------------+
| LangGraph orchestrator process dies mid-execution                     |
|                                                                       |
| 1. State checkpointed in Redis after each agent completion            |
|    Redis key: orchestrator:{conv_id} = {completed, pending, context}  |
| 2. Celery detects crash → retries from last checkpoint                |
| 3. Already-completed agents NOT re-run                                |
| 4. max_retries = 2 for orchestrator itself                            |
| 5. After 2 failures: FAILED status, partial results preserved         |
|    User can "Resume from checkpoint" later                             |
+-----------------------------------------------------------------------+

**7. Security Architecture**

**7.1 Security Layers**

Security is enforced at every layer of the stack --- no single point of
failure:

+-----------------------------------------------------------------------+
| Layer 1 --- Network: Cloudflare WAF, DDoS protection, TLS 1.3 minimum |
|                                                                       |
| Layer 2 --- Edge: Rate limiting, IP allowlisting, bot detection       |
| (Cloudflare)                                                          |
|                                                                       |
| Layer 3 --- Gateway: JWT validation, OAuth2 scopes, request signing   |
| (Kong)                                                                |
|                                                                       |
| Layer 4 --- App: RBAC, input validation (Pydantic), parameterized     |
| queries                                                               |
|                                                                       |
| Layer 5 --- VM: Firecracker KVM isolation, seccomp BPF, no root,      |
| chroot jail                                                           |
|                                                                       |
| Layer 6 --- Network VM: Egress-only allowlist, no inbound ports,      |
| private VLAN                                                          |
|                                                                       |
| Layer 7 --- Data: AES-256 encryption at rest, TLS in transit,         |
| field-level encryption                                                |
+-----------------------------------------------------------------------+

**7.2 Authentication & Authorization**

-   JWT: RS256 signed, 15-minute access tokens, 7-day rolling refresh
    tokens

-   MFA: TOTP (RFC 6238) enforced on enterprise plans, optional on Pro

-   RBAC Roles: Owner → Admin → Developer → Viewer (project-level
    granularity)

-   API Keys: Scoped, rotatable, stored as bcrypt hashes (never
    plaintext)

-   OAuth2: GitHub and Google providers via Keycloak; SAML for
    enterprise SSO

**7.3 VM Sandbox Security**

  -----------------------------------------------------------------------
  **Control**                         **Implementation**
  ----------------------------------- -----------------------------------
  Process isolation                   KVM hypervisor via Firecracker ---
                                      full VM boundary

  System call filtering               seccomp BPF allowlist --- only
                                      permitted syscalls allowed

  Filesystem isolation                chroot + overlayFS --- no access to
                                      host filesystem

  Network isolation                   Private VLAN per project,
                                      egress-only, no inter-VM routing

  Resource limits                     cgroup v2: CPU (1 vCPU), RAM
                                      (512MB), disk I/O, process count

  Execution timeout                   Hard 30-second timeout, soft
                                      10-second warning, SIGKILL on
                                      breach

  Privilege                           Non-root UID inside VM,
                                      capabilities dropped (no
                                      CAP_NET_ADMIN, etc.)
  -----------------------------------------------------------------------

**7.4 OWASP Top 10 Coverage**

  -----------------------------------------------------------------------
  **OWASP Risk**                      **Mitigation**
  ----------------------------------- -----------------------------------
  A01 Broken Access Control           RBAC enforced at gateway + app
                                      layer; project ownership validation

  A02 Cryptographic Failures          TLS 1.3, AES-256 at rest, no
                                      MD5/SHA1, secrets in Vault

  A03 Injection                       Parameterized queries (SQLAlchemy),
                                      Pydantic input validation, no
                                      eval()

  A04 Insecure Design                 Threat modeling per service;
                                      security reviews in sprint planning

  A05 Security Misconfiguration       IaC (Terraform), immutable infra,
                                      CIS benchmark scanning

  A06 Vulnerable Components           Dependabot + Snyk automated CVE
                                      scanning in CI/CD pipeline

  A07 Auth Failures                   Brute-force protection, account
                                      lockout, secure cookie flags

  A09 Logging Failures                Audit logs for all auth events,
                                      OpenTelemetry, SIEM integration
  -----------------------------------------------------------------------

**7.5 Additional Security Measures**

  -----------------------------------------------------------------------
  **Measure**                         **Implementation**
  ----------------------------------- -----------------------------------
  AI Code Scanning                    All AI-generated code is scanned
                                      by background-worker for: embedded
                                      API keys/secrets (regex + entropy),
                                      known malicious patterns, unsafe
                                      eval/exec calls, hardcoded
                                      credentials. Flagged code creates
                                      code_issues entries.

  Secret Management                   HashiCorp Vault for: env var
                                      encryption keys, DB credentials,
                                      API keys (Claude, Stripe), JWT
                                      signing keys. Auto-rotation every
                                      90 days. No secrets in env files
                                      or code.

  AI-specific Rate Limiting           Separate rate limits per AI
                                      endpoint: Free = 20 AI
                                      requests/day, Pro = 200/day,
                                      Enterprise = unlimited. Enforced
                                      via Redis counters (usage_daily
                                      table).

  Sandbox Escape Detection            eBPF-based monitoring for
                                      suspicious syscalls inside VMs.
                                      Alerts to PagerDuty on anomalous
                                      behavior. Weekly audit of VM
                                      escape vectors.

  Content Security Policy             Strict CSP headers on IDE pages:
                                      default-src 'self'; connect-src
                                      wss://*.platform.io; frame-src
                                      *.platform-preview.io (preview
                                      pane only).

  CORS Policy                         API Gateway enforces: Allow
                                      origins: platform domain only.
                                      Credentials: true. Methods: GET,
                                      POST, PUT, PATCH, DELETE, OPTIONS.
  -----------------------------------------------------------------------

**8. Scalability & Performance**

**8.1 Scalability Targets**

  -----------------------------------------------------------------------
  **Metric**                          **Target**
  ----------------------------------- -----------------------------------
  Concurrent active users             1,000,000+

  Active VM environments              500,000 simultaneous

  API response time (p99)             \< 200ms

  VM cold start time                  \< 125ms (Firecracker)

  AI streaming TTFT                   \< 1 second (time-to-first-token)

  Code execution latency              \< 100ms for warm VMs

  Real-time collab sync               \< 50ms end-to-end

  File save round-trip                \< 30ms

  Deployment availability             99.99% SLA (\< 52 min/year
                                      downtime)
  -----------------------------------------------------------------------

**8.2 Horizontal Scaling Strategy**

-   All microservices are stateless --- horizontal pod autoscaler (HPA)
    on CPU/memory/custom metrics

-   Execution Service: VM pool pre-warming based on time-of-day demand
    prediction (ML model)

-   AI Service: Queue-based load shedding with priority lanes (Pro \>
    Free)

-   Database: Read replicas for SELECT queries; connection pooling via
    PgBouncer

-   Redis: Redis Cluster (6 nodes minimum) with consistent hashing

**8.3 Cost Optimization**

-   VM Hibernation: Idle VMs snapshotted to S3 after 5 minutes, restored
    in \~2 seconds

-   Spot Instances: Execution nodes on AWS Spot/GCP Preemptible (70%
    cost reduction)

-   CDN Caching: Static assets on Cloudflare edge (TTL 1 year with
    content hashing)

-   AI Token Budget: Per-request token limits; caching repeated prompts
    with semantic similarity

-   Database Archival: Projects inactive \> 90 days moved to cold S3
    storage automatically

**8.4 Multi-Region Deployment**

+-----------------------------------------------------------------------+
| PRIMARY REGION: us-east-1 (AWS Virginia) ← Main control plane         |
|                                                                       |
| SECONDARY REGION: eu-west-1 (AWS Ireland) ← EU users, GDPR compliance |
|                                                                       |
| TERTIARY REGION: ap-southeast-1 (Singapore) ← Asia-Pacific users      |
|                                                                       |
| Routing strategy: Cloudflare Geo-routing → nearest healthy region     |
|                                                                       |
| Data residency: User data stored in region of account creation        |
|                                                                       |
| Replication: PostgreSQL streaming replication (async, \<1s lag)       |
|                                                                       |
| Failover: Automated DNS failover via Cloudflare Health Checks (\<30s  |
| RTO)                                                                  |
+-----------------------------------------------------------------------+

**8.5 VM Lifecycle & Scaling Math**

To support 10k concurrent developers without exploding memory costs (10k × 512MB = 5TB RAM), the platform implements aggressive lifecycle management:

**VM State Machine:**
1. `PRE-WARMED`: Booted with language rootfs, waiting in pool (base RAM footprint).
2. `ACTIVE`: Assigned to project, actively running code (Up to 512MB limit).
3. `IDLE`: No WebSocket or HTTP activity for 2 minutes. Memory aggressively swapped to nvme disk.
4. `HIBERNATED`: Inactive for 5 minutes. VM state snapshotted to S3, EC2 instance destroyed/recycled (0 RAM).
5. `WAKING`: User returns to browser tab. Snapshot pulled from S3, new Firecracker VM created (~2s resume).

**Real-world Scaling Math (10,000 Concurrent Users):**
- **ACTIVE (~15%):** 1,500 users actively executing code. `1,500 × 512MB = 750GB RAM`
- **IDLE (~35%):** 3,500 users reading code/thinking. Swapped to SSD. `~100GB RAM`
- **HIBERNATED (~50%):** 5,000 users with background tabs > 5m. `0GB RAM`
- **Total Provisioned Need:** ~850GB RAM (Instead of 5TB).
- **Cluster Size:** 7x `m6id.8xlarge` AWS Spot instances (128GB RAM each) provides enough headroom, reducing compute costs by over 80%.

**9. CI/CD & DevOps Pipeline**

**9.1 Deployment Pipeline**

+-----------------------------------------------------------------------+
| Developer pushes code                                                 |
|                                                                       |
| │                                                                     |
|                                                                       |
| ▼                                                                     |
|                                                                       |
| GitHub Actions triggered                                              |
|                                                                       |
| │                                                                     |
|                                                                       |
| ├─ \[Lint\] ESLint, Ruff, mypy type checking                          |
|                                                                       |
| ├─ \[Test\] Unit tests + integration tests (pytest, jest)             |
|                                                                       |
| ├─ \[Security\] Snyk CVE scan + SAST (Semgrep)                        |
|                                                                       |
| ├─ \[Build\] Docker image build + push to ECR                         |
|                                                                       |
| └─ \[Quality Gate\] Coverage ≥ 80%, 0 critical CVEs                   |
|                                                                       |
| │                                                                     |
|                                                                       |
| ▼ (on main branch merge)                                              |
|                                                                       |
| Staging Deploy (ArgoCD GitOps)                                        |
|                                                                       |
| │                                                                     |
|                                                                       |
| ├─ Smoke tests                                                        |
|                                                                       |
| ├─ Performance tests (k6)                                             |
|                                                                       |
| └─ Manual approval gate                                               |
|                                                                       |
| │                                                                     |
|                                                                       |
| ▼                                                                     |
|                                                                       |
| Production Deploy (blue/green)                                        |
|                                                                       |
| │                                                                     |
|                                                                       |
| ├─ 1% canary release                                                  |
|                                                                       |
| ├─ Monitor error rate + latency (5 min)                               |
|                                                                       |
| └─ Progressive rollout: 10% → 50% → 100%                              |
+-----------------------------------------------------------------------+

**9.2 Infrastructure as Code**

  -----------------------------------------------------------------------
  **Tool**                            **Usage**
  ----------------------------------- -----------------------------------
  Terraform                           Cloud infrastructure provisioning
                                      (VPC, EKS, RDS, ElastiCache)

  Helm                                Kubernetes application packaging
                                      and deployment

  ArgoCD                              GitOps continuous deployment ---
                                      cluster state = Git state

  Atlantis                            Terraform PR automation --- plan on
                                      PR, apply on merge

  Packer                              Firecracker rootfs image building
                                      and versioning
  -----------------------------------------------------------------------

**9.3 Observability Stack**

  -----------------------------------------------------------------------
  **Concern**            **Tool**               **Details**
  ---------------------- ---------------------- -------------------------
  Metrics                Prometheus + Grafana   Resource usage, latency,
                                                error rates, business
                                                KPIs

  Logging                Loki + Grafana         Structured JSON logs,
                                                30-day hot retention

  Tracing                Jaeger + OTEL          Distributed traces across
                                                all microservices

  Alerting               Alertmanager +         SLO-based alerts, on-call
                         PagerDuty              rotation

  Uptime                 Checkly                Synthetic monitoring from
                                                20+ global locations

  Error Tracking         Sentry                 Frontend + backend
                                                exception tracking with
                                                sourcemaps

  APM                    Datadog APM            Production anomaly
                                                detection, service maps
  -----------------------------------------------------------------------

**10. Sprint Planning & Milestones (UPDATED)**

**Phase 1: MVP — Core IDE (Months 1–5, Sprint 1–10)**

  -----------------------------------------------------------------------
  **Sprint**             **Goal**               **Key Deliverables**
  ---------------------- ---------------------- -------------------------
  Sprint 1–2             Foundation             Monorepo setup, CI/CD,
                                                local Docker Compose dev
                                                stack, auth service (
                                                Keycloak), user DB schema
                                                (users, oauth_accounts,
                                                refresh_tokens, api_keys,
                                                user_settings — §5.2.1)

  Sprint 3–4             Editor + File System   Monaco editor integration,
                                                file tree CRUD with
                                                parent_id hierarchy,
                                                project service, S3 file
                                                storage with inline_content
                                                optimization (§2.4),
                                                basic REST API, Git init
                                                on project creation

  Sprint 5–6             Execution + Preview    Docker-based sandbox (→
                                                Firecracker in Phase 3),
                                                WebSocket terminal,
                                                **WebSocket Gateway** (§6.4)
                                                — single WS per user,
                                                **Live Preview pane** (§2.3.2)
                                                — iframe + reverse proxy,
                                                **Background Worker** (§6.3)
                                                — Celery + Redis setup

  Sprint 7–8             AI + LSP               Basic Claude API chat,
                                                single-agent code gen, SSE
                                                streaming, **LSP integration**
                                                (§2.3.1) — tsserver +
                                                pyright inside VM,
                                                **AI Retry/Resume API**
                                                (§2.5) with Celery pipeline

  Sprint 9–10            MVP Polish             Landing page, billing
                                                (Stripe), free tier limits,
                                                **Env Vars UI** (§2.3.4) —
                                                Vault-backed, notifications
                                                table, beta user onboarding,
                                                **Caching layer** (§6.5) —
                                                Redis cache-aside pattern
  -----------------------------------------------------------------------

**Phase 2: AI Differentiation (Months 6–8, Sprint 11–18)**

  -----------------------------------------------------------------------
  **Sprint**             **Goal**               **Key Deliverables**
  ---------------------- ---------------------- -------------------------
  Sprint 11–12           Multi-Agent            LangGraph orchestrator,
                                                PM + Architect agents,
                                                ADR generation,
                                                **AI error handling** (§6.6)
                                                — 4 failure scenarios,
                                                model fallback config

  Sprint 13–14           Full Agents            Backend + Frontend +
                                                DevOps + QA agents,
                                                parallel execution,
                                                **Package Manager UI**
                                                (§2.3.3) — npm/pip
                                                install in VM

  Sprint 15–16           Security + Review      Security Agent — OWASP
                                                scanner, vulnerability
                                                reporter, AI-powered fix
                                                suggestions, code_issues
                                                table, **AI Code Scanning**
                                                (§7.5) — background scan
                                                of all generated code

  Sprint 17–18           Context + Git          pgvector RAG pipeline,
                                                code_embeddings (§5.2.3),
                                                long-project memory,
                                                **Git UI** — commit, push,
                                                branch, diff, pull, status
                                                (§6.2 Git API), frontend
                                                git/ component
  -----------------------------------------------------------------------

**Phase 3: Scale & Enterprise (Months 9+, Sprint 19–32)**

  -----------------------------------------------------------------------
  **Sprint**             **Goal**               **Key Deliverables**
  ---------------------- ---------------------- -------------------------
  Sprint 19–20           Firecracker            microVM migration, VM
                                                pool warming, sub-125ms
                                                cold start, rootfs images
                                                per language, cgroup v2

  Sprint 21–22           Collaboration          Yjs CRDT integration,
                                                presence indicators via
                                                WS Gateway (§6.4), live
                                                cursor sync, conflict
                                                resolution

  Sprint 23–24           Multi-Region           EU + APAC regions, data
                                                residency, global routing,
                                                cross-region DB replication

  Sprint 25–26           Enterprise             SSO/SAML, audit logs,
                                                SOC2 prep, SLA monitoring,
                                                **Admin Dashboard** —
                                                user management, analytics,
                                                content moderation (§6.2
                                                Admin API, 16 endpoints)

  Sprint 27–28           Admin + Ops            Feature flags UI, system
                                                health dashboard, Celery
                                                queue monitoring, DLQ
                                                management, maintenance
                                                mode toggle

  Sprint 29–30           Polish + Debugger      In-browser debugger
                                                (breakpoints, step-through),
                                                Database viewer UI,
                                                performance profiling panel,
                                                additional LSP languages
                                                (rust-analyzer, gopls)

  Sprint 31–32           Marketplace            Template marketplace,
                                                community plugins, public
                                                project discovery, custom
                                                deployment domains, export
                                                to GitHub
  -----------------------------------------------------------------------

**11. Risk Register**

  --------------------------------------------------------------------------
  **Risk**        **Likelihood**   **Impact**            **Mitigation**
  --------------- ---------------- --------------------- -------------------
  **VM escape /   Low              Critical              Firecracker KVM +
  sandbox                                                seccomp BPF +
  breach**                                               regular pen testing

  **AI agent      Medium           High                  Content filtering
  produces                                               layer, output
  malicious                                              sandboxing before
  code**                                                 execution

  **Cost overrun  High             High                  Aggressive
  (compute)**                                            hibernation, spot
                                                         instances, per-user
                                                         budgets

  **Key           Low              High                  Fallback to GPT-4o,
  dependency                                             graceful
  (Claude API)                                           degradation to
  outage**                                               basic completion

  **PostgreSQL    Very Low         Critical              PITR backups,
  data loss**                                            cross-region
                                                         replication, daily
                                                         snapshot tests

  **Kafka         Medium           Medium                Consumer group
  partition lag                                          monitoring,
  at scale**                                             auto-scaling
                                                         consumers,
                                                         dead-letter queues

  **Compliance    Medium           High                  Data residency
  (GDPR/SOC2)**                                          enforcement, audit
                                                         trail from Day 1,
                                                         legal counsel

  **Talent        High             High                  Remote-first,
  acquisition**                                          competitive equity,
                                                         strong OSS
                                                         reputation building
  --------------------------------------------------------------------------

**12. Appendix**

**A. Key Acronyms**

  -----------------------------------------------------------------------
  **Acronym**                         **Definition**
  ----------------------------------- -----------------------------------
  ADR                                 Architecture Decision Record

  CRDT                                Conflict-free Replicated Data Type

  DAG                                 Directed Acyclic Graph

  HPA                                 Horizontal Pod Autoscaler

  IaC                                 Infrastructure as Code

  KVM                                 Kernel-based Virtual Machine

  OWASP                               Open Web Application Security
                                      Project

  PITR                                Point-in-Time Recovery

  RAG                                 Retrieval-Augmented Generation

  RBAC                                Role-Based Access Control

  RTO                                 Recovery Time Objective

  SLA                                 Service Level Agreement

  SLO                                 Service Level Objective

  SSE                                 Server-Sent Events

  WAF                                 Web Application Firewall
  -----------------------------------------------------------------------

**B. Reference Documents**

-   Firecracker microVM Design:
    https://github.com/firecracker-microvm/firecracker

-   Yjs CRDT Documentation: https://docs.yjs.dev

-   LangGraph Agent Framework: https://langchain-ai.github.io/langgraph

-   Kong API Gateway: https://docs.konghq.com

-   OWASP Top 10 (2021): https://owasp.org/Top10

-   Twelve-Factor App Methodology: https://12factor.net

*This document is confidential and intended solely for the platform
engineering and product teams. Unauthorized distribution is prohibited.*
 
---
name: ai-native-ide-system-design
description: A brief description, shown to the model to help it understand when to use this skill
---

Instructions for the skill go here. Provide relative paths to other resources in the skill directory as needed.
