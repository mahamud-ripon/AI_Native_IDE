# 🔗 IDE Frontend — Integrations & Export Logic

> **Target:** `apps/ide/src/integrations/`
> **Goal:** Let users take their generated code off the platform. Pushing the codebase directly to their personal GitHub account or downloading a `.zip` archive.
> **Standard:** OAuth Tokens. Streaming Zips.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Exporting via GitHub (Push to Repo)
- **Constraint:** Using `git push` directly in the browser using the user's password won't work due to CORS and modern GitHub Personal Access Token (PAT) requirements.
- **Elite Logic:**
  - Create a "Push to GitHub" Modal interface.
  - Rely on the `oauth_accounts` table. If the user hasn't connected GitHub, prompt the OAuth flow.
  - The frontend MUST send an API call: `POST /v1/projects/:id/export/github { "repo_name": "my-ai-app", "is_private": true }`.
  - The `project-service` on the backend assumes control: grabbing the Git tree from the Firecracker VM, creating the repository via the GitHub REST API using the user's OAuth App Token, and forcefully pushing the `.git` objects.
  - **Note:** Track progress via Server-Sent Events (SSE) and render a loader. Disconnect safely on error.

### 2. Exporting Code Local (.zip downloads)
- **Constraint:** We cannot generate a 500MB zip file entirely in server RAM for thousands of users concurrently, leading to OOM crashes.
- **Elite Logic:**
  - When the user clicks "Download Zip", hit `GET /v1/projects/:id/export/zip`.
  - The frontend uses the HTML5 `<a>` tag with a dynamic `href` or `Blob` trigger.
  - The API Gateway must handle this response natively as a `binary stream`, passing `Content-Disposition: attachment`.
  - Provide a "Preparing Archive..." visual in the UI until the browser's download manager takes over the HTTP stream.
