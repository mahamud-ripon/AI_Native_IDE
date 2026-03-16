# API Design Document - AI-Native IDE Platform

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Based On:** Database Schema (Prisma) + System Design Document

---

## 1. API Gateway (Port 8000)

### Routing Map

| Path Pattern | Destination | Auth Required |
|--------------|-------------|---------------|
| `/api/v1/auth/*` | auth-service:8001 | No |
| `/api/v1/projects/*` | project-service:8002 | Yes |
| `/api/v1/ai/*` | ai-service:8003 | Yes |
| `/api/v1/exec/*` | execution-service:8004 | Yes |
| `/api/v1/collab/*` | collab-service:8005 | Yes |
| `/api/v1/billing/*` | billing-service:8006 | Yes |
| `/api/v1/notifications/*` | notification-service:8007 | Yes |
| `/api/v1/search/*` | search-service:8008 | Yes |
| `/api/v1/deploy/*` | deployment-service:8011 | Yes |
| `/api/v1/storage/*` | storage-service:8009 | Yes |
| `/api/v1/admin/*` | analytics-service:8010 | Yes |
| `/api/v1/templates/*` | project-service:8002 | Yes |
| `/api/v1/packages/*` | execution-service:8004 | Yes |

### Middleware Stack

1. **DDoS Protection** - Payload size check, slow-loris protection
2. **Global Rate Limiter** - Redis-based (IP for anonymous, User-ID for authenticated)
3. **Edge Auth** - JWT signature verification (stateless)
4. **Idempotency** - Redis SETNX for POST/PUT/DELETE
6. **Request Tracer** - X-Trace-Id injection

### API Versioning Strategy

**Strategy:** URL-based versioning (aligned with `ARCHITECTURE_STANDARDS.md`)

All routes are prefixed with `/api/v1/`. Breaking changes create a new version (`/api/v2/`).

| Method | Example |
|--------|--------|
| Current | `/api/v1/projects` |
| Next Version | `/api/v2/projects` |

**Version Lifecycle:**
- `v1` - Current production version
- `v2` - Next version (when breaking changes are needed)
- Deprecated versions supported for **12 months** after new version release

**Deprecation Policy:**
1. Announce deprecation upon new version launch
2. Add `Deprecation: true` header to old version responses
3. Add `Sunset` header with expiry date
4. Support both versions for 12 months
5. After 12 months, return `410 Gone` for old version endpoints

**Example Deprecation Response:**
```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sat, 01 Mar 2028 00:00:00 GMT
Link: <https://api.platform.io/api/v2/projects>; rel="successor-version"
Content-Type: application/json
```

### Circuit Breaker Pattern

**Implementation:** At API Gateway level using `opossum` (Node.js). Downstream requests should fast-fail and return HTTP 503 instead of hanging infinitely.

**Configuration per Service:**

| Service | Failure Threshold | Timeout | Recovery Time |
|---------|-------------------|---------|---------------|
| ai-service | 50% for 10 calls | 5000ms | 30 seconds |
| execution-service | 50% for 10 calls | 5000ms | 30 seconds |
| billing-service | 50% for 10 calls | 3000ms | 60 seconds |
| project-service | 30% for 5 calls | 3000ms | 15 seconds |

**States:**
- **CLOSED** - Normal operation, requests pass through
- **OPEN** - Circuit tripped, requests fail fast with `503 Service Unavailable`
- **HALF_OPEN** - Testing if service recovered, limited requests allowed

**Response when OPEN:**
```json
{
  "success": false,
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "ai-service is temporarily unavailable",
    "retryAfter": 30
  }
}
```

---

## 2. Auth Service (Port 8001)

### Endpoints

#### POST `/api/v1/auth/register`
**Description:** Register new user account

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "securePassword123"
}
```

**Validation:**
- email: valid email format, unique
- username: 3-50 chars, alphanumeric + underscores
- password: min 8 chars

**Response (201):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "username": "johndoe"
    }
  },
  "trace_id": "req-uuid"
}
```

**Cookie:**
- `refreshToken` (HttpOnly, Secure, SameSite=Strict, 7 days)

**Kafka Events:** `user.created`

---

#### POST `/api/v1/auth/login`
**Description:** Authenticate user

