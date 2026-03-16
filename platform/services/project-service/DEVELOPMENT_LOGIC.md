# 📂 Project Service — Development Logic & Architecture

> **Target:** `services/project-service/` (Go / Node.js)
> **Goal:** The core engine for managing user workspaces. Handles Project CRUD, File Tree logic, Collaborator access control, and Secret Management.
> **Standard:** Strict Data Formatting, Zero Tolerance for Secret Leaks, Highly optimized File Tree Traversal.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── controllers/
 │    ├── workspace_controller.ts  # Project CRUD (Create, Template, Delete)
 │    ├── file_tree_controller.ts  # File operations (Create, Edit, Delete, Move)
 │    └── secret_controller.ts     # HashiCorp Vault integrations
 ├── services/
 │    ├── storage_service.ts       # Logic for routing files to DB vs S3
 │    ├── git_clone_manager.ts     # Triggers execution-service to clone repos
 │    └── permission_srv.ts        # RBAC (Owner vs Editor vs Viewer)
 ├── dto/                          # STRICT Data Transfer Objects (Zod/Class-validator)
 │    ├── project.dto.ts
 │    └── file.dto.ts
 └── events/
      └── kafka_publisher.ts       # Publishes "project.created", "file.modified"
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Strict Data Format Specifications (Avoid Type Errors)
- **Constraint:** Developers often assume data shapes. You MUST strictly validate all incoming data using a schema validation library (e.g., Zod, Joi).
- **Mandatory JSON Payload for Project Creation (`POST /v1/projects`):**
```json
{
  "name": "ai-ecommerce-bot", // String, 3-50 chars, alphanumeric + dashes
  "description": "An AI bot", // String, optional, max 500 chars
  "template": "nextjs",       // Enum: "nextjs", "fastapi", "blank", "react"
  "visibility": "private",    // Enum: "private", "public", "org"
  "org_id": null              // UUID or null
}
```
- **Mandatory JSON Response Format (All Endpoints):**
```json
{
  "success": true,
  "data": { ... },            // The actual payload
  "error": null,              // Null if success, string/object if failed
  "trace_id": "req_uuid"      // For Datadog/ELK tracing
}
```

### 2. The File Storage Logic (<64KB vs S3)
- **Constraint:** We cannot store 10MB images as Base64 in PostgreSQL. We also cannot make a network call to S3 just to read a 10-line `package.json`.
- **Logic:**
  - When saving a file (`PUT /v1/projects/:id/files/:file_id`):
  - Check the `size_bytes`.
  - **IF size < 64KB (65536 bytes):** Store the buffer directly in PostgreSQL `project_files.inline_content` (BYTEA). Set `s3_key = null`.
  - **IF size >= 64KB:** Upload the buffer to AWS S3 / Cloudflare R2. Then save the S3 URL in `project_files.s3_key`. Set `inline_content = null`.

### 3. Absolute Secret Isolation (HashiCorp Vault)
- **Constraint:** NEVER accept or return plaintext `.env` secrets in standard API responses.
- **Logic:**
  - `POST /v1/projects/:id/secrets`: Takes `{ "key_name": "OPENAI_API_KEY", "value": "sk-123..." }`.
  - The Project Service MUST send the `"value"` securely to HashiCorp Vault.
  - Vault returns a unique `vault_reference_id`.
  - Save ONLY the `key_name` and `vault_reference_id` in the PostgreSQL `project_secrets` table.
  - **NEVER** return the secret value to the frontend UI. The Execution Service (Firecracker VMs) will retrieve the real value directly from Vault at runtime.

### 4. Git Orchestration (No Local Cloning)
- **Constraint:** The Project Service container must remain lightweight. Do NOT run `git clone` inside this service's memory/disk.
- **Logic:**
  - If a user imports a project via GitHub (`POST /v1/projects/import`):
  - Create the empty Project record in PostgreSQL.
  - Send an RPC/Kafka request to `execution-service`: `{ action: "git_clone", repo: "url", project_id: "id", branch: "main" }`.
  - The Execution Service spins up a Firecracker VM, clones the repo, parses the folders, and streams the initial file tree back to the Project Service database.

