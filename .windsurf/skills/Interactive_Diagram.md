import { useState } from "react";

const structure = {
  name: "ai-ide-platform/",
  type: "root",
  desc: "Monorepo Root",
  color: "#60a5fa",
  children: [
    {
      name: "apps/",
      type: "dir",
      desc: "User-facing applications",
      color: "#34d399",
      children: [
        {
          name: "ide/",
          type: "dir",
          desc: "Next.js 15 Frontend — Browser IDE (TypeScript)",
          color: "#34d399",
          children: [
            { name: "src/app/", type: "dir", desc: "App Router pages & layouts" },
            { name: "src/components/editor/", type: "dir", desc: "Monaco Editor + LSP, file tree, tabs, terminal UI" },
            { name: "src/components/ai/", type: "dir", desc: "AI chat panel, agent progress, diff reviewer" },
            { name: "src/components/preview/", type: "dir", desc: "Live preview pane — iframe-based app preview" },
            { name: "src/components/git/", type: "dir", desc: "Git UI — diff viewer, commit panel, branch manager" },
            { name: "src/components/packages/", type: "dir", desc: "Package manager UI — npm/pip install panel" },
            { name: "src/components/layout/", type: "dir", desc: "Sidebar, topbar, command palette" },
            { name: "src/components/ui/", type: "dir", desc: "Design system components (Button, Modal, etc.)" },
            { name: "src/hooks/", type: "dir", desc: "useEditor, useAI, useCollaboration, useExecution, usePreview" },
            { name: "src/lib/", type: "dir", desc: "API client, websocket multiplexer, auth helpers" },
            { name: "src/store/", type: "dir", desc: "Zustand global state (editor, project, user)" },
            { name: "src/types/", type: "dir", desc: "TypeScript interfaces & enums" },
            { name: "next.config.ts", type: "file", desc: "Next.js config with edge runtime settings" },
            { name: "tailwind.config.ts", type: "file", desc: "Custom design tokens & theme" },
          ]
        }
      ]
    },
    {
      name: "services/",
      type: "dir",
      desc: "Backend Microservices (mixed: see per-service lang)",
      color: "#f472b6",
      children: [
        {
          name: "auth-service/",
          type: "dir",
          desc: "Authentication & Identity — Keycloak + JWT (Node.js/TypeScript)",
          color: "#f472b6",
          children: [
            { name: "src/api/", type: "dir", desc: "Route handlers: /register, /login, /refresh, /oauth" },
            { name: "src/core/", type: "dir", desc: "JWT logic, password hashing, token rotation" },
            { name: "src/db/", type: "dir", desc: "SQLAlchemy models: User, Session, OAuthAccount" },
            { name: "src/schemas/", type: "dir", desc: "Pydantic request/response schemas" },
            { name: "alembic/", type: "dir", desc: "Database migration versions" },
            { name: "Dockerfile", type: "file", desc: "Multi-stage build — distroless final image" },
            { name: "pyproject.toml", type: "file", desc: "Dependencies + Ruff + mypy config" },
          ]
        },
        {
          name: "project-service/",
          type: "dir",
          desc: "Project & File Management + Git Operations (Node.js/TypeScript)",
          color: "#f472b6",
          children: [
            { name: "src/api/", type: "dir", desc: "Routes: /projects, /files, /fork, /invite" },
            { name: "src/core/", type: "dir", desc: "File tree logic, Git operations (GitPython)" },
            { name: "src/db/", type: "dir", desc: "Models: Project, File, Collaborator, Snapshot" },
            { name: "src/schemas/", type: "dir", desc: "Pydantic schemas + validation" },
            { name: "alembic/", type: "dir", desc: "DB migrations" },
            { name: "Dockerfile", type: "file", desc: "Service container" },
          ]
        },
        {
          name: "ai-service/",
          type: "dir",
          desc: "🧠 Multi-Agent AI Orchestration Engine (Python/FastAPI — Core Differentiator)",
          color: "#a78bfa",
          children: [
            { name: "src/agents/orchestrator.py", type: "file", desc: "LangGraph DAG — spawns + coordinates all agents" },
            { name: "src/agents/pm_agent.py", type: "file", desc: "Requirements & PRD generation agent" },
            { name: "src/agents/architect_agent.py", type: "file", desc: "System design, tech stack, ADR generation" },
            { name: "src/agents/backend_agent.py", type: "file", desc: "API design, DB schema, service code generation" },
            { name: "src/agents/frontend_agent.py", type: "file", desc: "React components, routing, state management" },
            { name: "src/agents/devops_agent.py", type: "file", desc: "Dockerfile, K8s manifests, GitHub Actions CI/CD" },
            { name: "src/agents/qa_agent.py", type: "file", desc: "Unit tests, integration tests, E2E test generation" },
            { name: "src/agents/security_agent.py", type: "file", desc: "OWASP scanner, CVE detection, fix suggestions" },
            { name: "src/core/context.py", type: "file", desc: "RAG pipeline, code graph, pgvector embeddings" },
            { name: "src/core/streaming.py", type: "file", desc: "SSE streaming of agent outputs to browser" },
            { name: "src/api/", type: "dir", desc: "Routes: /generate, /chat, /stream, /review" },
            { name: "Dockerfile", type: "file", desc: "GPU-optional container with LangGraph" },
          ]
        },
        {
          name: "execution-service/",
          type: "dir",
          desc: "Secure Code Execution — Firecracker microVMs (Go/Rust)",
          color: "#f472b6",
          children: [
            { name: "src/vm/firecracker.py", type: "file", desc: "microVM lifecycle: spawn, snapshot, hibernate, kill" },
            { name: "src/vm/pool_manager.py", type: "file", desc: "Warm VM pool — pre-warmed instances per language" },
            { name: "src/vm/rootfs/", type: "dir", desc: "Base rootfs images per runtime (node, python, go)" },
            { name: "src/api/", type: "dir", desc: "Routes: /run, /ws terminal, /install packages" },
            { name: "src/core/resource_limits.py", type: "file", desc: "cgroup v2 enforcement: CPU, RAM, disk, timeout" },
            { name: "Dockerfile", type: "file", desc: "Privileged container with KVM access" },
          ]
        },
        {
          name: "collab-service/",
          type: "dir",
          desc: "Real-Time Collaboration — Yjs CRDT WebSocket Server (Node.js/TypeScript)",
          color: "#f472b6",
          children: [
            { name: "src/core/yjs_provider.py", type: "file", desc: "y-websocket server, document persistence" },
            { name: "src/core/presence.py", type: "file", desc: "Cursor positions, user awareness, online status" },
            { name: "src/api/", type: "dir", desc: "WebSocket upgrade, room management" },
            { name: "Dockerfile", type: "file", desc: "Service container" },
          ]
        },
        {
          name: "billing-service/",
          type: "dir",
          desc: "Stripe Billing, Usage Metering, Plan Enforcement (Node.js/TypeScript)",
          color: "#f472b6",
          children: [
            { name: "src/core/stripe.py", type: "file", desc: "Checkout, webhook handling, subscription lifecycle" },
            { name: "src/core/metering.py", type: "file", desc: "Per-user usage tracking (compute, AI tokens, storage)" },
            { name: "src/core/limits.py", type: "file", desc: "Plan enforcement: Free, Pro, Team, Enterprise" },
            { name: "src/api/", type: "dir", desc: "Routes: /checkout, /webhook, /usage, /portal" },
            { name: "Dockerfile", type: "file", desc: "Service container" },
          ]
        },
        {
          name: "notification-service/",
          type: "dir",
          desc: "Push Notifications, Email (SES), In-App Alerts (Node.js/TypeScript)",
          color: "#f472b6",
          children: [
            { name: "src/core/websocket.py", type: "file", desc: "Real-time push via WebSocket connections" },
            { name: "src/core/email.py", type: "file", desc: "AWS SES transactional email templates" },
            { name: "src/api/", type: "dir", desc: "Routes: /notify, /subscribe, /preferences" },
            { name: "Dockerfile", type: "file", desc: "Service container" },
          ]
        },
        {
          name: "search-service/",
          type: "dir",
          desc: "Full-Text Code Search & Project Discovery — Elasticsearch (Node.js/TypeScript)",
          color: "#06b6d4",
          children: [
            { name: "src/controllers/", type: "dir", desc: "Routes: /search/code, /search/files, /search/projects" },
            { name: "src/indexers/", type: "dir", desc: "Kafka consumers: index files on create/update/delete" },
            { name: "src/services/", type: "dir", desc: "ES client, query builder, index manager" },
            { name: "src/config/mappings/", type: "dir", desc: "ES index mappings (code analyzer, project metadata)" },
            { name: "Dockerfile", type: "file", desc: "Service container" },
          ]
        },
        {
          name: "storage-service/",
          type: "dir",
          desc: "Centralized S3/MinIO Proxy — File Uploads, Artifacts (Node.js/Go)",
          color: "#06b6d4",
          children: [
            { name: "src/controllers/", type: "dir", desc: "Routes: /storage/upload, /storage/download, /storage/stats" },
            { name: "src/services/", type: "dir", desc: "S3 client, pre-signed URLs, virus scanner, orphan cleaner" },
            { name: "src/middleware/", type: "dir", desc: "MIME validation, upload rate limiting" },
            { name: "src/config/buckets.ts", type: "file", desc: "Bucket names and lifecycle policies" },
            { name: "Dockerfile", type: "file", desc: "Service container" },
          ]
        },
        {
          name: "analytics-service/",
          type: "dir",
          desc: "Platform Analytics, Feature Flags, Revenue Metrics (Python/Node.js)",
          color: "#06b6d4",
          children: [
            { name: "src/controllers/", type: "dir", desc: "Routes: /admin/analytics/overview, /usage, /revenue, /feature-flags" },
            { name: "src/services/", type: "dir", desc: "Metrics aggregator, revenue calculator, feature flag engine" },
            { name: "src/workers/", type: "dir", desc: "Nightly DAU/MAU snapshots, hourly usage rollups" },
            { name: "Dockerfile", type: "file", desc: "Service container" },
          ]
        },
        {
          name: "deployment-service/",
          type: "dir",
          desc: "One-Click Deploy — Vercel, Railway, AWS, GCP, Azure (Node.js/TypeScript)",
          color: "#06b6d4",
          children: [
            { name: "src/providers/", type: "dir", desc: "Vercel, Railway, AWS Amplify provider implementations" },
            { name: "src/services/", type: "dir", desc: "Build orchestrator, log streamer, domain verifier, env injector" },
            { name: "src/controllers/", type: "dir", desc: "Routes: /deploy/preview, /deploy/production, /deploy/rollback" },
            { name: "Dockerfile", type: "file", desc: "Service container" },
          ]
        },
        {
          name: "websocket-gateway/",
          type: "dir",
          desc: "Central WebSocket Multiplexer — single WS per user §6.4 (Node.js/TypeScript)",
          color: "#06b6d4",
          children: [
            { name: "src/core/multiplexer.py", type: "file", desc: "Channel-based WS routing: subscribe, unsubscribe, message" },
            { name: "src/core/auth.py", type: "file", desc: "JWT validation on WS upgrade" },
            { name: "src/core/lifecycle.py", type: "file", desc: "Connect, disconnect, heartbeat (30s ping, 90s timeout)" },
            { name: "src/channels/collab.py", type: "file", desc: "collab:{project_id} → Yjs binary sync" },
            { name: "src/channels/terminal.py", type: "file", desc: "terminal:{session_id} → UTF-8 stream to VM" },
            { name: "src/channels/ai.py", type: "file", desc: "ai:{conversation_id} → SSE-like agent output" },
            { name: "src/channels/lsp.py", type: "file", desc: "lsp:{project_id}:{lang} → JSON-RPC to LSP server in VM" },
            { name: "src/channels/preview.py", type: "file", desc: "preview:{project_id} → HMR reload events" },
            { name: "src/channels/presence.py", type: "file", desc: "presence:{project_id} → cursor positions" },
            { name: "src/channels/notifications.py", type: "file", desc: "notifications → push alerts, AI complete" },
            { name: "src/api/", type: "dir", desc: "WS upgrade endpoint, health check" },
            { name: "Dockerfile", type: "file", desc: "Service container" },
          ]
        },
        {
          name: "background-worker/",
          type: "dir",
          desc: "Async Job Processing — Celery/Dramatiq workers (Python)",
          color: "#d946ef",
          children: [
            { name: "src/tasks/embedding.py", type: "file", desc: "Code embedding generation for RAG pipeline" },
            { name: "src/tasks/email.py", type: "file", desc: "Transactional emails: verify, invite, alerts" },
            { name: "src/tasks/usage.py", type: "file", desc: "Daily usage aggregation, plan limit checks" },
            { name: "src/tasks/cleanup.py", type: "file", desc: "Idle VM cleanup, project archival (90-day)" },
            { name: "src/tasks/ai_scan.py", type: "file", desc: "AI-generated code security scanning" },
            { name: "src/core/scheduler.py", type: "file", desc: "Periodic task scheduling (Celery Beat)" },
            { name: "Dockerfile", type: "file", desc: "Worker container" },
          ]
        },
      ]
    },
    {
      name: "packages/",
      type: "dir",
      desc: "Shared Internal Packages",
      color: "#fbbf24",
      children: [
        {
          name: "shared-types/",
          type: "dir",
          desc: "TypeScript types shared across all apps & services",
          color: "#fbbf24",
          children: [
            { name: "src/user.ts", type: "file", desc: "User, Organization, OrgMember interfaces" },
            { name: "src/project.ts", type: "file", desc: "Project, File, Collaborator, Snapshot types" },
            { name: "src/ai.ts", type: "file", desc: "Conversation, Message, AgentStatus enums" },
            { name: "src/billing.ts", type: "file", desc: "Plan, UsageRecord, Subscription types" },
            { name: "src/events.ts", type: "file", desc: "Kafka event payloads — strongly typed" },
          ]
        },
        {
          name: "ui-components/",
          type: "dir",
          desc: "Shared React Design System (used by web app)",
          color: "#fbbf24",
          children: [
            { name: "src/Button.tsx", type: "file", desc: "Primary, secondary, ghost, danger variants" },
            { name: "src/Modal.tsx", type: "file", desc: "Accessible modal with focus trap" },
            { name: "src/CodeBlock.tsx", type: "file", desc: "Syntax-highlighted code display" },
            { name: "src/AgentCard.tsx", type: "file", desc: "AI agent status card with streaming output" },
          ]
        },
        {
          name: "config/",
          type: "dir",
          desc: "Shared ESLint, TypeScript, Prettier configs",
          color: "#fbbf24",
          children: [
            { name: "eslint/base.js", type: "file", desc: "Base ESLint rules for all packages" },
            { name: "typescript/base.json", type: "file", desc: "Strict TS config — no implicit any, strict null" },
          ]
        }
      ]
    },
    {
      name: "infrastructure/",
      type: "dir",
      desc: "IaC, Kubernetes, Helm, Docker Configs",
      color: "#fb923c",
      children: [
        {
          name: "terraform/",
          type: "dir",
          desc: "Cloud Infrastructure as Code (AWS)",
          color: "#fb923c",
          children: [
            { name: "modules/eks/", type: "dir", desc: "Kubernetes cluster: node groups, autoscaling, IRSA" },
            { name: "modules/rds/", type: "dir", desc: "PostgreSQL 16: Multi-AZ, PITR, read replicas" },
            { name: "modules/redis/", type: "dir", desc: "ElastiCache Redis Cluster, 6-node setup" },
            { name: "modules/kafka/", type: "dir", desc: "MSK (Managed Kafka): topic config, IAM auth" },
            { name: "modules/s3/", type: "dir", desc: "Buckets: artifacts, snapshots, logs, backups" },
            { name: "modules/networking/", type: "dir", desc: "VPC, subnets, NAT gateways, security groups" },
            { name: "environments/dev/", type: "dir", desc: "Dev environment — single AZ, smaller instances" },
            { name: "environments/staging/", type: "dir", desc: "Staging — mirrors production, reduced capacity" },
            { name: "environments/prod/", type: "dir", desc: "Production — Multi-AZ, us-east-1 + eu-west-1" },
          ]
        },
        {
          name: "kubernetes/",
          type: "dir",
          desc: "K8s Manifests — Kustomize Overlays",
          color: "#fb923c",
          children: [
            { name: "base/", type: "dir", desc: "Base manifests: Deployments, Services, ConfigMaps" },
            { name: "overlays/dev/", type: "dir", desc: "Dev patches: low replicas, dev secrets" },
            { name: "overlays/staging/", type: "dir", desc: "Staging patches: medium replicas, staging secrets" },
            { name: "overlays/prod/", type: "dir", desc: "Prod patches: HPA, PDB, production secrets" },
          ]
        },
        {
          name: "helm/",
          type: "dir",
          desc: "Helm Charts for each microservice",
          color: "#fb923c",
          children: [
            { name: "charts/ai/", type: "dir", desc: "AI service chart: GPU node affinity, resource limits" },
            { name: "charts/execution/", type: "dir", desc: "Execution service: privileged pods, KVM device" },
            { name: "values/", type: "dir", desc: "Per-environment value overrides" },
          ]
        },
        {
          name: "docker/",
          type: "dir",
          desc: "Docker Compose for local development",
          color: "#fb923c",
          children: [
            { name: "docker-compose.dev.yml", type: "file", desc: "Full local stack: PG, Redis, Kafka, MinIO, Keycloak" },
            { name: "docker-compose.test.yml", type: "file", desc: "Lightweight test stack" },
          ]
        }
      ]
    },
    {
      name: ".github/",
      type: "dir",
      desc: "GitHub Actions CI/CD Workflows",
      color: "#94a3b8",
      children: [
        { name: "workflows/ci.yml", type: "file", desc: "PR checks: lint, test, build, security scan (Snyk)" },
        { name: "workflows/deploy-staging.yml", type: "file", desc: "Auto-deploy to staging on main merge" },
        { name: "workflows/deploy-prod.yml", type: "file", desc: "Canary deploy to production with approval gate" },
        { name: "workflows/dependency-update.yml", type: "file", desc: "Weekly Dependabot + auto-merge patch updates" },
      ]
    },
    {
      name: "scripts/",
      type: "dir",
      desc: "Developer Utility Scripts",
      color: "#94a3b8",
      children: [
        { name: "setup.sh", type: "file", desc: "One-command local dev setup" },
        { name: "seed-db.ts", type: "file", desc: "Seed dev database with test data" },
        { name: "gen-types.ts", type: "file", desc: "Auto-generate TypeScript from OpenAPI specs" },
        { name: "build-rootfs.sh", type: "file", desc: "Build Firecracker rootfs images" },
      ]
    },
    {
      name: "docs/",
      type: "dir",
      desc: "Project Documentation",
      color: "#94a3b8",
      children: [
        { name: "adr/", type: "dir", desc: "Architecture Decision Records (ADR-001, ADR-002...)" },
        { name: "api/", type: "dir", desc: "OpenAPI specs per service (auto-generated)" },
      ]
    },
    {
      name: "turbo.json",
      type: "file",
      desc: "Turborepo pipeline: build, test, lint task graph",
      color: "#94a3b8"
    },
    {
      name: ".env.example",
      type: "file",
      desc: "All env variables documented — never commit .env",
      color: "#94a3b8"
    },
    {
      name: "docker-compose.dev.yml",
      type: "file",
      desc: "Root-level shortcut to infra docker compose",
      color: "#94a3b8"
    },
  ]
};