**Request Body:**
```json
{
  "email_or_username": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "user": { "id": "uuid", "email": "...", "username": "..." }
  }
}
```

**Response (202) - MFA Required:**
```json
{
  "success": true,
  "data": {
    "mfaRequired": true,
    "mfaToken": "temp_token_for_mfa_verification"
  }
}
```

**Audit Log:** Write to `audit_logs` table

---

#### POST `/api/v1/auth/refresh`
**Description:** Refresh access token

**Cookie:** `refreshToken`

**Response (200):**
```json
{
  "success": true,
  "data": { "accessToken": "new_jwt_token" }
}
```
**Cookie:** New `refreshToken`

---

#### POST `/api/v1/auth/logout**
**Description:** Logout current session

**Header:** `Authorization: Bearer <token>`

**Response (200):**
```json
{ "success": true, "data": null }
```
**Cookie:** Clear `refreshToken`

---

#### POST `/api/v1/auth/forgot-password**
**Description:** Request password reset

**Request Body:**
```json
{ "email": "user@example.com" }
```

**Response (200):** Always return 200 (don't leak if email exists)

**Kafka Events:** `auth.email_action`

---

#### POST `/api/v1/auth/mfa-verify`
**Description:** Verify MFA code

**Request Body:**
```json
{
  "mfaToken": "temp_token_from_login",
  "code": "123456"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "...",
    "user": { ... }
  }
}
```

---

#### GET `/api/v1/auth/me`
**Description:** Get current user profile

**Header:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe",
    "fullName": "John Doe",
    "avatarUrl": "https://...",
    "isVerified": true,
    "mfaEnabled": false,
    "createdAt": "2026-03-01T00:00:00Z"
  }
}
```

---

## 3. Project Service (Port 8002)

### Endpoints

#### POST `/api/v1/projects`
**Description:** Create new project

**Header:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "my-ecommerce-app",
  "description": "E-commerce platform",
  "template": "nextjs",
  "visibility": "private",
  "orgId": null
}
```

**Validation:**
- name: 3-50 chars, alphanumeric + dashes
- template: enum ["nextjs", "fastapi", "blank", "react", "vue", "python"]
- visibility: enum ["private", "public", "org"]

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "my-ecommerce-app",
    "slug": "my-ecommerce-app-abc123",
    "visibility": "private",
    "status": "pending",
    "createdAt": "2026-03-12T00:00:00Z"
  },
  "trace_id": "req-uuid"
}
```

**Database:** Insert `projects` + create default `project_branches` (main)

**Kafka Events:** `project.created`

---

#### GET `/api/v1/projects`
**Description:** List user projects

**Header:** `Authorization: Bearer <token>`

**Query Params:**
- `page`: number (default 1)
- `limit`: number (default 20)
- `visibility`: filter by visibility

**Response (200):**
```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "id": "uuid",
        "name": "my-app",
        "visibility": "private",
        "lastOpenedAt": "2026-03-12T00:00:00Z",
        "owner": { "id": "uuid", "username": "john" }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 50 }
  }
}
```

---

#### GET `/api/v1/projects/:id`
**Description:** Get project details

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "my-app",
    "description": "...",
    "visibility": "private",
    "template": "nextjs",
    "framework": "next",
    "language": "typescript",
    "gitRepoUrl": null,
    "createdAt": "...",
    "updatedAt": "...",
    "owner": { "id": "uuid", "username": "john" }
  }
}
```

---

#### PUT `/api/v1/projects/:id`
**Description:** Update project

**Request Body:**
```json
{
  "name": "new-name",
  "description": "updated desc",
  "visibility": "public"
}
```

**Response (200):**
```json
{ "success": true, "data": { ...updated project... } }
```

---

#### DELETE `/api/v1/projects/:id`
**Description:** Delete project (hard delete)

**Response (200):**
```json
{ "success": true, "data": null }
```

**Kafka Events:** `project.deleted`

---

#### GET `/api/v1/projects/:id/tree`
**Description:** Get file tree as nested JSON

