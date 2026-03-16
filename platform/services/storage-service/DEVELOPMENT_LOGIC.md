# 📦 Storage Service — Development Logic & Architecture

> **Target:** `services/storage-service/` (Node.js / Go)
> **Port:** `8009`
> **Goal:** Centralized S3/MinIO proxy. ALL file uploads, downloads, and artifact storage across the platform MUST go through this service. No other service should directly call S3 APIs.
> **Standard:** Zero direct S3 calls from other services. Pre-signed URL security. Virus scanning on uploads.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── controllers/
 │    ├── upload_controller.ts        # POST /storage/upload — Pre-signed URL generation
 │    ├── download_controller.ts      # GET /storage/download/:key — Secure file retrieval
 │    └── admin_controller.ts         # Orphan cleanup, storage stats
 ├── services/
 │    ├── s3_client.ts                # Singleton AWS SDK v3 S3 client (or MinIO)
 │    ├── presigned_url_service.ts    # Generates time-limited upload/download URLs
 │    ├── virus_scanner.ts            # ClamAV integration for uploaded file scanning
 │    └── orphan_cleaner.ts           # Weekly cron: finds S3 objects not referenced in DB
 ├── middleware/
 │    ├── file_validator.ts           # MIME type checking, max size enforcement
 │    └── rate_limiter.ts             # Per-user upload rate limiting
 ├── events/
 │    └── kafka_consumer.ts           # Listens to project.deleted → bulk S3 cleanup
 └── config/
      └── buckets.ts                  # Bucket name constants and lifecycle policies
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The "Single Gateway" Rule (No Direct S3 Calls)
- **Constraint:** `project-service`, `execution-service`, `ai-service`, and ALL other services MUST NEVER import `@aws-sdk/client-s3` or call S3 directly. This creates vendor lock-in and makes it impossible to switch protocols without refactoring every service.
- **Logic:**
  - All services that need to store or retrieve files call the `storage-service` API.
  - **S3 Pre-signed URL Vulnerability Defense (Critical):** For large file uploads (>64KB), the client requests a pre-signed URL. You MUST NOT generate a simple `PUT` URL. A simple `PUT` URL allows attackers to bypass our 50MB gateway limit and upload massive 50GB iso files directly to S3 via the browser, destroying our cloud budget. You MUST generate an AWS `PresignedPost` policy with strict `content-length-range` conditions (e.g., `["content-length-range", 1, 52428800]`) and exact `Content-Type` matching.
  - For small files (<64KB), the `project-service` continues to use PostgreSQL `inline_content` (no S3 needed).

### 2. Bucket Organization & Naming
- **Constraint:** A single S3 bucket makes it impossible to apply different lifecycle policies (e.g., build logs expire in 30 days, user files are permanent).
- **Logic:** Maintain separate logical buckets (or prefixes):
  - `platform-user-files/` — Project source files (>=64KB). Lifecycle: Permanent.
  - `platform-snapshots/` — Firecracker VM memory snapshots. Lifecycle: 90-day expiry.
  - `platform-build-logs/` — Deployment build logs. Lifecycle: 30-day expiry.
  - `platform-artifacts/` — AI-generated artifacts, exported ZIPs. Lifecycle: 7-day expiry.
  - `platform-avatars/` — User profile pictures. Lifecycle: Permanent.

### 3. The Orphan Collector (§2.4 System Design)
- **Constraint:** When a file is updated, a NEW S3 key is generated (immutable storage). The old S3 object becomes orphaned if the DB cleanup fails.
- **Logic (Extreme Rule):**
  - Run a weekly background job (`orphan_cleaner.ts`) via `background-worker` Celery task.
  - List all S3 keys in `platform-user-files/`.
  - Cross-reference each key against the `project_files.s3_key` column in PostgreSQL.
  - If an S3 key has NO matching DB row AND is older than 24 hours (safety margin), delete it.
  - Log the count of deleted orphans to the `audit_logs` table.

### 4. Upload Security & Virus Scanning
- **Constraint:** Users will upload malicious files disguised as source code (e.g., a `.js` file containing a virus payload).
- **Logic:**
  - Before accepting ANY upload, validate the MIME type against an allowlist: `text/*`, `application/json`, `application/javascript`, `image/png`, `image/jpeg`, `image/svg+xml`.
  - Block: `application/x-executable`, `application/x-msdownload`, `.exe`, `.dll`, `.bat`, `.sh` (unless inside a ZIP for deployment).
  - For Pro/Enterprise users uploading Docker images or large artifacts, run ClamAV scan asynchronously and quarantine the file until scan completes.
  - Maximum single file size: **50MB** (enforced at the `api-gateway` level as well).

---

## 🚀 API Endpoints Contract (Must Implement Exactly)

### POST `/api/v1/storage/presign/upload`
- **Body:** `{ bucket: "user-files", key: "projects/{id}/files/{uuid}", content_type: "text/javascript", size_bytes: 102400 }`
- **Action:** Verify requested `project_id` against `X-User-Id` in `project_collaborators` DB to prevent data leaks. Validate size/type. Generate a pre-signed PUT URL (expires in 15 minutes).
- **Response:** `200 OK` | `{ url: "https://s3.amazonaws.com/...", expires_in: 900 }`

### POST `/api/v1/storage/presign/download`
- **Body:** `{ key: "projects/{id}/files/{uuid}" }`
- **Action:** Verify `X-User-Id` is a valid member of `project_collaborators` for the requested project. Do NOT rely on URL obscurity. Generate a pre-signed GET URL (expires in 60 minutes).
- **Response:** `200 OK` | `{ url: "https://s3.amazonaws.com/...", expires_in: 3600 }`

### DELETE `/api/v1/storage/objects`
- **Body:** `{ keys: ["projects/{id}/files/old-uuid-1", "projects/{id}/files/old-uuid-2"] }`
- **Action:** Batch delete S3 objects. Max 100 keys per request.
- **Response:** `200 OK` | `{ deleted: 2, errors: [] }`

### GET `/api/v1/storage/stats` (Internal/Admin)
- **Action:** Return total storage used per bucket, orphan count, and cost estimate.
- **Response:** `{ total_gb: 450.2, buckets: { "user-files": 380.1, "snapshots": 50.0, ... } }`
