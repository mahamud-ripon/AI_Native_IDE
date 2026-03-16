# ⚙️ IDE Frontend — User & Project Settings Logic

> **Target:** `apps/ide/src/settings/`
> **Goal:** Manage global user preferences (theme, font size, keybindings) and programmatic `api_keys` for integrating external build tools.
> **Standard:** LocalStorage Fallbacks. Secure Token Display.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Unified Preferences (Zustand + LocalStorage)
- **Constraint:** If a user changes their IDE theme to "Dark", refreshing the page should not flash "Light" for 1 second while fetching from the backend.
- **Elite Logic:**
  - Persist the `user_settings` in Zustand using `persist` middleware backed by `localStorage`.
  - On page load, the IDE uses `localStorage` instantly to paint the DOM.
  - In the background, it silently syncs the `localStorage` state with the PostgreSQL `user_settings` table via `PUT /v1/users/settings` to ensure cross-device syncing.

### 2. Programmatic API Keys (Developer Mode)
- **Constraint:** Power users will generate `api_keys` to trigger our backend from their own CI/CD Github Actions. Showing the key twice is a massive security risk.
- **Elite Logic:**
  - When the user generates a new API token (`POST /v1/auth/api-keys`), it is ONLY returned strictly once in the HTTP response.
  - Render a modal overriding the screen: "Copy this key now. You will never see it again."
  - Save the SHA-256 hash to the database, not the plaintext. In the Settings UI table list, display external keys as `sk-live-...xxxx`.
