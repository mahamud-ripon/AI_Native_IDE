# 🗄️ Database Tier — Development Logic & Architecture

> **Target:** `packages/database/` (Prisma / SQLAlchemy)
> **Goal:** The single source of truth for the platform schema. All tables matching the ERD, maintaining strict relational integrity.

## 📁 Required File Structure (Developer must follow)
```text
prisma/                       (Or Alembic if Py)
 ├── schema.prisma            # The raw tables definition
 └── migrations/              # Strict version-controlled SQL diffs
src/
 ├── client.ts                # Connection pooling logic (PgBouncer)
 ├── vector_ops.ts            # pgvector embedding queries
 └── rls/                     # Row-Level Security definitions
```

## 🧠 Core Logic Rules for Developer

### 1. The ERD Blueprint Adherence
- **Constraint:** Do NOT invent tables. Strictly implement all the tables documented in `Interactive_Schema_Design_ERD.md`.
- **Core Entities:**
  - `users` ➔ `projects` ➔ `project_files` (Filesystem hierarchy).
  - `users` ➔ `organizations` ➔ `subscriptions` (Stripe billing logic).
  - `conversations` ➔ `messages` ➔ `prompts` (AI workflow state).
- **Triggers:** Ensure `updated_at` timestamps auto-update via DB triggers.

### 2. Vector Embeddings (RAG)
- **Constraint:** Standard DB searches are too slow for AI context lookup.
- **Logic:**
  - Ensure the `pgvector` extension is enabled in PostgreSQL.
  - The `code_embeddings` table must use a `vector` column containing the embeddings. Dimension depends on model config (e.g., OpenAI: 1536, Voyage: 1024). Do not hardcode the dimension, read from config.
  - Use `HNSW` (Hierarchical Navigable Small World) indexes for fast cosine similarity nearest-neighbor (`<=>`) code search.

### 3. Connection Limits & PgBouncer
- **Constraint:** 9 microservices hitting the DB simultaneously will exceed `max_connections`.
- **Logic:**
  - The application MUST connect through `PgBouncer` (Transaction mode).
  - Prisma connection pooling must be configured optimally inside `src/client.ts`.

### 4. Zero Secrets in DB
- **Constraint:** `.env` keys cannot be stored in plain text.
- **Logic:**
  - The `vault_secrets` table tracks the metadata (e.g., `key_name`, `project_id`).
  - The actual secret value is NEVER stored here. It is stored externally in HashiCorp Vault. The application queries Vault using the UUID from this table.
