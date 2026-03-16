# 🌐 IDE Frontend — Live Preview Pane Logic

> **Target:** `apps/ide/src/preview/`
> **Goal:** Display the running application (Next.js/React/Vue server) from the Code Execution environment safely inside an iframe.
> **Standard:** Network proxy intercept, Strict Content Security Policy (CSP), Hot Module Reloading (HMR).

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. IFrame Sandboxing (Security Critical)
- **Constraint:** We are embedding untrusted user code right next to the IDE UI. An attacker could write `window.top.postMessage({ hack: true })` inside the preview app to steal the user's IDE JWT token.
- **Elite Logic:**
  - The `<iframe src="..." />` MUST use the `sandbox` attribute.
  - Required values: `sandbox="allow-scripts allow-forms allow-popups"`
  - **DANGER:** DO NOT use `allow-same-origin` unless the Preview Server is physically hosted on a different, unique subdomain (e.g., `https://user123.platform-preview.io`). If the iframe is on the same domain as the IDE, `allow-same-origin` defeats the sandbox.
  - Our architecture routes execution domains via the `execution-service` on a wildcard subdomain (`*.preview.ide.com`). Ensure this constraint.

### 2. Service Worker Network Intercept (For WebContainers)
- **Constraint:** If the user is running WebContainers in the browser (Free Tier), there is no actual external server to point the iframe `src` to.
- **Elite Logic:**
  - Import `@webcontainer/api` listeners to wait for the `server-ready` event.
  - This event emits an internal virtual URL.
  - **CRITICAL:** Sometimes, the `server-ready` event fires *before* the Dev Server is fully responding to HTTP requests, leading to a "502 Bad Gateway" in the iframe.
  - You MUST implement a retry loop (`fetch(url)`) with exponential backoff before you physically set the iframe `src={url}` in the React state. Let it show a Skeleton Loader in the meantime.

### 3. Hot Module Reloading (HMR) Sync 
- **Constraint:** When a user types a character in Monaco Editor, the preview must update instantly. If the iframe reloads the entire page every keystroke, it's a terrible UX.
- **Elite Logic:**
  - Do NOT manually `.reload()` the iframe.
  - Rely exclusively on the Vite/Webpack HMR built into the user's project (via the `execution-service` or WebContainer).
  - The iframe contains a WebSocket listener (e.g., `wss://*.preview.ide.com/_hmr`). 
  - Ensure the `api-gateway` allows WebSockets to upgrade and route through the proxy layer directly to the running node process in the Firecracker VM.
  - If the user explicitly clicks a "Restart Banner" inside the IDE UI, only then do you force an iframe remount via React `key={Date.now()}`.

### 4. Interactive URL Address Bar
- **Constraint:** Users need to test different routes (e.g., `/login`, `/dashboard`) inside their preview app without reloading the IDE page.
- **Elite Logic:**
  - Implement a mini "Browser Address Bar" UI directly above the IFrame in `PreviewPane.tsx`.
  - Listen to `message` events from the IFrame to detect history popstate triggers (Route changes inside the preview app). Update the mini Address Bar URL state to match.
  - If a user types into the mini Address Bar and hits Enter, change the IFrame `src` to navigation.