**Query:** `?branch=main`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "name": "root",
    "isDirectory": true,
    "children": [
      {
        "id": "uuid",
        "name": "package.json",
        "isDirectory": false,
        "language": "json"
      },
      {
        "name": "src",
        "isDirectory": true,
        "children": [
          { "id": "uuid", "name": "index.ts", "isDirectory": false, "language": "typescript" }
        ]
      }
    ]
  }
}
```

---

#### POST `/api/v1/projects/:id/files`
**Description:** Create file or folder

**Header:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "path": "src/utils/helper.ts",
  "isDirectory": false,
  "content": "export const add = (a: number, b: number) => a + b;"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "path": "src/utils/helper.ts",
    "language": "typescript"
  }
}
```

**Storage Logic:**
- < 64KB: Store in PostgreSQL `inline_content`
- >= 64KB: Upload to S3, store key in `s3_key`

**Kafka Events:** `file.modified`

---

#### PUT `/api/v1/projects/:id/files/:file_id`
**Description:** Update file content

**Request Body:**
```json
{
  "content": "updated content here"
}
```

**Response (200):**
```json
{ "success": true, "data": { "id": "uuid", "contentHash": "sha256..." } }
```

---

#### DELETE `/api/v1/projects/:id/files/:file_id`
**Description:** Delete file

**Response (200):**
```json
{ "success": true, "data": null }
```

**Kafka Events:** `file.deleted`

---

#### POST `/api/v1/projects/:id/secrets`
**Description:** Add environment variable (Vault)

**Request Body:**
```json
{
  "keyName": "DATABASE_URL",
  "value": "postgres://...",
  "environment": "dev"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "keyName": "DATABASE_URL",
    "environment": "dev"
  }
}
```

**Note:** Value goes to HashiCorp Vault, only key stored in DB

---

#### GET `/api/v1/projects/:id/collaborators`
**Description:** List collaborators

**Response (200):**
```json
{
  "success": true,
  "data": {
    "collaborators": [
      { "userId": "uuid", "username": "alice", "role": "editor", "joinedAt": "..." }
    ]
  }
}
```

---

#### POST `/api/v1/projects/:id/invite`
**Description:** Invite collaborator

**Request Body:**
```json
{
  "email": "collab@example.com",
  "role": "editor"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "invitedEmail": "collab@example.com",
    "role": "editor",
    "status": "pending"
  }
}
```

**Kafka Events:** `invitation.created`, `user.invited`

---

#### GET `/api/v1/templates`
**Description:** List project templates

**Response (200):**
```json
{
  "success": true,
  "data": {
    "templates": [
      { "id": "uuid", "name": "Next.js Starter", "slug": "nextjs", "category": "web" },
      { "id": "uuid", "name": "FastAPI Blank", "slug": "fastapi", "category": "api" }
    ]
  }
}
```

---

## 4. AI Service (Port 8003)

### Endpoints

#### POST `/api/v1/ai/generate`
**Description:** Start AI code generation (SSE stream)

**Header:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "projectId": "uuid",
  "prompt": "Build an ecommerce website with user login, product catalog, shopping cart, and checkout",
  "agents": ["pm", "architect", "backend", "frontend", "devops", "qa", "security"]
}
```

**Response (202):**
```json
{
  "success": true,
  "data": {
    "conversationId": "uuid",
    "wsChannel": "ai:uuid"
  }
}
```

**SSE Stream Events:**
```json
{ "agent": "pm", "status": "running", "action": "Analyzing requirements..." }
{ "agent": "pm", "status": "completed", "output": { "prd": "..." } }
{ "agent": "architect", "status": "running", "action": "Designing system..." }
```

**Kafka Events:** `ai.task.completed`, `ai.task.failed`

---

#### GET `/api/v1/ai/stream/:conversation_id`
**Description:** SSE stream for generation progress

**Response:** `Content-Type: text/event-stream`

---

#### GET `/api/v1/ai/conversations`
**Description:** List AI conversations

**Query:** `?projectId=uuid&page=1&limit=20`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "uuid",
        "title": "Ecommerce Website",
        "initialPrompt": "Build an...",
        "status": "completed",
        "totalTokens": 45000,
        "createdAt": "..."
      }
    ]
  }
}
```

---

