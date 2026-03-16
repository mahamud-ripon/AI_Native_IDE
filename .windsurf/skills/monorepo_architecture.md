# 🏗️ Scalable Monorepo Architecture

> **Platform:** AI-Native Cloud IDE
> **Architecture Goal:** Hybrid Execution (Browser WebContainers + Cloud MicroVMs), Microservices, Multi-Agent AI System.
> **Monorepo Tooling:** [Turborepo](https://turbo.build/) (Fast, workspace-aware), `pnpm` workspace / `uv` for python.

যেহেতু আমাদের প্রজেক্টে Frontend (Next.js), ৯+ Backend Microservices (FastAPI/Node), AI Agents, এবং Infrastructure Code (K8s/Terraform) আছে, তাই একটি **Monorepo** (single repository) হলো সবচেয়ে scalable approach। 

নিচে `turborepo` ভিত্তিক future-proof file architecture দেওয়া হলো:

---

## 📂 Root Directory Structure

```text
ai-native-ide/
├── apps/                   # 🖥️ Client-facing Applications (Frontend)
├── services/               # ⚙️ Backend Microservices (APIs & Workers)
├── packages/               # 📦 Shared Libraries & Internal Modules
├── ai-agents/              # 🧠 LangGraph & AI Orchestration Logic
├── infra/                  # ☁️ Infrastructure as Code (Terraform, K8s, VM)
├── scripts/                # 🛠️ CI/CD & Dev Tooling Scripts
├── turbo.json              # 🚀 Turborepo Build Pipeline Config
├── package.json            # 📦 Root Package (pnpm workspaces limit)
├── docker-compose.yml      # 🐳 Local Dev Environment Orchestration
└── README.md               # 📖 Master Documentation
```

---

## 🔍 Detailed Breakdown: The "apps" Directory

এখানে ইউজাররা সরাসরি যা ইন্টারঅ্যাক্ট করবে তা থাকবে।

```text
apps/
├── marketing-site/                # 🌐 Public Landing Page & Conversion (Next.js)
│   ├── app/                       # Next.js 15 App Router
│   ├── components/                # Marketing components
│   └── package.json
│
├── ide/                           # 💻 The Core Editor Frontend (Vite/React)
│   ├── src/
│   │   ├── editor/                # Monaco Editor integration
│   │   ├── terminal/              # xterm.js integration
│   │   ├── file-tree/             # Virtual DOM file tree
│   │   ├── preview/               # Live preview iframe (WebContainer network intercept)
│   │   ├── webcontainers/         # ⚡ Hybrid Tier 1: Browser WASM execution logic
│   │   └── state/                 # Zustand & Yjs (CRDT) sync logic
│   └── package.json
│
└── admin/                         # 🛡️ Internal Admin Dashboard (Next.js / Vite)
```

---

## 🔍 Detailed Breakdown: The "services" Directory

সবগুলো ৯টি Microservices এখানে থাকবে। প্রতিটা service independently deploy হবে।

```text
services/
├── api-gateway/                   # 🚪 Kong API Configs / Fastify Custom Gateway
│
├── auth-service/                  # 🔐 Keycloak Custom Themes or Wrapper API
│
├── project-service/               # 📁 CRUD, Git Ops, File Sync (Node.js/FastAPI)
│   ├── src/routes/
│   └── src/git/                     
│
├── collab-service/                # 🤝 Yjs WebSocket Server (Node.js)
│   └── src/y-webrtc/              # Browser-to-browser fallback sync
│
├── execution-service/             # ☁️ Tier 2: Firecracker VM Orchestrator (Go/Rust)
│   ├── src/vm-pool/               # Pre-warmed VM manager
│   ├── src/jailer/                # Security isolation
│   └── src/lsp-proxy/             # Lang Server Protocol proxy to browser
│
├── ai-service/                    # 🧠 Orchestrator Endpoint & Streaming SSE (FastAPI)
│   └── src/router/                
│
├── websocket-gateway/             # 🔌 Central Real-time Multiplexer (§6.4)
│   ├── src/channels/              # collab.py, terminal.py, preview.py
│   └── src/connection/            # Lifecycle manager
│
└── background-worker/             # 🕒 Celery Workers (Python)
    ├── src/tasks/                 # ai_scan.py, snapshot_vm.py
    └── src/dlq/                   # Dead-letter queue handlers
```

---

## 🔍 Detailed Breakdown: The "ai-agents" Directory

যেহেতু AI আমাদের Core USP, তাই AI Agents-দের আলাদা workspace-এ রাখা হবে (LangGraph/LangChain/Python)।

```text
ai-agents/
├── src/
│   ├── orchestrator/              # 🚦 LangGraph State Graph & DAG definitions
│   │   ├── task_planner.py
│   │   └── state_schema.py
│   │
│   ├── agents/                    # 🤖 The 8 Specialized Agents
│   │   ├── pm-agent/              # Requirement parsing
│   │   ├── architect-agent/       # System design & ADR generation
│   │   ├── backend-agent/         # Schema, API design, Node/Python code
│   │   ├── frontend-agent/        # UI/UX, React components
│   │   ├── qa-agent/              # Test generation
│   │   ├── security-agent/        # OWASP scanning
│   │   └── devops-agent/          # Docker/CI generation
│   │
│   ├── tools/                     # 🛠️ Tools agents can call (MCP)
│   │   ├── file_writer.py
│   │   ├── bash_executor.py
│   │   └── linter.py
│   │
│   └── llm-router/                # 🛣️ Cost Optimization (§3.5 Model selection)
│       └── cost_manager.py
│
├── tests/                         # Agent evaluation and benchmarking
└── pyproject.toml                 # uv/poetry python package manager
```

---

## 🔍 Detailed Breakdown: The "packages" Directory

এখানে Shared Libraries থাকবে যেগুলো `apps` এবং `services` ব্যবহার করবে (DRY Policy)।

```text
packages/
├── shared-types/                  # 🔵 TypeScript Interfaces & Zod Schemas
│   ├── src/api-schemas.ts         # User, Project, Git HTTP response formats
│   └── src/ws-protocol.ts         # WebSocket event payloads
│
├── ui/                            # 🎨 Shared UI Components (shadcn/Radix)
│   ├── src/components/            # Buttons, Modals, Dropdowns
│   └── tailwind.config.ts         # Global design tokens
│
├── database/                      # 🗄️ Database ORM (Prisma / Drizzle / SQLAlchemy)
│   ├── prisma/schema.prisma       # Single source of truth for the 24 tables
│   ├── migrations/                # Schema changes
│   └── src/client.ts              # DB connection pooling
│
├── logger/                        # 📝 Shared Logging Config (Pino / Python Logger)
│
└── config/                        # ⚙️ ESLint, Prettier, TSConfig presets
    ├── eslint-preset.js
    └── tsconfig.base.json
```

---

## 🔍 Detailed Breakdown: The "infra" Directory

এখানে DevOps & K8s file থাকবে (IaC)।

```text
infra/
├── terraform/                     # ☁️ Cloud Provisioning (AWS/GCP, S3, RDS)
│   ├── environments/              # dev, staging, prod
│   └── modules/
│
├── k8s/                           # ☸️ Kubernetes Manifests
│   ├── helm-charts/               # Our microservices charts
│   ├── ingress/                   # Nginx/Kong Ingress configurations
│   └── monitoring/                # Prometheus, Grafana, Loki stacks
│
└── firecracker/                   # 🔥 VM Runtime Configs
    ├── rootfs-images/             # Dockerfiles for base-node, base-python
    └── network/                   # CNI plugin configs for VM isolation
```

---

## 🚀 Why This Architecture is "Future-Proof"

1. **Strict Boundary Control:** Frontend ডেভেলপাররা `ide-client` নিয়ে কাজ করবে, AI ইঞ্জিনিয়াররা `ai-agents` নিয়ে, আর Backend ডেভেলপাররা `services` নিয়ে। কোড কনফ্লিক্ট হবে না।
2. **"WebContainer" Separation:** Browser execution logic-টাকে `ide-client/src/webcontainers/` এর ভেতর রাখা হয়েছে। এটা Cloud VM (`execution-service/`) থেকে পুরোপুরি আলাদা।
3. **Single Source of Truth:** Database Scheme (PRISMA/SQL) এবং Type Definitions (Zod) সব `packages/` ফোল্ডারে। ফলে Frontend আর Backend-এর API types জীবনেও mismatch হবে না।
4. **Turborepo Magic:** `turbo run build` দিলে শুধুমাত্র যেই ফোল্ডারে চেঞ্জ এসেছে (e.g. `collab-service`), শুধু সেটাই বিল্ড হবে। বিল্ড টাইম ৯০% কমে যাবে।
5. **Agent Independence:** `ai-agents` মডিউলটা আলাদা থাকায় আমরা পরবর্তীতে খুব সহজেই LangGraph থেকে অন্য কোনো framework-এ move করতে পারব বা individual agent-কে স্বাধীনভাবে test/benchmark করতে পারব।

### 🛠️ Next Setup Actions:
যদি আমরা এই আর্কিটেকচারে কাজ শুরু করি, আমাদের প্রথম প্রয়োজন হবে:
1. `npx create-turbo@latest` রান করা।
2. Database (PostgreSQL) `packages/database`-এ সেটআপ দেওয়া (ERD অনুযায়ী 24 Tables)।
3. `ide-client` (Frontend) এবং `project-service` (Backend) ইনিশিয়ালাইজ করা।
