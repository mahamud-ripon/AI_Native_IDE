# 🚪 Admin Panel — Next.js API Routes (BFF Layer)

> **Target:** `apps/admin/src/app/api/`
> **Goal:** Act as a strict "Backend-For-Frontend" (BFF) proxy. The Admin browser should NEVER talk directly to the `api-gateway` or underlying microservices.
> **Standard:** Next.js Route Handlers. Edge Runtime. Secure Cookie Forwarding.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The BFF Proxy Pattern
- **Constraint:** Exposing the raw `https://api.platform.io/v1/auth/users` endpoint directly to the browser exposes the internal architecture and requires handling complex CORS rules on the microservices.
- **Elite Logic:**
  - The Admin UI must ONLY call relative paths: `fetch('/api/users')`.
  - Next.js Route Handlers (`app/api/users/route.ts`) intercept this call.
  - The Route Handler then makes a server-to-server call to the internal internal API Gateway (`http://api-gateway:8000/v1/auth/users`) using the environment variable `INTERNAL_API_URL`.

### 2. Cookie & Header Injection
- **Constraint:** The internal microservices need the Admin's JWT token to verify identity, but the token is stored in an `httpOnly` cookie that `fetch` cannot easily pass cross-origin.
- **Elite Logic:**
  - Inside the Next.js Route Handler, extract the `Authorization` or `session` cookie using `cookies().get('session')`.
  - Inject this token into the `Authorization: Bearer <token>` header of the outgoing internal `fetch` request.
  - Doing this guarantees the internal `api-gateway` correctly identifies the Admin, while the browser never physically touches the raw JWT text.

### 3. Edge HTTP Client
- **Constraint:** Using Node.js runtime for proxying simple JSON requests wastes RAM and delays TTFB (Time To First Byte).
- **Elite Logic:**
  - Export `export const runtime = 'edge'` at the top of every route handler.
  - Use the native `fetch` API. Do NOT use `axios` inside the Edge runtime as it relies on Node.js `http` modules which are incompatible.