#### GET `/api/v1/ai/conversations/:id`
**Description:** Get conversation details

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Ecommerce Website",
    "initialPrompt": "Build an...",
    "status": "completed",
    "totalTokens": 45000,
    "totalCostUsd": 0.45,
    "durationMs": 120000,
    "messages": [
      { "agentName": "pm", "role": "assistant", "content": "...", "createdAt": "..." }
    ],
    "generatedFiles": [
      { "filePath": "src/app/page.tsx", "action": "created", "agentName": "frontend" }
    ]
  }
}
```

---

#### POST `/api/v1/ai/retry/:conversation_id`
**Description:** Retry failed agent

**Request Body:**
```json
{ "agents": ["backend"] }
```

**Response (202):**
```json
{ "success": true, "data": { "conversationId": "uuid" } }
```

---

#### POST `/api/v1/ai/cancel/:conversation_id`
**Description:** Cancel running generation

**Response (200):**
```json
{ "success": true, "data": { "status": "cancelled" } }
```

---

#### GET `/api/v1/ai/status/:conversation_id`
**Description:** Get generation status

**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "progressPercent": 65,
    "currentAgent": "frontend",
    "agentsCompleted": ["pm", "architect", "backend"],
    "startedAt": "2026-03-12T00:00:00Z"
  }
}
```

---

## 5. Execution Service (Port 8004)

### Endpoints

#### POST `/api/v1/exec/run`
**Description:** Run code in Firecracker VM

**Header:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "projectId": "uuid",
  "command": "npm run dev",
  "env": { "PORT": "3000" }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sessionId": "uuid",
    "status": "running",
    "wsEndpoint": "/api/v1/exec/ws/uuid"
  }
}
```

---

#### GET `/api/v1/exec/ws/:session_id`
**Description:** WebSocket for terminal I/O

**Response:** `101 Switching Protocols`

**Protocol:** Raw UTF-8 binary stream

---

#### POST `/api/v1/exec/install`
**Description:** Install packages in VM

**Request Body:**
```json
{
  "projectId": "uuid",
  "packageManager": "npm",
  "packages": ["react", "lodash"]
}
```

**Response (202):**
```json
{
  "success": true,
  "data": { "jobId": "uuid" }
}
```

---

#### GET `/api/v1/exec/history`
**Description:** Execution history

**Query:** `?projectId=uuid&page=1&limit=20`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "executions": [
      {
        "id": "uuid",
        "command": "npm run dev",
        "status": "success",
        "exitCode": 0,
        "durationMs": 5000,
        "createdAt": "..."
      }
    ]
  }
}
```

---

#### POST `/api/v1/exec/terminate`
**Description:** Stop running execution

**Request Body:**
```json
{ "sessionId": "uuid" }
```

**Response (200):**
```json
{ "success": true, "data": null }
```

---

## 6. Collab Service (Port 8005)

### Endpoints

#### GET `/api/v1/collab/files/:file_id`
**Description:** Get collaboration document state

**Response (200):**
```json
{
  "success": true,
  "data": {
    "fileId": "uuid",
    "yjsBinaryState": "base64_encoded_binary",
    "lastSyncedAt": "2026-03-12T00:00:00Z"
  }
}
```

---

#### POST `/api/v1/collab/join`
**Description:** Join file collaboration

**Request Body:**
```json
{ "projectId": "uuid", "fileId": "uuid" }
```

**Response (200):**
```json
{ "success": true, "data": { "awareness": { ... } } }
```

---

#### POST `/api/v1/collab/leave`
**Description:** Leave file collaboration

**Request Body:**
```json
{ "fileId": "uuid" }
```

**Response (200):**
```json
{ "success": true, "data": null }
```

---

## 7. Billing Service (Port 8006)

### Endpoints

#### POST `/api/v1/billing/checkout`
**Description:** Create Stripe checkout session