### 5. Access Control (RBAC) Interceptor
- **Constraint:** User A must never be able to delete User B's file.
- **Logic:** Every API request under `/v1/projects/:id/*` must pass through the `permission_srv.ts` middleware BEFORE hitting the controller.
  - Fetch the user's ID from the JWT (`req.user.sub`).
  - Query `projects` (is owner?) OR `project_collaborators` (is editor?).
  - If the user only has `viewer` role, block `POST`, `PUT`, `DELETE` requests with `403 Forbidden`.

---

## ⚠️ ACTION ITEMS (Priority Order)

### Priority 1: Critical

#### 1.1 Remove BYTEA Blob Storage
- **Current:** Stores files <64KB in PostgreSQL inline_content
- **Required:** Remove inline_content, always use S3 for file storage
- **File:** `src/services/storage_service.ts`
- **Reference:** `@developer_guidelines.md` Section 1.2

#### 1.2 Add Soft Deletes
- **Current:** Hard delete with CASCADE
- **Required:** Add deletedAt timestamp, update delete queries to soft delete
- **File:** `src/controllers/workspace_controller.ts`
- **Reference:** `@developer_guidelines.md` Section 1.1

### Priority 2: High

#### 2.1 Add Pagination to List Endpoints
- **Current:** No pagination on file list endpoints
- **Required:** Add cursor-based pagination
- **File:** `src/controllers/file_tree_controller.ts`
- **Reference:** `@developer_guidelines.md` Section 3.4

#### 2.2 Add Composite Indexes
- **Current:** No composite indexes for common queries
- **Required:** Add indexes for (owner_id, status), (project_id, status)
- **File:** Database migration file
- **Reference:** `@developer_guidelines.md` Section 2.2

---

*Last Updated: March 12, 2026 - Action items from analysis*

### 6. Outbox Pattern for SAGA Rollbacks & Deletions
- **Constraint:** If a project saves in Postgres, but VM allocation crashes, we get a "Ghost Project". Similarly, if a user deletes an S3-backed file, deleting the DB row without ensuring Kafka critically publishes `file.deleted` will orphan the S3 object forever, creating a permanent storage leak.
- **Logic (Extreme Rule):**
  - **Transactional Outbox:** The `project-service` MUST use the Outbox pattern. When modifying or deleting files/projects, the service must write the Kafka event payload to a local `outbox_events` table within the *exact same* Postgres transaction. A background Debezium relay guarantees the event is pushed to Kafka.
  - The `project-service` MUST listen to the `project.allocation.failed` topic to execute HARD DELETES on failed project allocations.
  - This guarantees absolute Data Consistency across the microservice cluster and ensures S3 objects are always eventually purged.

---

## 🚀 API Endpoints Contract (Must Implement Exactly)

### POST `/api/v1/projects`
- **Body:** `{ name, template, visibility }` (Strictly validate via Zod).
- **Action:** 
  1. Insert into `projects` table. 
  2. Create a default `project_branches` record (`main`).
  3. Publish Kafka event `project.created` (so AI Service can prepare context).
- **Response:** `201 Created` | `Body: { success: true, data: { project_id } }`

### GET `/api/v1/projects/:id/tree`
- **Query:** `?branch=main`
- **Action:** Query `project_files` where `project_id = :id` and `branch_id = <branch>`. You MUST return the data as a deeply nested JSON tree, NOT a flat array, to optimize the IDE file explorer render on the frontend.
- **Response Format:**
```json
{
  "name": "root",
  "is_directory": true,
  "children": [
    { "id": "uuid", "name": "package.json", "is_directory": false, "language": "json" },
    { "name": "src", "is_directory": true, "children": [ ... ] }
  ]
}
```

### PUT `/api/v1/projects/:id/files`
- **Body:** `{ path: "src/utils.ts", content: "export const A = 1;" }`
- **Action:** 
  1. Check RBAC (must be owner or editor).
  2. Hash the content (SHA-256) and compare with the DB (`content_hash`) to avoid unnecessary writes.
  3. Execute the <64KB Logic (DB vs S3).
  4. Publish Kafka event `file.modified` (so WebSocket Gateway can broadcast to other collaborators currently viewing the file).
- **Response:** `200 OK`

*(Developer Note: Rely entirely on `@workspace/database` Prisma client for all DB operations. Validate EVERY incoming field type carefully).*
