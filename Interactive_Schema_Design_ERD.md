import { useState } from "react";

const SCHEMAS = {
  users_org: {
    label: "👤 Users & Organizations",
    color: "#3b82f6",
    tables: [
      {
        name: "users",
        color: "#3b82f6",
        desc: "Platform user accounts",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true, desc: "Primary key" },
          { name: "email", type: "VARCHAR(255)", uk: true, nn: true, idx: true, desc: "Unique email address" },
          { name: "username", type: "VARCHAR(50)", uk: true, nn: true, idx: true, desc: "Public handle" },
          { name: "hashed_password", type: "TEXT", desc: "bcrypt hash, null for OAuth users" },
          { name: "full_name", type: "VARCHAR(255)", desc: "Display name" },
          { name: "avatar_url", type: "TEXT", desc: "Profile picture URL" },
          { name: "stripe_customer_id", type: "VARCHAR(255)", uk: true, desc: "Stripe customer reference" },
          { name: "is_verified", type: "BOOLEAN", nn: true, desc: "Email verified flag" },
          { name: "is_active", type: "BOOLEAN", nn: true, desc: "Account active/suspended" },
          { name: "mfa_enabled", type: "BOOLEAN", nn: true, desc: "TOTP MFA status" },
          { name: "mfa_secret", type: "TEXT", desc: "Encrypted TOTP secret" },
          { name: "last_active_at", type: "TIMESTAMPTZ", desc: "Last seen timestamp" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true, desc: "Account creation time" },
          { name: "updated_at", type: "TIMESTAMPTZ", nn: true, desc: "Last update time" },
        ]
      },
      {
        name: "refresh_tokens",
        color: "#3b82f6",
        desc: "JWT refresh token tracking & revocation",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true, idx: true },
          { name: "token_hash", type: "VARCHAR(64)", uk: true, nn: true, desc: "SHA-256 hash of refresh token" },
          { name: "device_info", type: "TEXT", desc: "User-Agent / device fingerprint" },
          { name: "ip_address", type: "INET", desc: "IP at token creation" },
          { name: "is_revoked", type: "BOOLEAN", nn: true, desc: "Revoked on logout or rotation" },
          { name: "expires_at", type: "TIMESTAMPTZ", nn: true, desc: "7-day rolling expiry" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "oauth_accounts",
        color: "#3b82f6",
        desc: "OAuth provider links per user",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true, idx: true },
          { name: "provider", type: "ENUM", nn: true, desc: "github | google | gitlab" },
          { name: "provider_user_id", type: "VARCHAR(255)", nn: true, desc: "Provider's user ID" },
          { name: "access_token", type: "TEXT", desc: "Encrypted OAuth access token" },
          { name: "refresh_token", type: "TEXT", desc: "Encrypted refresh token" },
          { name: "token_expires_at", type: "TIMESTAMPTZ" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "organizations",
        color: "#3b82f6",
        desc: "Team / company workspaces",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "name", type: "VARCHAR(255)", nn: true },
          { name: "slug", type: "VARCHAR(100)", uk: true, nn: true, idx: true },
          { name: "owner_id", type: "UUID", fk: "users.id", nn: true },
          { name: "seat_limit", type: "INTEGER", nn: true },
          { name: "logo_url", type: "TEXT" },
          { name: "stripe_subscription_id", type: "VARCHAR(255)", uk: true },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "org_members",
        color: "#3b82f6",
        desc: "User ↔ Organization membership",
        fields: [
          { name: "org_id", type: "UUID", fk: "organizations.id", nn: true, pk: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true, pk: true },
          { name: "role", type: "ENUM", nn: true, desc: "owner | admin | developer | viewer" },
          { name: "invited_by", type: "UUID", fk: "users.id" },
          { name: "joined_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "api_keys",
        color: "#3b82f6",
        desc: "Programmatic API access keys",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true, idx: true },
          { name: "name", type: "VARCHAR(255)", nn: true, desc: "Human-readable key name" },
          { name: "key_hash", type: "VARCHAR(64)", uk: true, nn: true, desc: "bcrypt hash — never store plaintext" },
          { name: "key_prefix", type: "VARCHAR(8)", nn: true, desc: "First 8 chars for identification" },
          { name: "scopes", type: "JSONB", nn: true, desc: "Permitted scopes array" },
          { name: "last_used_at", type: "TIMESTAMPTZ" },
          { name: "expires_at", type: "TIMESTAMPTZ", desc: "Null = never expires" },
          { name: "is_active", type: "BOOLEAN", nn: true },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "user_settings",
        color: "#3b82f6",
        desc: "User preferences & IDE configuration",
        fields: [
          { name: "user_id", type: "UUID", fk: "users.id", pk: true, nn: true },
          { name: "theme", type: "VARCHAR(20)", nn: true, desc: "dark | light | system" },
          { name: "editor_font_size", type: "INTEGER", nn: true, desc: "Default 14" },
          { name: "editor_tab_size", type: "INTEGER", nn: true, desc: "Default 2" },
          { name: "editor_keybindings", type: "VARCHAR(20)", nn: true, desc: "default | vim | emacs" },
          { name: "ai_model_preference", type: "VARCHAR(50)", desc: "Preferred AI model" },
          { name: "notification_prefs", type: "JSONB", nn: true, desc: "Email, push, in-app toggles" },
          { name: "updated_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
    ]
  },
  projects: {
    label: "📁 Projects & Files",
    color: "#10b981",
    tables: [
      {
        name: "projects",
        color: "#10b981",
        desc: "Developer projects / workspaces",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "owner_id", type: "UUID", fk: "users.id", nn: true, idx: true },
          { name: "org_id", type: "UUID", fk: "organizations.id", idx: true, desc: "Null for personal projects" },
          { name: "name", type: "VARCHAR(255)", nn: true },
          { name: "slug", type: "VARCHAR(100)", nn: true, idx: true },
          { name: "description", type: "TEXT" },
          { name: "template", type: "VARCHAR(100)", desc: "nextjs | fastapi | blank | ..." },
          { name: "language", type: "VARCHAR(50)", desc: "Primary language" },
          { name: "visibility", type: "ENUM", nn: true, desc: "private | public | org" },
          { name: "status", type: "ENUM", nn: true, desc: "pending | active | failed_creation | archived | deleted — SAGA lifecycle" },
          { name: "git_repo_url", type: "TEXT" },
          { name: "framework", type: "VARCHAR(100)" },
          { name: "last_opened_at", type: "TIMESTAMPTZ" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
          { name: "updated_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "project_branches",
        color: "#10b981",
        desc: "Git-like branches per project",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "name", type: "VARCHAR(100)", nn: true, desc: "e.g., main, v2-refactor" },
          { name: "is_default", type: "BOOLEAN", nn: true },
          { name: "head_commit_sha", type: "VARCHAR(40)" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "project_files",
        color: "#10b981",
        desc: "File metadata (content in S3 or inline for <64KB)",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "branch_id", type: "UUID", fk: "project_branches.id", nn: true, idx: true },
          { name: "parent_id", type: "UUID", fk: "project_files.id", idx: true, desc: "Parent directory — enables O(1) tree traversal" },
          { name: "path", type: "TEXT", nn: true, desc: "Full path e.g. src/app/page.tsx" },
          { name: "name", type: "VARCHAR(255)", nn: true },
          { name: "content_hash", type: "VARCHAR(64)", desc: "SHA-256 of file content" },
          { name: "s3_key", type: "TEXT", desc: "S3 object key (null if inline)" },
          { name: "inline_content", type: "BYTEA", desc: "Direct content for files <64KB" },
          { name: "size_bytes", type: "INTEGER" },
          { name: "language", type: "VARCHAR(50)" },
          { name: "is_directory", type: "BOOLEAN", nn: true },
          { name: "created_by", type: "UUID", fk: "users.id" },
          { name: "updated_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "file_versions",
        color: "#10b981",
        desc: "Local History & Time Travel (Snapshot timeline)",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "file_id", type: "UUID", fk: "project_files.id", nn: true, idx: true },
          { name: "saved_by", type: "UUID", fk: "users.id", desc: "User or AI Agent ID" },
          { name: "commit_message", type: "VARCHAR(255)", desc: "Auto-generated snapshot label" },
          { name: "content_hash", type: "VARCHAR(64)", nn: true },
          { name: "s3_key", type: "TEXT", desc: "For large snapshots" },
          { name: "inline_content", type: "BYTEA" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "collab_documents",
        color: "#10b981",
        desc: "Yjs CRDT binary state persistence — per file, NOT per project",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "file_id", type: "UUID", fk: "project_files.id", nn: true, idx: true, desc: "Each open file has its own Yjs document" },
          { name: "yjs_binary_state", type: "BYTEA", nn: true, desc: "Compressed CRDT state" },
          { name: "last_synced_at", type: "TIMESTAMPTZ", nn: true },
          // UNIQUE(project_id, file_id) — compound unique key enforced at DB level
        ]
      },
      {
        name: "project_collaborators",
        color: "#10b981",
        desc: "Project-level access control",
        fields: [
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, pk: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true, pk: true },
          { name: "role", type: "ENUM", nn: true, desc: "owner | editor | viewer" },
          { name: "invited_by", type: "UUID", fk: "users.id" },
          { name: "joined_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "invitations",
        color: "#10b981",
        desc: "Pending project/org invitation tracking",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", idx: true, desc: "Null for org invites" },
          { name: "org_id", type: "UUID", fk: "organizations.id", idx: true, desc: "Null for project invites" },
          { name: "invited_email", type: "VARCHAR(255)", nn: true, idx: true },
          { name: "invited_by", type: "UUID", fk: "users.id", nn: true },
          { name: "role", type: "ENUM", nn: true, desc: "editor | viewer | admin | developer" },
          { name: "token", type: "VARCHAR(64)", uk: true, nn: true, desc: "Unique invite link token" },
          { name: "status", type: "ENUM", nn: true, desc: "pending | accepted | declined | expired" },
          { name: "expires_at", type: "TIMESTAMPTZ", nn: true, desc: "7-day expiry" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "project_snapshots",
        color: "#10b981",
        desc: "Firecracker VM snapshots for hibernation",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "vm_id", type: "VARCHAR(255)", desc: "Firecracker VM identifier" },
          { name: "snapshot_s3_key", type: "TEXT", nn: true },
          { name: "mem_s3_key", type: "TEXT", desc: "Memory snapshot S3 key" },
          { name: "size_bytes", type: "BIGINT" },
          { name: "status", type: "ENUM", desc: "creating | active | hibernated | restoring | failed" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "project_secrets",
        color: "#10b981",
        desc: "Vault references for environment variables",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "key_name", type: "VARCHAR(255)", nn: true, desc: "e.g. DATABASE_URL" },
          { name: "vault_reference_id", type: "UUID", nn: true, uk: true },
          { name: "environment", type: "ENUM", nn: true, desc: "dev | preview | prod" },
          { name: "created_by", type: "UUID", fk: "users.id" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "project_domains",
        color: "#10b981",
        desc: "Custom domain mapping (e.g., www.myblog.com)",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "domain_name", type: "VARCHAR(255)", nn: true, uk: true, desc: "Custom domain url" },
          { name: "dns_verified", type: "BOOLEAN", nn: true, desc: "Has the CNAME been verified?" },
          { name: "ssl_status", type: "ENUM", nn: true, desc: "pending | active | failed" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "project_templates",
        color: "#10b981",
        desc: "Starter templates for new projects (marketplace)",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "name", type: "VARCHAR(255)", nn: true, desc: "e.g. Next.js Starter, FastAPI Blank" },
          { name: "slug", type: "VARCHAR(100)", uk: true, nn: true, idx: true },
          { name: "description", type: "TEXT" },
          { name: "thumbnail_url", type: "TEXT", desc: "Preview image URL" },
          { name: "category", type: "VARCHAR(50)", nn: true, desc: "web | api | fullstack | data | mobile" },
          { name: "language", type: "VARCHAR(50)", nn: true, desc: "Primary language" },
          { name: "framework", type: "VARCHAR(100)" },
          { name: "file_structure_json", type: "JSONB", nn: true, desc: "Directory tree and default file contents" },
          { name: "is_public", type: "BOOLEAN", nn: true, desc: "Visible in marketplace" },
          { name: "use_count", type: "INTEGER", nn: true, desc: "Track popularity for sorting" },
          { name: "created_by", type: "UUID", fk: "users.id", desc: "Admin or community contributor" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
          { name: "updated_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
    ]
  },
  ai: {
    label: "🧠 AI & Agents",
    color: "#8b5cf6",
    tables: [
      {
        name: "ai_conversations",
        color: "#8b5cf6",
        desc: "AI generation sessions per project",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true },
          { name: "title", type: "TEXT", desc: "Auto-generated summary title" },
          { name: "initial_prompt", type: "TEXT", nn: true, desc: "Original user prompt" },
          { name: "agent_plan", type: "JSONB", desc: "Orchestrator execution plan DAG" },
          { name: "status", type: "ENUM", nn: true, desc: "pending|running|completed|failed" },
          { name: "total_tokens", type: "INTEGER", nn: true },
          { name: "total_cost_usd", type: "NUMERIC(10,6)", desc: "API cost tracking" },
          { name: "duration_ms", type: "INTEGER" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
          { name: "completed_at", type: "TIMESTAMPTZ" },
        ]
      },
      {
        name: "ai_messages",
        color: "#8b5cf6",
        desc: "Individual messages per conversation",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "conversation_id", type: "UUID", fk: "ai_conversations.id", nn: true, idx: true },
          { name: "agent_name", type: "VARCHAR(50)", desc: "pm|architect|backend|frontend|devops|qa|security" },
          { name: "role", type: "ENUM", nn: true, desc: "user|assistant|system|tool" },
          { name: "content", type: "TEXT", nn: true },
          { name: "metadata", type: "JSONB", desc: "File diffs, tool calls, artifacts" },
          { name: "tokens_used", type: "INTEGER" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "ai_feedback",
        color: "#8b5cf6",
        desc: "RLHF feedback for AI outputs",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "message_id", type: "UUID", fk: "ai_messages.id", nn: true, idx: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true },
          { name: "rating", type: "INTEGER", nn: true, desc: "1 to 5 stars or -1/1" },
          { name: "user_comment", type: "TEXT" },
          { name: "agent_name", type: "VARCHAR(50)", desc: "Agent that generated the output" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "ai_generated_files",
        color: "#8b5cf6",
        desc: "Files created/modified by AI agents (versioned)",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "conversation_id", type: "UUID", fk: "ai_conversations.id", nn: true, idx: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true },
          { name: "file_path", type: "TEXT", nn: true },
          { name: "agent_name", type: "VARCHAR(50)", nn: true },
          { name: "action", type: "ENUM", desc: "created|modified|deleted" },
          { name: "diff", type: "TEXT", desc: "Git-style unified diff" },
          { name: "snapshot_content", type: "TEXT", desc: "Full file content at this version" },
          { name: "version", type: "INTEGER", nn: true, desc: "Incremental version number" },
          { name: "previous_version_id", type: "UUID", fk: "ai_generated_files.id", desc: "For rollback chain" },
          { name: "applied", type: "BOOLEAN", nn: true },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "ai_generation_tasks",
        color: "#8b5cf6",
        desc: "Long-running orchestration jobs (Prompt-to-App)",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "conversation_id", type: "UUID", fk: "ai_conversations.id", nn: true, idx: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true },
          { name: "status", type: "ENUM", nn: true, desc: "pending | architect | db_setup | ui | complete | failed" },
          { name: "current_agent", type: "VARCHAR(50)", desc: "Agent currently working on this task sequence" },
          { name: "progress_percent", type: "INTEGER", desc: "0-100 completion tracker" },
          { name: "started_at", type: "TIMESTAMPTZ", nn: true },
          { name: "completed_at", type: "TIMESTAMPTZ" },
        ]
      },
      {
        name: "code_issues",
        color: "#8b5cf6",
        desc: "AI-detected code issues & vulnerabilities",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "conversation_id", type: "UUID", fk: "ai_conversations.id", idx: true },
          { name: "agent_name", type: "VARCHAR(50)", nn: true, desc: "security|qa|architect" },
          { name: "severity", type: "ENUM", nn: true, desc: "critical|high|medium|low|info" },
          { name: "category", type: "VARCHAR(50)", nn: true, desc: "security|performance|style|bug" },
          { name: "title", type: "VARCHAR(255)", nn: true },
          { name: "description", type: "TEXT", nn: true },
          { name: "file_path", type: "TEXT" },
          { name: "line_start", type: "INTEGER" },
          { name: "line_end", type: "INTEGER" },
          { name: "suggested_fix", type: "TEXT", desc: "AI-suggested code fix" },
          { name: "status", type: "ENUM", nn: true, desc: "open|fixed|ignored|wont_fix" },
          { name: "fixed_at", type: "TIMESTAMPTZ" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "code_embeddings",
        color: "#8b5cf6",
        desc: "pgvector embeddings for RAG context",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "file_path", type: "TEXT", nn: true },
          { name: "chunk_index", type: "INTEGER", nn: true },
          { name: "content", type: "TEXT", nn: true, desc: "Code chunk text" },
          { name: "embedding", type: "VECTOR", nn: true, desc: "Dimension sets via config (e.g., OpenAI: 1536, Voyage: 1024)" },
          { name: "model_name", type: "VARCHAR(50)", nn: true, desc: "Embedding model used" },
          { name: "content_hash", type: "VARCHAR(64)", desc: "For change detection" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
    ]
  },
  execution: {
    label: "⚡ Execution & Deployments",
    color: "#f59e0b",
    tables: [
      {
        name: "code_executions",
        color: "#f59e0b",
        desc: "Code run history per project",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true },
          { name: "vm_id", type: "VARCHAR(255)", idx: true },
          { name: "command", type: "TEXT", nn: true },
          { name: "stdout", type: "TEXT" },
          { name: "stderr", type: "TEXT" },
          { name: "exit_code", type: "INTEGER" },
          { name: "status", type: "ENUM", desc: "running|success|error|timeout|killed" },
          { name: "duration_ms", type: "INTEGER" },
          { name: "memory_used_mb", type: "INTEGER" },
          { name: "cpu_used_pct", type: "NUMERIC(5,2)" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true, idx: true },
        ]
      },
      {
        name: "deployments",
        color: "#f59e0b",
        desc: "Project deployment history",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "project_id", type: "UUID", fk: "projects.id", nn: true, idx: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true },
          { name: "branch_name", type: "VARCHAR(100)", nn: true, desc: "e.g. main, staging" },
          { name: "trigger_type", type: "ENUM", nn: true, desc: "manual_run | git_push | ai_agent_auto_deploy" },
          { name: "provider", type: "ENUM", desc: "vercel|railway|aws|gcp|azure" },
          { name: "environment", type: "ENUM", nn: true, desc: "preview|production" },
          { name: "status", type: "ENUM", nn: true, desc: "pending|building|deployed|failed" },
          { name: "url", type: "TEXT", desc: "Deployed URL" },
          { name: "env_snapshot", type: "JSONB", desc: "AES-256 encrypted env vars at deploy time" },
          { name: "build_command", type: "TEXT", desc: "e.g. npm run build" },
          { name: "output_dir", type: "VARCHAR(100)", desc: "e.g. .next, dist, build" },
          { name: "node_version", type: "VARCHAR(10)", desc: "e.g. 20, 18" },
          { name: "build_log_s3_key", type: "TEXT" },
          { name: "commit_sha", type: "VARCHAR(40)" },
          { name: "deploy_duration_ms", type: "INTEGER" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
          { name: "deployed_at", type: "TIMESTAMPTZ" },
        ]
      },
    ]
  },
  billing: {
    label: "💳 Billing & Usage",
    color: "#ec4899",
    tables: [
      {
        name: "subscriptions",
        color: "#ec4899",
        desc: "Active plan subscriptions",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "user_id", type: "UUID", fk: "users.id", idx: true },
          { name: "org_id", type: "UUID", fk: "organizations.id", idx: true },
          { name: "stripe_subscription_id", type: "VARCHAR(255)", uk: true, nn: true },
          { name: "stripe_price_id", type: "VARCHAR(255)", nn: true },
          { name: "plan", type: "ENUM", nn: true },
          { name: "status", type: "ENUM", nn: true, desc: "active|past_due|canceled|trialing" },
          { name: "trial_end", type: "TIMESTAMPTZ", desc: "Trial expiration date" },
          { name: "cancellation_reason", type: "TEXT" },
          { name: "current_period_start", type: "TIMESTAMPTZ", nn: true },
          { name: "current_period_end", type: "TIMESTAMPTZ", nn: true },
          { name: "cancel_at_period_end", type: "BOOLEAN", nn: true },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "usage_records",
        color: "#ec4899",
        desc: "Per-user resource consumption metering",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true, idx: true },
          { name: "period_start", type: "DATE", nn: true },
          { name: "period_end", type: "DATE", nn: true },
          { name: "ai_tokens_used", type: "BIGINT", nn: true },
          { name: "compute_minutes", type: "INTEGER", nn: true },
          { name: "storage_gb", type: "NUMERIC(10,3)", nn: true },
          { name: "deployments_count", type: "INTEGER", nn: true },
          { name: "projects_count", type: "INTEGER", nn: true },
          { name: "collaborators_count", type: "INTEGER", nn: true },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
      {
        name: "audit_logs",
        color: "#ec4899",
        desc: "Security & compliance audit trail",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "user_id", type: "UUID", fk: "users.id", idx: true },
          { name: "org_id", type: "UUID", fk: "organizations.id", idx: true },
          { name: "action", type: "VARCHAR(100)", nn: true, idx: true, desc: "e.g. project.delete, user.login" },
          { name: "resource_type", type: "VARCHAR(50)", desc: "project|user|org|deployment" },
          { name: "resource_id", type: "UUID" },
          { name: "ip_address", type: "INET" },
          { name: "user_agent", type: "TEXT" },
          { name: "metadata", type: "JSONB", desc: "Action-specific details" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true, idx: true },
        ]
      },
      {
        name: "usage_daily",
        color: "#ec4899",
        desc: "Real-time daily usage counters for limit enforcement",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true, idx: true },
          { name: "date", type: "DATE", nn: true, idx: true },
          { name: "ai_requests_count", type: "INTEGER", nn: true, desc: "AI API calls today" },
          { name: "ai_tokens_used", type: "BIGINT", nn: true },
          { name: "compute_seconds", type: "INTEGER", nn: true },
          { name: "storage_bytes_added", type: "BIGINT", nn: true },
          { name: "deploys_count", type: "INTEGER", nn: true },
          { name: "updated_at", type: "TIMESTAMPTZ", nn: true, desc: "Last counter increment" },
        ]
      },
      {
        name: "feature_flags",
        color: "#ec4899",
        desc: "Global and per-user feature configuration",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "flag_key", type: "VARCHAR(255)", uk: true, nn: true, idx: true },
          { name: "description", type: "TEXT" },
          { name: "is_enabled_default", type: "BOOLEAN", nn: true, desc: "Default state" },
          { name: "rollout_percentage", type: "INTEGER", desc: "0-100 gradual rollout" },
          { name: "enabled_for_users", type: "ARRAY", desc: "List of allowed UUIDs" },
          { name: "enabled_for_plans", type: "ARRAY", desc: "e.g. ['pro', 'enterprise']" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true },
          { name: "updated_at", type: "TIMESTAMPTZ", nn: true },
        ]
      },
    ]
  },
  notifications: {
    label: "🔔 Notifications",
    color: "#f97316",
    tables: [
      {
        name: "notifications",
        color: "#f97316",
        desc: "Persistent in-app notification storage",
        fields: [
          { name: "id", type: "UUID", pk: true, nn: true },
          { name: "user_id", type: "UUID", fk: "users.id", nn: true, idx: true },
          { name: "type", type: "VARCHAR(50)", nn: true, desc: "invite|deploy|ai_complete|mention|system" },
          { name: "title", type: "VARCHAR(255)", nn: true },
          { name: "body", type: "TEXT" },
          { name: "action_url", type: "TEXT", desc: "Deep link to relevant page" },
          { name: "metadata", type: "JSONB", desc: "Type-specific extra data" },
          { name: "is_read", type: "BOOLEAN", nn: true, desc: "Read/unread status" },
          { name: "read_at", type: "TIMESTAMPTZ" },
          { name: "created_at", type: "TIMESTAMPTZ", nn: true, idx: true },
        ]
      },
    ]
  },
};

