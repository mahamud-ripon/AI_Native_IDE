# 🔄 Database Migration Strategy — AI-Native IDE Platform

> **Applies to:** All services connecting to PostgreSQL  
> **ORM:** Prisma (TypeScript services), SQLAlchemy + Alembic (Python services)  
> **Database:** PostgreSQL 16  
> **Standard:** Zero-downtime migrations. Versioned. Reviewable. Rollbackable.

---

## 📋 Migration Naming Convention

All migration files MUST follow this naming pattern:

```
{YYYYMMDD}_{sequence}_{service}_{description}
```

**Examples:**
```
20260301_001_auth_create_users_table
20260301_002_auth_create_refresh_tokens_table
20260302_001_project_create_projects_table
20260302_002_project_create_project_files_table
20260310_001_billing_add_usage_daily_table
```

**Rules:**
- Date is the creation date (UTC).
- Sequence starts at 001 per day, per service.
- Service name matches the folder name in `platform/services/`.
- Description uses snake_case, verb-first: `create`, `add`, `rename`, `drop`, `alter`.

---

## 🏗️ Migration Workflow

### For TypeScript Services (Prisma)

```bash
# 1. Edit the Prisma schema
edit prisma/schema.prisma

# 2. Generate migration (DO NOT apply directly to production)
npx prisma migrate dev --name "add_status_to_projects"

# 3. Review the generated SQL in prisma/migrations/{timestamp}_{name}/migration.sql
# MUST be reviewed by another developer before merge.

# 4. In CI/CD staging: auto-apply
npx prisma migrate deploy

# 5. In Production: apply via deployment pipeline (ArgoCD)
# See §Zero-Downtime below.
```

### For Python Services (Alembic)

```bash
# 1. Edit SQLAlchemy models in src/db/models.py
edit src/db/models.py

# 2. Auto-generate migration
alembic revision --autogenerate -m "add_status_to_projects"

# 3. Review generated migration in alembic/versions/{hash}_{message}.py
# MUST be reviewed by another developer before merge.

# 4. Apply
alembic upgrade head

# 5. Rollback
alembic downgrade -1
```

---

## ⚠️ Zero-Downtime Migration Patterns

### The Expand-Contract Pattern (MANDATORY for schema changes)

**Problem:** If you rename a column from `cost_cents` to `total_cost_usd`, old application instances (during blue/green deployment) will crash because they still reference `cost_cents`.

**Solution: 3-Phase Expand-Contract:**

#### Phase 1: EXPAND (Add new, keep old)
```sql
-- Migration 001: Add new column, backfill, keep old
ALTER TABLE ai_conversations ADD COLUMN total_cost_usd NUMERIC(10,6);
UPDATE ai_conversations SET total_cost_usd = cost_cents / 100.0;
-- DO NOT DROP cost_cents yet!
```
- Deploy new app version that writes to BOTH columns.
- Old instances still work because `cost_cents` exists.

#### Phase 2: MIGRATE (Switch reads)
```sql
-- No SQL change. Just deploy the app update that reads from
-- total_cost_usd instead of cost_cents.
```
- All instances now read from `total_cost_usd`.
- Wait for all old instances to drain (at least 1 full deployment cycle).

#### Phase 3: CONTRACT (Remove old)
```sql
-- Migration 002: Safe to drop old column (all readers updated)
ALTER TABLE ai_conversations DROP COLUMN cost_cents;
```
- Only run this AFTER Phase 2 has been in production for ≥1 week.

---

## 🔒 Migration Safety Rules

### NEVER Do These in Production:
| ❌ Banned Operation | ✅ Safe Alternative |
| :--- | :--- |
| `ALTER TABLE DROP COLUMN` (without expand-contract) | Use 3-phase expand-contract pattern |
| `ALTER TABLE RENAME COLUMN` | Add new column → backfill → drop old |
| `ALTER TABLE ALTER TYPE` (changing column type) | Add new column with new type → backfill → drop old |
| `CREATE INDEX` (on large tables without CONCURRENTLY) | `CREATE INDEX CONCURRENTLY` (non-blocking) |
| `LOCK TABLE` or `ALTER TABLE SET NOT NULL` on populated tables | Add constraint as `NOT VALID`, then `VALIDATE CONSTRAINT` separately |
| Manual SQL execution on production DB | Always use migration files tracked in Git |

### ALWAYS Do These:
| ✅ Rule | Why |
| :--- | :--- |
| Every migration has a corresponding down/rollback | Enables emergency rollback |
| Migration files are committed to Git | Audit trail + reproducibility |
| Migrations run in CI before merge | Catch syntax errors early |
| Large data backfills run as background tasks | Prevent table locks during migration |
| Test migrations on a staging DB clone first | Catch constraint violations |

---

## 📊 Schema Ownership Matrix

Each service owns specific tables. **A service MUST NEVER write to tables it doesn't own.** Cross-service data access goes through APIs or Kafka events.

| Service | Owns Tables | Read-Only Access |
| :--- | :--- | :--- |
| `auth-service` | `users`, `refresh_tokens`, `oauth_accounts`, `api_keys`, `user_settings` | — |
| `project-service` | `projects`, `project_files`, `project_branches`, `file_versions`, `project_collaborators`, `invitations`, `project_snapshots`, `project_secrets`, `project_domains`, `project_templates` | `users` (via API) |
| `ai-service` | `ai_conversations`, `ai_messages`, `ai_generated_files`, `ai_generation_tasks`, `code_issues`, `code_embeddings`, `ai_feedback` | `projects`, `project_files` (via API) |
| `execution-service` | `code_executions` | `projects` (via API) |
| `billing-service` | `subscriptions`, `usage_records`, `usage_daily` | `users` (via API) |
| `notification-service` | `notifications` | — |
| `deployment-service` | `deployments` | `projects`, `project_secrets` (via API) |
| `analytics-service` | `feature_flags`, `analytics_snapshots` | `subscriptions`, `usage_daily` (read replicas) |
| `collab-service` | `collab_documents` | — |
| **Shared** | `audit_logs` | All services can write |

---

## 🚀 Rollback Procedure

### Automatic (CI/CD)
1. ArgoCD detects health check failure after migration.
2. Triggers automatic rollback to previous Docker image.
3. **Important Prisma Limitation:** Prisma does NOT support automatic "down" migrations. CI/CD MUST NOT attempt a down migration for Prisma. If the schema change causes an outage, the team must execute a "Forward Fix" (create a new PR that explicitly reverts the schema and implements the custom SQL rollback to reverse the damage), or run a manual restore script.
4. Alembic (Python): `alembic downgrade -1` runs automatically during Kubernetes pre-rollback hooks.

### Manual (Emergency)
```bash
# 1. Identify the bad migration
prisma migrate status  # or: alembic history

# 2. Rollback
prisma migrate resolve --rolled-back {migration_name}
# or: alembic downgrade -1

# 3. Deploy previous Git tag
git revert {commit} && git push  # ArgoCD auto-deploys
```

---

## 📅 Migration Checklist (PR Template)

Before merging any migration PR, confirm:

- [ ] Migration file follows naming convention
- [ ] Down migration / rollback script exists
- [ ] No banned operations (DROP/RENAME without expand-contract)
- [ ] Large table alterations use `CONCURRENTLY` or background tasks
- [ ] Staging DB migration tested successfully
- [ ] Schema ownership respected (no cross-service table writes)
- [ ] PR reviewed by at least 1 backend engineer
