# 🚀 Deployment Service — Development Logic & Architecture

> **Target:** `services/deployment-service/` (Node.js / Go)
> **Port:** `8011`
> **Goal:** One-click deployment of user projects to Vercel, Railway, AWS, GCP, or Azure. Handles build orchestration, log streaming, rollback, and custom domain management.
> **Standard:** Zero-downtime deployments. Immutable deploy history. Real-time build log streaming via WebSocket.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── controllers/
 │    ├── deploy_controller.ts         # POST /deploy/preview, POST /deploy/production
 │    ├── history_controller.ts        # GET /deploy/history/:project_id
 │    ├── rollback_controller.ts       # POST /deploy/rollback/:deployment_id
 │    └── domain_controller.ts         # Custom domain CRUD + DNS verification
 ├── providers/
 │    ├── vercel_provider.ts           # Vercel REST API integration (primary)
 │    ├── railway_provider.ts          # Railway CLI/API integration
 │    ├── aws_amplify_provider.ts      # AWS Amplify hosting
 │    └── provider_interface.ts        # Abstract interface all providers must implement
 ├── services/
 │    ├── build_orchestrator.ts        # Orchestrates build → deploy → verify pipeline
 │    ├── log_streamer.ts             # Streams build logs to websocket-gateway
 │    ├── domain_verifier.ts          # DNS CNAME/TXT verification & SSL provisioning
 │    └── env_injector.ts             # Fetches secrets from Vault, injects into deploy config
 ├── events/
 │    ├── kafka_consumer.ts           # Listens to project.deleted → cleanup deployments
 │    └── kafka_publisher.ts          # Publishes deployment.completed, deployment.failed
 └── config/
      └── provider_configs.ts         # API keys, default regions per provider
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Provider Abstraction (Strategy Pattern)
- **Constraint:** The deployment service must support 4+ cloud providers without `if/else` hell. Adding a new provider (e.g., Fly.io) should require ZERO changes to existing controller code.
- **Logic:**
  - Define a `DeploymentProvider` interface:
    ```typescript
    interface DeploymentProvider {
      deploy(config: DeployConfig): Promise<DeployResult>;
      getStatus(deployId: string): Promise<DeployStatus>;
      getLogs(deployId: string): AsyncIterable<string>;
      rollback(deployId: string): Promise<void>;
      delete(deployId: string): Promise<void>;
    }
    ```
  - Each provider (`vercel_provider.ts`, `railway_provider.ts`) implements this interface.
  - The `build_orchestrator.ts` selects the provider based on `deployments.provider` column and delegates.

### 2. Build Log Streaming (Real-Time) & Secret Scrubbing
- **Constraint:** Users expect Vercel-like real-time build output. However, a user arbitrarily writing `console.log(process.env)` will leak Vault secrets directly into plaintext logs, violating compliance.
- **Logic:**
  - The `build_orchestrator.ts` calls the provider's `getLogs()` which returns an `AsyncIterable<string>`.
  - **The "Data Masking" Interceptor (Extreme Rule):** Before processing the log stream, `log_streamer.ts` must generate an Aho-Corasick automaton (or Regex dictionary) of all deployed secret values. Every single chunk of the incoming `string` stream MUST be scrubbed, replacing any matched secret value with `[REDACTED_BY_PLATFORM]`.
  - Each scrubbed log line is immediately published to the `websocket-gateway` via Redis Pub/Sub on channel `deploy:{deployment_id}`.
  - All scrubbed log lines are appended to a buffer and uploaded to S3 (`build_log_s3_key`) upon completion.

### 3. Environment Variable Injection (Vault Integration)
- **Constraint:** Deployment providers need the user's `DATABASE_URL`, `OPENAI_API_KEY`, etc. These are stored in HashiCorp Vault, NOT in the database. The deployment service must fetch them securely at deploy time.
- **Logic:**
  - `deployment-service` authenticates to Vault via **Kubernetes Service Account (KSA) Token Projection** (Vault Agent Injector). Hardcoded Root/AppRole tokens are forbidden.
  - Query `project_secrets` table for the project's `key_name` + `vault_reference_id` pairs.
  - For each secret, call Vault API using the KSA-derived short-lived token to retrieve the plaintext value.
  - Inject these as environment variables into the provider's deploy config.
  - **NEVER** log or persist the plaintext values. The `env_snapshot` JSONB in the `deployments` table stores ONLY the key names (not values).

### 4. Immutable Deploy History & Rollback
- **Constraint:** Every deployment must be traceable. Users must be able to rollback to any previous successful deployment.
- **Logic:**
  - Each deployment creates an immutable row in the `deployments` table with `commit_sha`, `branch_name`, `build_command`, `output_dir`, and `url`.
  - Rollback (`POST /deploy/rollback/{id}`) does NOT modify the old deployment row. It creates a NEW deployment row that re-deploys the old `commit_sha`.
  - The frontend shows a timeline of all deployments (green = live, red = failed, blue = rolled back).

### 5. Custom Domain Management
- **Constraint:** Pro users can map `www.myblog.com` to their deployed project. This requires DNS verification and SSL certificate provisioning.
- **Logic:**
  - User adds domain via `POST /deploy/domains`.
  - System generates a CNAME target: `{project_slug}.platform-deploy.io`.
  - User adds the CNAME record at their DNS provider.
  - `domain_verifier.ts` polls DNS every 60 seconds (max 48 hours) to verify the CNAME.
  - Once verified, trigger SSL certificate via Let's Encrypt (or Cloudflare managed certs).
  - Update `project_domains.dns_verified = true` and `ssl_status = 'active'`.

---

## 🚀 API Endpoints Contract (Must Implement Exactly)

### POST `/api/v1/deploy/preview`
- **Body:** `{ project_id: "uuid", branch: "feature-login" }`
- **Action:** Deploy to an ephemeral preview URL. No custom domain. Auto-expires in 7 days.
- **Response:** `202 Accepted` | `{ deployment_id: "uuid", ws_channel: "deploy:{id}" }`

### POST `/api/v1/deploy/production`
- **Auth:** `Bearer + Pro plan`
- **Body:** `{ project_id: "uuid", branch: "main", provider: "vercel", build_command: "npm run build", output_dir: ".next" }`
- **Action:** Full production deployment. Inject Vault secrets. Stream logs. Update `deployments` table.
- **Response:** `202 Accepted` | `{ deployment_id: "uuid", ws_channel: "deploy:{id}" }`

### GET `/api/v1/deploy/history/{project_id}`
- **Query:** `?limit=20&cursor=...`
- **Response:** Paginated list of deployments (status, url, branch, commit_sha, created_at, duration).

### POST `/api/v1/deploy/rollback/{deployment_id}`
- **Action:** Re-deploy the exact commit_sha and config of the specified deployment. Creates a new deployment row.
- **Response:** `202 Accepted` | `{ new_deployment_id: "uuid" }`

### POST `/api/v1/deploy/domains`
- **Body:** `{ project_id: "uuid", domain_name: "www.myblog.com" }`
- **Action:** Create `project_domains` record. Return CNAME target for user to configure.
- **Response:** `201 Created` | `{ cname_target: "my-blog.platform-deploy.io", verification_status: "pending" }`