**Header:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "plan": "PRO",
  "successUrl": "https://platform.io/billing/success",
  "cancelUrl": "https://platform.io/billing/cancel"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "url": "https://checkout.stripe.com/c/pay/..." }
}
```

---

#### POST `/api/v1/billing/webhooks/stripe`
**Description:** Stripe webhook handler

**Header:** `Stripe-Signature: t=timestamp,v1=signature`

**Body:** Raw HTTP buffer

**Response (200):** Always return 200 to Stripe

**Kafka Events:** `billing.invoice.paid`, `subscription.updated`

---

#### POST `/api/v1/billing/meter` (Internal)
**Description:** Increment usage counter

**Request Body:**
```json
{
  "userId": "uuid",
  "type": "ai_token",
  "amount": 1000
}
```

**Response (200):**
```json
{ "success": true, "data": { "remaining": 9000 } }
```

**Response (429) - Quota Exceeded:**
```json
{ "success": false, "error": "QUOTA_EXCEEDED" }
```

**Kafka Events:** `usage.limit_reached`

---

#### GET `/api/v1/billing/usage/current`
**Description:** Get current usage

**Header:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "plan": "PRO",
    "status": "active",
    "usage": {
      "aiTokensUsed": 45000,
      "aiTokensLimit": 1000000,
      "vmComputeMinutes": 120,
      "vmComputeLimit": 500,
      "storageGb": 2.5,
      "storageLimit": 10
    }
  }
}
```

---

#### GET `/api/v1/billing/subscription`
**Description:** Get subscription status

**Response (200):**
```json
{
  "success": true,
  "data": {
    "plan": "PRO",
    "status": "active",
    "currentPeriodEnd": "2026-04-12T00:00:00Z",
    "cancelAtPeriodEnd": false
  }
}
```

---

#### POST `/api/v1/billing/portal`
**Description:** Create Stripe customer portal URL

**Response (200):**
```json
{
  "success": true,
  "data": { "url": "https://billing.stripe.com/..." }
}
```

---

## 8. Notification Service (Port 8007)

### Endpoints

#### GET `/api/v1/notifications`
**Description:** List user notifications

**Query:** `?page=1&limit=20&unreadOnly=false`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "uuid",
        "type": "ai_complete",
        "title": "AI Generation Complete",
        "body": "Your ecommerce website is ready",
        "isRead": false,
        "actionUrl": "/projects/uuid",
        "createdAt": "2026-03-12T00:00:00Z"
      }
    ]
  }
}
```

---

#### PUT `/api/v1/notifications/:id`
**Description:** Mark notification as read

**Response (200):**
```json
{ "success": true, "data": { "isRead": true } }
```

---

#### PUT `/api/v1/notifications/read-all`
**Description:** Mark all as read

**Response (200):**
```json
{ "success": true, "data": { "updatedCount": 5 } }
```

---

## 9. Deployment Service (Port 8011)

### Endpoints

#### POST `/api/v1/deploy/preview`
**Description:** Deploy preview URL

**Request Body:**
```json
{
  "projectId": "uuid",
  "branch": "feature-login"
}
```

**Response (202):**
```json
{
  "success": true,
  "data": {
    "deploymentId": "uuid",
    "wsChannel": "deploy:uuid"
  }
}
```

---

#### POST `/api/v1/deploy/production`
**Description:** Deploy to production

**Request Body:**
```json
{
  "projectId": "uuid",
  "branch": "main",
  "provider": "vercel",
  "buildCommand": "npm run build",
  "outputDir": ".next"
}
```

**Response (202):**
```json
{
  "success": true,
  "data": {
    "deploymentId": "uuid",
    "wsChannel": "deploy:uuid"
  }
}
```

---

#### GET `/api/v1/deploy/history/:project_id`
**Description:** Deployment history

**Query:** `?limit=20&cursor=...`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "deployments": [
      {
        "id": "uuid",
        "branch": "main",
        "status": "deployed",
        "url": "https://my-app.platform.io",
        "commitSha": "abc123",
        "createdAt": "...",
        "deployedAt": "..."
      }
    ]
  }
}
```

---

#### POST `/api/v1/deploy/rollback/:deployment_id`
**Description:** Rollback to previous deployment

**Response (202):**
```json
{
  "success": true,
  "data": { "newDeploymentId": "uuid" }
}
```

---

#### POST `/api/v1/deploy/domains`
**Description:** Add custom domain

**Request Body:**
```json
{
  "projectId": "uuid",
  "domainName": "www.myblog.com"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "domainName": "www.myblog.com",
    "cnameTarget": "my-blog.platform-deploy.io",
    "dnsVerified": false,
    "sslStatus": "pending"
  }
}
```

---

#### DELETE `/api/v1/deploy/domains/:id`
**Description:** Remove custom domain

