# 📦 Monorepo Packages — Elite Developer Logic & Architecture

> **Target:** `packages/` (`shared-types`, `ui`, `logger`, `config`)
> **Goal:** The absolute source of truth for all cross-boundary contracts. Eliminates code duplication, enforces strict type safety across Frontend/Backend, and guarantees UI consistency.
> **Standard:** Complete Reusability. Zero dependency leakage. Elite-level DRY (Don't Repeat Yourself) engineering.

## 📁 Required File Structure (Developer must follow)
```text
packages/
 ├── shared-types/                 # 🔵 TypeScript Interfaces & Validation
 │    ├── src/
 │    │    ├── schemas/            # Zod Validation Schemas (e.g., Auth, Project)
 │    │    ├── api-contracts/      # HTTP Request/Response Types (Frontend ↔ Backend)
 │    │    └── ws-events/          # WebSocket Enum Types & Payloads (Strict Binary/JSON formats)
 │    └── package.json             # "name": "@workspace/shared-types"
 │
 ├── ui/                           # 🎨 Radix UI / Shadcn / Tailwind Components
 │    ├── src/
 │    │    ├── components/         # Button, Modal, Dropdown (Dumb components, NO business logic)
 │    │    └── hooks/              # Reusable useClickOutside, useMediaQuery
 │    ├── tailwind.config.ts       # Global Design System Tokens
 │    └── package.json             # "name": "@workspace/ui"
 │
 ├── logger/                       # 📝 Standardized Datadog/ELK PINO Logger
 │    └── src/index.ts             # Masks PII (Passwords/Tokens) before logging
 │
 └── config/                       # ⚙️ ESLint, TSConfig, Prettier rules
      ├── eslint-preset.js         # Strict rules (No any, No console.log)
      └── tsconfig.base.json       # `strict: true`, `noImplicitAny: true`
```

## 🧠 Elite Engineering Guidelines for Developer (DO NOT DEVIATE)

### 1. The Strong Contract Protocol (`@workspace/shared-types`)
- **Constraint:** Frontend engineers must NEVER guess the API response format. Backend engineers must NEVER validate input manually. Misaligned types cause 80% of production bugs.
- **Elite Logic:**
  - **Single Source of Truth:** Define all Data Transfer Objects (DTOs) using `Zod` inside the `shared-types` package.
  - **Backend Usage:** `project-service` imports `CreateProjectSchema` from `@workspace/shared-types` and uses it as middleware to automatically reject bad POST requests with a 400 Status. 
  - **Frontend Usage:** `ide-client` imports `type CreateProjectResponse` from `@workspace/shared-types` and uses it in `React Query` hooks. If the backend adds a new field to the response, the frontend code will throw a TypeScript error at build time if not handled. This guarantees contract alignment.

### 2. The Sandbox UI Principle (`@workspace/ui`)
- **Constraint:** UI components must be completely agnostic of the application state. A `Button` should not know about "Redux", "Auth JWT", or "Axios".
- **Elite Logic:**
  - Develop all components in complete isolation (Storybook recommended).
  - Use **Tailwind Merge (`twMerge`)** and `clsx` to allow apps to override styles safely without CSS cascading conflicts.
  - **Strictly Dumb Components:** Pass data in via props, emit events out via callbacks (e.g., `onClick`).
  - By following this, `apps/admin`, `apps/marketing-site`, and `apps/ide` will all look identical and perfectly consistent, while importing the exact same `<Button />`.

### 3. The Centralized Logger (`@workspace/logger`)
- **Constraint:** Logging arbitrary objects in production leaks sensitive PII. However, deeply scanning a 5MB JSON payload for API keys synchronously will block the V8 Event Loop, freezing the microservice entirely.
- **Elite Logic:**
  - All 9 microservices MUST import the singleton logger from this package, not `console.log`.
  - The logger inherently wraps `Pino` (for high-speed async logging).
  - **Asynchronous PII Masking Interceptor:** Pino MUST be configured with an asynchronous `worker_plugin` or `pino.transport` (running in a separate Node.js Worker Thread). The background thread detects keys like `password`, `token` or uses fast regex to redact them, guaranteeing **zero event-loop blocking** for the main API process.
  - Standardized JSON Output: Every log must have `{ timestamp, level, trace_id, service_name, message }` so Datadog/ELK can parse it flawlessly.

### 4. Aggressive Linting & TSConfig (`@workspace/config`)
- **Constraint:** A 100-developer team will write 100 different styles of code. Left unchecked, this degrades into unmaintainable legacy code.
- **Elite Logic:**
  - The root ESLint config forbids standard bad practices.
  - Enforce `@typescript-eslint/no-explicit-any`. (If a dev uses `any`, the build fails).
  - Enforce `@typescript-eslint/require-await`. (Prevent dangling promises causing memory leaks).
  - `tsconfig.base.json` must be extended by all other apps/services. Setting `strictNullChecks: true` is non-negotiable.

### 5. WebSocket Event Standardization
- **Constraint:** Real-time Gateway events are messy. If Frontend expects `{ user_id }` and Backend sends `{ userId }`, the Collab UI crashes silently.
- **Elite Logic:**
  - Define all WS Channels and Event Payloads as literal Enums/Types in `shared-types/ws-events/`.
  - Compile the Yjs CRDT binary protocol buffers (`y-protocols`) wrapped in strict TypeScript interfaces here, so the `collab-service` and the `ide-client` (browser) are fundamentally synced on how to parse binary blobs.
