# 🛡️ Admin Panel — RBAC & Protected Routes

> **Target:** `apps/admin/src/lib/api/` and `app/(dashboard)/`
> **Goal:** Secure the back-office panel so a regular IDE user cannot query `/admin/users` or `DELETE /admin/maintenance`.
> **Standard:** Next.js Server Components, strict `edge` Middleware, and JSON Web Token `role` validation.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Zero Trust Next.js Middleware Edge
- **Constraint:** An attacker could try a GET request to `admin.platform.io/users`. Checking permissions locally in `useEffect` is a fatal vulnerability.
- **Elite Logic:**
  - The protection MUST happen before the page even loads. Use Next.js `middleware.ts`.
  - Parse the HTTP `Authorization` cookie header.
  - Verify the JWT payload instantly using the lightweight `jose` library (runs on Vercel Edge).
  - Check `if (payload.role !== "superadmin")`. If true, return `NextResponse.redirect(new URL('/403', req.url))`.
  - Do NOT query the Postgres database from this middleware to check roles. Rely purely on the Edge JWT verification.

### 2. Destructive Server Actions
- **Constraint:** Halting a microservice or banning a user must be rigorously verified on the server via an explicit POST limit.
- **Elite Logic:**
  - Do NOT use standard React API routes (`/pages/api/` or `Route Handlers`) for mutating server states from the Admin UI.
  - Use **React Server Actions** inside Next.js 15: `export async function banUser(userId: string) { 'use server'; ... }`.
  - Inside the action, re-verify the Admin auth session.
  - Execute the API Gateway internal call: `fetch('http://api-gateway:8000/api/v1/auth/users/' + userId)` injecting the Admin API secret.
  - Log the specific user ID that *performed* the ban into the `audit_logs` table. Always trace the operator. 

### 3. Server-Side Data Fetching vs Waterfall
- **Constraint:** The Admin Dashboard landing page contains 6 graphs (Users, Projects, Finance, Memory, VMs, Load). Waiting for 6 individual client `useFetch` requests causes awful CLS (Cumulative Layout Shift) loading states.
- **Elite Logic:**
  - In `app/(dashboard)/page.tsx`, execute the 6 promises simultaneously via `Promise.all()` in the Server Component.
  - Await the fully gathered dataset.
  - Pass the pristine dataset down to the Client Components (D3 SVGs). This returns the page perfectly rendered in a single HTML transmission.
