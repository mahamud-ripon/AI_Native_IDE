# AI-Native IDE Platform - Developer Guidelines

**Version:** 1.0  
**Date:** March 12, 2026  
**Purpose:** Action items for developers based on analysis findings

---

## Priority 1: Critical (Must Fix Before Production)

### 1.1 Database - Soft Deletes

**Problem:** Many tables use hard delete with `ON DELETE CASCADE`, risking data loss.

**Files to modify:**
- `platform/packages/database/prisma/schema.prisma`

**Action:** Add `deletedAt` timestamp for soft delete on critical tables:

```prisma
// Add to: users, projects, project_files, organizations
deletedAt DateTime? @map("deleted_at") @db.Timestamptz()

// Update all delete queries to use:
// prisma.project.update({ where: { id: id }, data: { deletedAt: new Date() } })
```

**Status:** ✅ Done — `status` field (ProjectStatus enum) and `deletedAt` soft delete added to schema.

> See `ARCHITECTURE_STANDARDS.md §5` for SAGA lifecycle definition.

---

### 1.2 Database - File Storage Strategy

**Clarification:** `inline_content` (BYTEA) is **intentional** per `ARCHITECTURE_STANDARDS.md §7`.

- Files ≤ 64KB → stored inline in PostgreSQL (avoids S3 round-trip)
- Files > 64KB → stored in S3, referenced by `s3_key`
- The `content_hash` (SHA-256) field enables deduplication in both paths

**Action:** No schema change needed. Ensure `project-service` implements the threshold logic.

**Status:** ✅ Architecture Decision Documented

---

### 1.3 API - Circuit Breaker

**Problem:** Service failure can cascade. No resilience pattern.

**Files to modify:**
- `services/api-gateway/src/proxy/circuit_breaker.ts` (already exists)
- All service clients

**Action:** Circuit breaker is already implemented in API gateway using `opossum` (Node.js). Ensure all inter-service HTTP calls also use the pattern:

```typescript
import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(callExternalService, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

breaker.fallback(() => ({ error: 'SERVICE_UNAVAILABLE' }));
```

**Status:** 🟡 Partial — Gateway has it, individual services need it

---

### 1.4 Infrastructure - Disaster Recovery

**Problem:** No backup strategy defined.

**Files to modify:**
- `infra/terraform/backups/` (new)
- `infra/kubernetes/base/`

**Action:** 
1. Create PostgreSQL automated backups (daily) with 30-day retention
2. Add cross-region replication for S3 buckets
3. Document recovery procedure in `docs/disaster-recovery.md`

**Status:** ⬜ Not Started

---

## Priority 2: High (Fix Before Beta)

### 2.1 AI - Vendor Lock Prevention

**Problem:** Heavy reliance on Claude/GPT APIs with no fallback.

**Files to modify:**
- `services/ai-service/src/orchestrator/router.py`
- `packages/ai-core/src/providers/` (new)

**Action:** Implement multi-provider fallback in the `ai-agents` Python module:

```typescript
// ai-service (TypeScript) calls ai-agents (Python) via HTTP
// The Python LLM router handles actual provider fallback:
// Priority: Anthropic → OpenAI → Gemini → Local (Llama)

// ai-agents/src/llm-router/cost_manager.py handles this logic
// ai-service just calls: POST http://ai-agents:9000/generate
```

**Status:** ⬜ Not Started

---

### 2.2 Database - Composite Indexes

**Problem:** Missing indexes for common query patterns.

**Files to modify:**
- `platform/packages/database/prisma/schema.prisma`

**Action:** Add composite indexes:

```prisma
// For ai_messages - common query by conversation + created_at
@@index([conversationId, createdAt])

// For projects - common query by owner + status
@@index([ownerId, status])

// For deployments - common query by project + status
@@index([projectId, status])
```

**Status:** ✅ Done — `@@index([conversationId, createdAt])` and `@@index([status])` added to schema.

---

### 2.3 API - Versioning Strategy

**Decision:** URL-based versioning (per `ARCHITECTURE_STANDARDS.md §2`)

**Standard:**
- All routes: `/api/v1/{resource}`
- Breaking changes: `/api/v2/{resource}`
- 12-month deprecation policy

**Files to modify:**
- `services/api-gateway/src/routes/proxy_router.ts` (already uses `/api/v1/`)