const FILE_ICON = {
  root: "◈",
  dir: "◫",
  file: "◻",
};

const getIcon = (name, type) => {
  if (type === "root") return "◈";
  if (type === "file") {
    if (name.endsWith(".py")) return "🐍";
    if (name.endsWith(".ts") || name.endsWith(".tsx")) return "⬡";
    if (name.endsWith(".yml") || name.endsWith(".yaml")) return "⚙";
    if (name.endsWith(".json")) return "{}";
    if (name.endsWith(".sh")) return "▶";
    if (name === "Dockerfile") return "🐳";
    return "◻";
  }
  return "◫";
};

function TreeNode({ node, depth = 0, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen || depth < 1);
  const [hovered, setHovered] = useState(false);
  const isDir = node.type === "dir" || node.type === "root";
  const hasChildren = node.children && node.children.length > 0;
  const color = node.color || (depth === 0 ? "#60a5fa" : depth === 1 ? "#34d399" : "#94a3b8");
  const indent = depth * 20;

  return (
    <div>
      <div
        onClick={() => isDir && hasChildren && setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "5px 12px 5px",
          paddingLeft: 12 + indent,
          cursor: isDir && hasChildren ? "pointer" : "default",
          background: hovered ? "rgba(255,255,255,0.04)" : "transparent",
          borderRadius: 6,
          transition: "background 0.15s",
          borderLeft: depth > 0 ? `1px solid rgba(255,255,255,0.06)` : "none",
          marginLeft: depth > 0 ? 8 : 0,
        }}
      >
        {/* Toggle arrow */}
        <span style={{ width: 14, flexShrink: 0, color: "#4B5563", fontSize: 10, marginTop: 3 }}>
          {isDir && hasChildren ? (open ? "▼" : "▶") : ""}
        </span>

        {/* Icon */}
        <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1, opacity: 0.9 }}>
          {getIcon(node.name, node.type)}
        </span>

        {/* Name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 13,
            fontWeight: isDir ? 600 : 400,
            color: isDir ? color : "#CBD5E1",
            letterSpacing: isDir ? 0.3 : 0,
          }}>
            {node.name}
          </span>
          {node.desc && (
            <span style={{
              marginLeft: 12,
              fontSize: 11,
              color: "#475569",
              fontFamily: "system-ui, sans-serif",
            }}>
              — {node.desc}
            </span>
          )}
        </div>
      </div>

      {isDir && hasChildren && open && (
        <div>
          {node.children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

const STATS = [
  { label: "Microservices", value: "9", color: "#f472b6" },
  { label: "AI Agents", value: "8", color: "#a78bfa" },
  { label: "Shared Packages", value: "3", color: "#fbbf24" },
  { label: "TF Modules", value: "6", color: "#fb923c" },
  { label: "K8s Overlays", value: "3", color: "#34d399" },
  { label: "CI Workflows", value: "4", color: "#60a5fa" },
];

export default function StructureDiagram() {
  const [search, setSearch] = useState("");

  const filterNode = (node, q) => {
    if (!q) return node;
    const match = node.name.toLowerCase().includes(q) || (node.desc || "").toLowerCase().includes(q);
    if (node.children) {
      const filteredChildren = node.children
        .map(c => filterNode(c, q))
        .filter(Boolean);
      if (match || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    }
    return match ? node : null;
  };

  const filtered = filterNode(structure, search.toLowerCase());

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080B14",
      color: "#E2E8F0",
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "0 0 80px",
    }}>
      {/* Header */}
      <div style={{
        padding: "36px 40px 28px",
        borderBottom: "1px solid #0F172A",
        background: "linear-gradient(180deg, #0D1117 0%, #080B14 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
          <span style={{ fontSize: 28 }}>◈</span>
          <div>
            <div style={{
              fontSize: 22,
              fontWeight: 800,
              fontFamily: "'JetBrains Mono', monospace",
              background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: -0.5,
            }}>
              ai-ide-platform/
            </div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
              Production Monorepo — Full Project Structure
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
          {STATS.map(s => (
            <div key={s.label} style={{
              background: "#0F172A",
              border: `1px solid ${s.color}33`,
              borderRadius: 8,
              padding: "6px 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: "monospace" }}>{s.value}</span>
              <span style={{ fontSize: 11, color: "#64748B" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "16px 40px", borderBottom: "1px solid #0F172A" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search files, folders, descriptions..."
          style={{
            width: "100%",
            background: "#0F172A",
            border: "1px solid #1E293B",
            borderRadius: 8,
            color: "#E2E8F0",
            padding: "10px 16px",
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Legend */}
      <div style={{ padding: "12px 40px", display: "flex", gap: 20, borderBottom: "1px solid #0F172A", flexWrap: "wrap" }}>
        {[
          { color: "#34d399", label: "apps/ — Frontend" },
          { color: "#f472b6", label: "services/ — Backend" },
          { color: "#a78bfa", label: "ai-service — Core AI" },
          { color: "#fbbf24", label: "packages/ — Shared" },
          { color: "#fb923c", label: "infrastructure/" },
          { color: "#94a3b8", label: "config & docs" },
        ].map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: l.color }} />
            <span style={{ fontSize: 11, color: "#64748B" }}>{l.label}</span>
          </div>
        ))}
      </div>

      {/* Tree */}
      <div style={{ padding: "16px 28px" }}>
        {filtered ? (
          <TreeNode node={filtered} depth={0} defaultOpen={true} />
        ) : (
          <div style={{ textAlign: "center", color: "#475569", padding: 40 }}>
            No results for "{search}"
          </div>
        )}
      </div>
    </div>
  );
}