const BADGE = {
  pk:  { label: "PK",  bg: "#fef08a", fg: "#713f12" },
  fk:  { label: "FK",  bg: "#bfdbfe", fg: "#1e3a8a" },
  uk:  { label: "UK",  bg: "#bbf7d0", fg: "#14532d" },
  nn:  { label: "NN",  bg: "#fecaca", fg: "#7f1d1d" },
  idx: { label: "IDX", bg: "#e9d5ff", fg: "#4c1d95" },
};

function Badge({ type }) {
  const b = BADGE[type];
  return (
    <span style={{
      background: b.bg, color: b.fg,
      fontSize: 9, fontWeight: 800,
      padding: "1px 5px", borderRadius: 3,
      fontFamily: "monospace", letterSpacing: 0.3,
    }}>{b.label}</span>
  );
}

function TableCard({ table, color }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div style={{
      background: "#0D1117",
      border: `1.5px solid ${color}44`,
      borderRadius: 10,
      overflow: "hidden",
      marginBottom: 16,
      boxShadow: `0 0 20px ${color}11`,
    }}>
      {/* Table Header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px",
          background: `${color}18`,
          borderBottom: `1px solid ${color}33`,
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color, fontSize: 12 }}>▣</span>
          <span style={{ color, fontWeight: 800, fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
            {table.name}
          </span>
          <span style={{ fontSize: 10, color: "#475569" }}>{table.desc}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#475569" }}>{table.fields.length} fields</span>
          <span style={{ color: "#475569", fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Fields */}
      {expanded && (
        <div>
          {/* Column headers */}
          <div style={{
            display: "grid", gridTemplateColumns: "180px 130px 80px 1fr",
            padding: "5px 14px", borderBottom: "1px solid #1E293B",
            background: "#080B14",
          }}>
            {["Column", "Type", "Constraints", "Description"].map(h => (
              <span key={h} style={{ fontSize: 10, color: "#334155", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</span>
            ))}
          </div>
          {table.fields.map((f, i) => (
            <div key={f.name} style={{
              display: "grid", gridTemplateColumns: "180px 130px 80px 1fr",
              padding: "6px 14px",
              borderBottom: i < table.fields.length - 1 ? "1px solid #0F172A" : "none",
              background: i % 2 === 0 ? "transparent" : "#0A0E1A",
              alignItems: "center",
            }}>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: f.pk ? "#fde68a" : f.fk ? "#93c5fd" : "#e2e8f0",
                fontWeight: f.pk ? 700 : 400,
              }}>
                {f.pk && "⬡ "}{f.name}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#64748b" }}>{f.type}</span>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {f.pk  && <Badge type="pk" />}
                {f.fk  && <Badge type="fk" />}
                {f.uk  && <Badge type="uk" />}
                {f.nn  && !f.pk && <Badge type="nn" />}
                {f.idx && <Badge type="idx" />}
              </div>
              <span style={{ fontSize: 11, color: "#475569" }}>
                {f.fk ? <span style={{ color: "#60a5fa" }}>→ {f.fk}</span> : f.desc || ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const RELATIONS = [
  { from: "users", to: "refresh_tokens", label: "1 → N", desc: "User has many active sessions" },
  { from: "users", to: "oauth_accounts", label: "1 → N", desc: "User has many OAuth providers" },
  { from: "users", to: "api_keys", label: "1 → N", desc: "User has many API keys" },
  { from: "users", to: "user_settings", label: "1 → 1", desc: "User has one settings record" },
  { from: "users", to: "organizations", label: "1 → N", desc: "User owns organizations" },
  { from: "organizations", to: "org_members", label: "1 → N", desc: "Org has many members" },
  { from: "users", to: "org_members", label: "1 → N", desc: "User in many orgs" },
  { from: "users", to: "projects", label: "1 → N", desc: "User owns projects" },
  { from: "organizations", to: "projects", label: "1 → N", desc: "Org has many projects" },
  { from: "projects", to: "project_files", label: "1 → N", desc: "Project contains files" },
  { from: "project_files", to: "project_files", label: "1 → N", desc: "Parent-child directory hierarchy (self-ref)" },
  { from: "projects", to: "project_collaborators", label: "1 → N", desc: "Project has collaborators" },
  { from: "projects", to: "invitations", label: "1 → N", desc: "Project has pending invitations" },
  { from: "organizations", to: "invitations", label: "1 → N", desc: "Org has pending invitations" },
  { from: "projects", to: "project_snapshots", label: "1 → N", desc: "Project has VM snapshots" },
  { from: "projects", to: "ai_conversations", label: "1 → N", desc: "Project has AI sessions" },
  { from: "ai_conversations", to: "ai_messages", label: "1 → N", desc: "Conversation has messages" },
  { from: "ai_conversations", to: "ai_generated_files", label: "1 → N", desc: "Session generates versioned files" },
  { from: "ai_generated_files", to: "ai_generated_files", label: "1 → 1", desc: "Version chain (self-ref for rollback)" },
  { from: "projects", to: "code_issues", label: "1 → N", desc: "Project has AI-detected issues" },
  { from: "ai_conversations", to: "code_issues", label: "1 → N", desc: "Issues found during AI review" },
  { from: "projects", to: "code_embeddings", label: "1 → N", desc: "Project has RAG embeddings" },
  { from: "projects", to: "code_executions", label: "1 → N", desc: "Project has run history" },
  { from: "projects", to: "deployments", label: "1 → N", desc: "Project has deployments" },
  { from: "users", to: "subscriptions", label: "1 → 1", desc: "User has one subscription (source of truth for plan)" },
  { from: "users", to: "usage_records", label: "1 → N", desc: "User has monthly usage aggregates" },
  { from: "users", to: "usage_daily", label: "1 → N", desc: "User has daily usage counters (real-time)" },
  { from: "users", to: "notifications", label: "1 → N", desc: "User receives notifications" },
  { from: "users", to: "audit_logs", label: "1 → N", desc: "User actions are logged" },
  { from: "projects", to: "project_domains", label: "1 → N", desc: "Project has custom domains" },
  { from: "ai_conversations", to: "ai_generation_tasks", label: "1 → N", desc: "Conversation spawns task pipelines" },
  { from: "project_files", to: "file_versions", label: "1 → N", desc: "File has local history snapshots" },
  { from: "projects", to: "collab_documents", label: "1 → N", desc: "Project has Yjs states per open file" },
  { from: "project_files", to: "collab_documents", label: "1 → 1", desc: "Each file has one active Yjs document" },
  { from: "ai_messages", to: "ai_feedback", label: "1 → N", desc: "Message receives RLHF feedback" },
  { from: "projects", to: "project_templates", label: "N → 1", desc: "Projects reference starter templates" },
];

const SUMMARY = [
  { label: "Total Tables", value: Object.values(SCHEMAS).reduce((a, s) => a + s.tables.length, 0), color: "#60a5fa" },
  { label: "Total Fields", value: Object.values(SCHEMAS).reduce((a, s) => a + s.tables.reduce((b, t) => b + t.fields.length, 0), 0), color: "#34d399" },
  { label: "Relationships", value: RELATIONS.length, color: "#a78bfa" },
  { label: "Schema Groups", value: Object.keys(SCHEMAS).length, color: "#f59e0b" },
];

export default function DatabaseSchema() {
  const [activeSchema, setActiveSchema] = useState("users_org");
  const [view, setView] = useState("schema"); // schema | relations | sql

  const schema = SCHEMAS[activeSchema];

  const sqlForTable = (table) => {
    const lines = [`CREATE TABLE ${table.name} (`];
    table.fields.forEach((f, i) => {
      const constraints = [
        f.pk ? "PRIMARY KEY DEFAULT gen_random_uuid()" : "",
        f.nn && !f.pk ? "NOT NULL" : "",
        f.uk ? "UNIQUE" : "",
        f.fk ? `REFERENCES ${f.fk} ON DELETE CASCADE` : "",
      ].filter(Boolean).join(" ");
      lines.push(`  ${f.name.padEnd(28)} ${f.type.padEnd(20)} ${constraints}${i < table.fields.length - 1 ? "," : ""}`);
    });
    lines.push(");");
    const idxFields = table.fields.filter(f => f.idx && !f.pk);
    idxFields.forEach(f => {
      lines.push(`CREATE INDEX idx_${table.name}_${f.name} ON ${table.name}(${f.name});`);
    });
    return lines.join("\n");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#080B14", color: "#E2E8F0", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid #0F172A", background: "#0D1117" }}>
        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
          background: "linear-gradient(135deg, #34d399, #3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Database Schema Design
        </div>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>AI-Native Cloud IDE Platform — PostgreSQL 16</div>

        {/* Summary stats */}
        <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          {SUMMARY.map(s => (
            <div key={s.label} style={{ background: "#0A0E1A", border: `1px solid ${s.color}33`, borderRadius: 8, padding: "6px 14px", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "monospace" }}>{s.value}</span>
              <span style={{ fontSize: 11, color: "#475569" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* View Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #0F172A", background: "#0D1117" }}>
        {[["schema","📊 Schema View"], ["relations","🔗 Relationships"], ["sql","💾 SQL Export"]].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: "10px 20px", border: "none", background: "transparent",
            color: view === v ? "#60a5fa" : "#475569",
            borderBottom: view === v ? "2px solid #3b82f6" : "2px solid transparent",
            cursor: "pointer", fontSize: 13, fontWeight: view === v ? 700 : 400,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 180px)" }}>

        {/* Sidebar */}
        <div style={{ width: 220, borderRight: "1px solid #0F172A", background: "#0D1117", flexShrink: 0, padding: "16px 0" }}>
          <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, padding: "0 16px 8px", textTransform: "uppercase", letterSpacing: 0.5 }}>Schema Groups</div>
          {Object.entries(SCHEMAS).map(([key, s]) => (
            <div key={key} onClick={() => setActiveSchema(key)} style={{
              padding: "9px 16px", cursor: "pointer",
              background: activeSchema === key ? `${s.color}18` : "transparent",
              borderLeft: activeSchema === key ? `3px solid ${s.color}` : "3px solid transparent",
              transition: "all 0.15s",
            }}>
              <div style={{ fontSize: 12, color: activeSchema === key ? s.color : "#64748b", fontWeight: activeSchema === key ? 700 : 400 }}>{s.label}</div>
              <div style={{ fontSize: 10, color: "#334155", marginTop: 2 }}>{s.tables.length} tables</div>
            </div>
          ))}

          {/* Legend */}
          <div style={{ margin: "24px 16px 0", padding: "12px", background: "#080B14", borderRadius: 8, border: "1px solid #0F172A" }}>
            <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Legend</div>
            {Object.entries(BADGE).map(([key, b]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Badge type={key} />
                <span style={{ fontSize: 10, color: "#475569" }}>
                  {{ pk: "Primary Key", fk: "Foreign Key", uk: "Unique", nn: "Not Null", idx: "Indexed" }[key]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div style={{ flex: 1, padding: "20px 28px", overflowY: "auto" }}>

          {view === "schema" && (
            <div>
              <div style={{ fontSize: 14, color: schema.color, fontWeight: 700, marginBottom: 16 }}>{schema.label}</div>
              {schema.tables.map(t => <TableCard key={t.name} table={t} color={schema.color} />)}
            </div>
          )}

          {view === "relations" && (
            <div>
              <div style={{ fontSize: 14, color: "#60a5fa", fontWeight: 700, marginBottom: 16 }}>
                Entity Relationships — {RELATIONS.length} total
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {RELATIONS.map((r, i) => (
                  <div key={i} style={{
                    background: "#0D1117", border: "1px solid #1E293B", borderRadius: 8, padding: "12px 14px",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "#34d399", fontWeight: 700 }}>{r.from}</span>
                      <span style={{ fontSize: 11, color: "#f59e0b", background: "#451a03", padding: "1px 8px", borderRadius: 12 }}>{r.label}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "#3b82f6", fontWeight: 700 }}>{r.to}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#475569" }}>{r.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === "sql" && (
            <div>
              <div style={{ fontSize: 14, color: "#a78bfa", fontWeight: 700, marginBottom: 16 }}>
                SQL Export — {schema.label}
              </div>
              {schema.tables.map(t => (
                <div key={t.name} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: schema.color, fontWeight: 700, marginBottom: 6, fontFamily: "monospace" }}>-- {t.name}</div>
                  <div style={{
                    background: "#0D1117", border: `1px solid ${schema.color}33`,
                    borderRadius: 8, padding: "14px 16px",
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    fontSize: 11, lineHeight: 1.8, color: "#94a3b8",
                    whiteSpace: "pre", overflowX: "auto",
                  }}>
                    {sqlForTable(t)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}