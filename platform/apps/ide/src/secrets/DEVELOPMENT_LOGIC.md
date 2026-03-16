# 🔐 IDE Frontend — Secrets & Environment Variables Logic

> **Target:** `apps/ide/src/secrets/`
> **Goal:** Securely manage `project_secrets` natively. Prevent users from hardcoding API keys (like `OPENAI_API_KEY`) inside their files, passing them directly to HashiCorp Vault instead.
> **Standard:** PII Redaction. No local plain-text syncing. API Proxying.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Form Masking & Security
- **Constraint:** A user's screen might be shared on a Zoom call. Displaying a 64-character Stripe Secret Key is a critical risk.
- **Elite Logic:**
  - Build the `.env` Input Form. Use `<input type="password">` for the values by default.
  - Implement a "Click to Reveal" icon (👁️).
  - Once a secret is submitted to `POST /v1/projects/:id/secrets`, do NOT return the plaintext key from the API. The API must only return `{ key_name: "STRIPE_KEY", vault_reference_id: "...", last_updated: "..." }`.
  - In the UI, render the known keys as `STRIPE_KEY = ************************`. The IDE must never know the value once saved.

### 2. Auto-Injection to Virtual Machines
- **Constraint:** Secret keys must magically arrive in the Firecracker VM running the user's Node.js project.
- **Elite Logic:**
  - The UI only manages the CRUD operations.
  - The `execution-service` pulls the real token mapped to `vault_reference_id` from HashiCorp Vault directly, injecting it into the VM's `process.env`. The IDE Client is entirely out of this loop.
  - Expose a "Sync Secrets to VM" button. Clicking it executes a lightweight `SIGHUP` or WebSocket command to restart the user's remote Dev Server process with the new keys.
