# Neon.tech Database Setup Guide

> **Target Audience:** Backend Developers, DevOps Engineers
> **Last Updated:** March 2026

---

## 1. Why Neon.tech?

| Feature | Benefit |
|---------|---------|
| **Serverless PostgreSQL** | Auto-suspend after inactivity (cost savings) |
| **Branching** | Create database branches for testing/preview |
| **pgvector Support** | Native support for AI embeddings |
| **Connection Pooling** | Built-in PgBouncer for serverless workloads |
| **Automatic Scaling** | Scale compute up/down based on load |

---

## 2. Prerequisites

- Neon account: [console.neon.tech](https://console.neon.tech)
- Project created in Neon dashboard
- Connection string from Neon console

---

## 3. Setup Steps

### Step 1: Create Neon Project

1. Go to [console.neon.tech](https://console.neon.tech)
2. Click **"Create a project"**
3. Name: `ai-native-ide` (or your preferred name)
4. Region: Choose closest to your users (e.g., `US East (Ohio)`)
5. Click **"Create project"**
6. **Copy the connection string** (shown once)

### Step 2: Configure Environment

For **local development**, update `.env`:

```bash
# Neon Pooled Connection (recommended for Prisma)
DATABASE_URL="postgresql://[user]:[password]@[endpoint]-pooler.neon.tech/[database]?sslmode=require&pgbouncer=true"
```

For **migrations** (use direct connection):

```bash
# Neon Direct Connection (for migrations only)
DATABASE_URL="postgresql://[user]:[password]@[endpoint].neon.tech/[database]?sslmode=require"
```

### Step 3: Enable pgvector Extension

Neon supports pgvector out of the box. Run this SQL in Neon SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Or via Prisma migration (already in schema):

```bash
pnpm --filter @workspace/database db:migrate
```

### Step 4: Run Migrations

```bash
# Generate Prisma client
pnpm --filter @workspace/database db:generate

# Deploy migrations to Neon
DATABASE_URL="your-neon-direct-connection" pnpm --filter @workspace/database db:migrate:deploy
```

### Step 5: Verify Connection

```bash
# Open Prisma Studio (connects to Neon)
DATABASE_URL="your-neon-connection" pnpm --filter @workspace/database db:studio
```

---

## 4. Connection String Formats

### Direct Connection
```
postgresql://[user]:[password]@[endpoint].neon.tech/[database]?sslmode=require
```
- Use for: **Migrations, admin tasks, long-running processes**
- No connection pooling

### Pooled Connection (PgBouncer)
```
postgresql://[user]:[password]@[endpoint]-pooler.neon.tech/[database]?sslmode=require&pgbouncer=true
```
- Use for: **Serverless functions, API services, Prisma Client**
- Limits: No prepared statements (PgBouncer limitation)

---

## 5. Environment Configuration

### Development (`.env.development`)
```bash
DATABASE_URL="postgresql://user:pass@ep-dev-xyz.neon.tech/dev_db?sslmode=require&pgbouncer=true"
```

### Production (`.env.production`)
```bash
DATABASE_URL="postgresql://user:pass@ep-prod-xyz.neon.tech/prod_db?sslmode=require&pgbouncer=true"
```

### CI/CD (GitHub Actions)
```yaml
env:
  DATABASE_URL: ${{ secrets.NEON_DATABASE_URL }}
```

---

## 6. Migrating Existing Data

> **Follow the project's migration strategy:** See `DATABASE_MIGRATION_STRATEGY.md` for zero-downtime patterns.

### Option A: pg_dump + pg_restore (Recommended for initial migration)

```bash
# Step 1: Dump from local Docker PostgreSQL
docker exec ai-native-db pg_dump -U ainative -d ainative_ide --no-owner --no-acl > backup.sql

# Step 2: Restore to Neon (use direct connection, not pooled)
psql "postgresql://user:pass@ep-xyz.neon.tech/db?sslmode=require" < backup.sql

# Step 3: Verify data
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users;"
```

### Option B: Prisma Migration (Schema only, no data)

```bash
# Use DIRECT connection for migrations (not pooled)
DATABASE_URL="postgresql://user:pass@ep-xyz.neon.tech/db?sslmode=require" \
  pnpm --filter @workspace/database db:migrate:deploy

# Generate Prisma client
pnpm --filter @workspace/database db:generate
```

### Option C: Neon Import Feature (Easiest)

1. Go to Neon Console → Project → **"Import data"**
2. Upload SQL dump or connect to source database
3. Neon handles the import automatically

### Option D: Neon Branching for Safe Migration

```bash
# Create a branch for testing migration
neon branches create --name migration-test

# Get branch connection string
neon connection-string migration-test

# Test migrations on branch first
DATABASE_URL="branch-connection" pnpm --filter @workspace/database db:migrate:deploy

# If successful, promote to main
neon branches promote migration-test
```

---

## 6.1 Migration Checklist

Before migrating to Neon:

- [ ] Backup local database (`pg_dump`)
- [ ] Create Neon project
- [ ] Enable pgvector extension in Neon
- [ ] Run migrations with **direct connection**
- [ ] Import data (if any)
- [ ] Switch to **pooled connection** for application
- [ ] Verify all services connect successfully
- [ ] Update CI/CD environment variables
- [ ] Test in staging environment first

---

## 7. Best Practices

### Connection Pooling
- **Always use pooled connection** for API services
- **Use direct connection** for migrations only

### Prepared Statements
PgBouncer in transaction mode doesn't support prepared statements. Prisma handles this automatically when `pgbouncer=true` is set.

### Cold Starts
Neon auto-suspends after 5 minutes of inactivity. First query may take 1-2 seconds to wake up.

### Branching
Use Neon branching for:
- Preview deployments
- Testing migrations
- Feature development

```bash
# Create branch via Neon CLI
neon branches create --name preview-pr-123
```

---

## 8. Troubleshooting

### Error: "SSL required"
Add `sslmode=require` to connection string.

### Error: "Too many connections"
Switch to pooled connection (`-pooler.neon.tech`).

### Error: "prepared statement already exists"
This happens with PgBouncer. Add `pgbouncer=true` to connection string.

### Slow first query
Normal behavior - Neon is waking up from suspend. Consider:
- Using Neon's "Always On" feature (paid)
- Implementing warm-up queries in health checks

---

## 9. Cost Optimization

| Setting | Recommendation |
|---------|----------------|
| Auto-suspend | 5 minutes (default) |
| Compute size | Start with 0.25 CU, scale as needed |
| Storage | Neon provides 10GB free tier |

---

## 10. Quick Reference Commands

```bash
# Generate Prisma client
pnpm --filter @workspace/database db:generate

# Deploy migrations to Neon
pnpm --filter @workspace/database db:migrate:deploy

# Open Prisma Studio
pnpm --filter @workspace/database db:studio

# Check database status
psql "$DATABASE_URL" -c "SELECT version();"
```

---

## 11. Support Links

- [Neon Documentation](https://neon.tech/docs)
- [Prisma with Neon](https://www.prisma.io/docs/guides/database/neon)
- [pgvector Extension](https://neon.tech/docs/extensions/pgvector)