**Response (200):**
```json
{ "success": true, "data": null }
```

---

## 10. Search Service (Port 8008)

### Endpoints

#### GET `/api/v1/search/code`
**Description:** Search code

**Query:** `?q=function+add&projectId=uuid&limit=20`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "filePath": "src/utils.ts",
        "snippet": "export function add(a: number, b: number) {",
        "projectName": "my-app"
      }
    ]
  }
}
```

---

#### GET `/api/v1/search/projects`
**Description:** Search public projects

**Query:** `?q=ecommerce&limit=20`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "projects": [
      { "id": "uuid", "name": "ecommerce-starter", "description": "...", "stars": 50 }
    ]
  }
}
```

---

## 11. Storage Service (Port 8009)

### Endpoints

#### POST `/api/v1/storage/upload`
**Description:** Upload file to S3

**Content-Type:** multipart/form-data

**Response (201):**
```json
{
  "success": true,
  "data": {
    "key": "projects/uuid/files/uuid",
    "url": "https://storage.platform.io/...",
    "sizeBytes": 1024000
  }
}
```

---

#### GET `/api/v1/storage/download/:key`
**Description:** Download file

**Response:** File stream

---

#### DELETE `/api/v1/storage/:key`
**Description:** Delete file

**Response (200):**
```json
{ "success": true, "data": null }
```

---

#### GET `/api/v1/storage/stats`
**Description:** Storage usage stats

**Response (200):**
```json
{
  "success": true,
  "data": {
    "totalBytes": 5000000000,
    "fileCount": 150
  }
}
```

---

## 12. Analytics Service (Port 8010)

### Endpoints

#### GET `/api/v1/admin/analytics/overview`
**Description:** Platform analytics (admin only)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "totalUsers": 10000,
    "activeUsers": 5000,
    "totalProjects": 25000,
    "totalDeployments": 50000,
    "revenue": { "monthly": 50000, "arr": 600000 }
  }
}
```

---

#### GET `/api/v1/admin/usage**
**Description:** Usage metrics

**Response (200):**
```json
{
  "success": true,
  "data": {
    "aiTokensUsed": 100000000,
    "computeMinutes": 500000,
    "storageGb": 1000
  }
}
```

---

#### GET `/api/v1/admin/feature-flags**
**Description:** List feature flags

**Response (200):**
```json
{
  "success": true,
  "data": {
    "flags": [
      { "key": "new_ai_model", "enabled": true, "rolloutPercentage": 10 }
    ]
  }
}
```

---

#### POST `/api/v1/admin/feature-flags`
**Description:** Create feature flag

**Request Body:**
```json
{
  "key": "new_ai_model",
  "description": "Use new AI model",
  "enabled": false,
  "rolloutPercentage": 0
}
```

---

#### PUT `/api/v1/admin/feature-flags/:key`
**Description:** Update feature flag

**Request Body:**
```json
{ "enabled": true, "rolloutPercentage": 50 }
```

---

## 13. WebSocket Gateway

### Connection
**URL:** `wss://ws.platform.io/gateway`  
**Auth:** JWT in query string or initial message

### Channels

| Channel | Format | Description |
|---------|--------|-------------|
| `collab:{projectId}:{fileId}` | Yjs binary | Real-time editor sync |
| `terminal:{sessionId}` | UTF-8 text | Terminal I/O |
| `ai:{conversationId}` | JSON (SSE-like) | AI agent progress |
| `notifications:{userId}` | JSON | Push notifications |
| `deploy:{deploymentId}` | UTF-8 text | Build log stream |
| `preview.hmr:{projectId}` | JSON | Live reload events |
| `presence:{projectId}` | JSON | User cursor positions |

### Message Format
```json
{
  "channel": "collab:projectId:fileId",
  "type": "update",
  "payload": "base64_binary_data"
}
```

---

## 14. Common Response Schema

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "trace_id": "req-uuid"
}
```

### Error Response
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": { "field": "email" }
  },
  "trace_id": "req-uuid"
}
```

### HTTP Status Codes
- `200` - OK
- `201` - Created
- `202` - Accepted (async)
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict (duplicate)
- `422` - Unprocessable Entity
- `429` - Too Many Requests
- `500` - Internal Server Error
- `503` - Service Unavailable