**Status:** ✅ Architecture Decision Documented — Gateway already uses URL-based versioning.

---

### 2.4 Frontend - Bundle Optimization

**Problem:** Monaco Editor + Yjs = large bundle size.

**Files to modify:**
- `apps/web/next.config.js`
- `apps/web/src/components/Editor.tsx`

**Action:** Implement lazy loading:

```javascript
// next.config.js
nextConfig = {
  dynamicImports: {
    chunks: 'all',
    modules: ['monaco-editor', 'yjs', 'y-websocket']
  }
}

// Lazy load editor
const MonacoEditor = dynamic(() => import('./MonacoEditor'), {
  ssr: false,
  loading: () => <EditorSkeleton />
})
```

**Status:** ⬜ Not Started

---

## Priority 3: Medium (Fix Before Launch)

### 3.1 API - OpenAPI Documentation

**Problem:** No visible API schema.

**Files to modify:**
- All Fastify services must mount `prometheus-api-metrics` middleware.
- All routes must have docstrings and response models:

```python
from pydantic import BaseModel

class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str | None

@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: str) -> UserResponse:
    """Get user by ID.
    
    Returns user details including profile information.
    """
    return await get_user_by_id(user_id)
```

**Status:** ⬜ Not Started

---

### 3.2 Frontend - PWA Offline Support

**Problem:** No offline capability.

**Files to modify:**
- `apps/web/public/manifest.json` (new)
- `apps/web/public/sw.js` (new)

**Action:** Add service worker for offline support:

```javascript
// Cache strategies:
// - Static assets: Cache First
// - API calls: Network First
// - Editor files: Stale While Revalidate
```

**Status:** ⬜ Not Started

---

### 3.3 Infrastructure - Cost Optimization

**Problem:** No spot instances for batch jobs.

**Files to modify:**
- `infra/kubernetes/workloads/`

**Action:** Use spot instances for AI workers:

```yaml
# deployment.yaml
nodeSelector:
  workload-type: batch
tolerations:
  - key: "spot"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
```

**Status:** ⬜ Not Started

---

### 3.4 Database - Pagination

**Problem:** Some relations lack pagination (e.g., `ai_messages`).

**Files to modify:**
- `services/ai-service/src/routes/conversations.py`
- `services/project-service/src/routes/files.py`

**Action:** Add cursor-based pagination:

```python
from pydantic import BaseModel

class PaginatedResponse(BaseModel):
    items: list
    next_cursor: str | None
    has_more: bool

@app.get("/conversations/{id}/messages")
async def get_messages(
    conversation_id: str,
    limit: int = 50,
    cursor: str | None = None
) -> PaginatedResponse:
    messages = await prisma.aiMessage.findMany({
        "where": { "conversationId": conversation_id },
        "take": limit + 1,
        "cursor": {"id": cursor} if cursor else None,
        "orderBy": { "createdAt": "desc" }
    })
    # Return paginated response
```

**Status:** ⬜ Not Started

---

## Implementation Checklist

| Priority | Task | Owner | Status |
|----------|------|-------|--------|
| 1.1 | Add soft deletes to Prisma schema | TBD | ⬜ |
| 1.2 | Remove BYTEA blob storage | TBD | ⬜ |
| 1.3 | Add circuit breaker to services | TBD | ⬜ |
| 1.4 | Implement disaster recovery | TBD | ⬜ |
| 2.1 | Add AI provider fallback | TBD | ⬜ |
| 2.2 | Add composite indexes | TBD | ⬜ |
| 2.3 | Implement API versioning | TBD | ⬜ |
| 2.4 | Lazy load Monaco Editor | TBD | ⬜ |
| 3.1 | Add OpenAPI documentation | TBD | ⬜ |
| 3.2 | Add PWA offline support | TBD | ⬜ |
| 3.3 | Use spot instances for batch | TBD | ⬜ |
| 3.4 | Add pagination to list endpoints | TBD | ⬜ |

---

## Notes for Developers

1. **Database migrations:** Run `npx prisma migrate dev` after schema changes
2. **Testing:** All fixes require unit + integration tests
3. **Code review:** All PRs need 2 approvals
4. **Documentation:** Update API docs in `docs/api/` after changes

---

*Last Updated: March 12, 2026*
