# 🌐 Marketing Site — API Routes & Integrations

> **Target:** `apps/marketing-site/app/api/`
> **Goal:** Handle lightweight external callbacks (like Stripe Customer Portal returns) and Waitlist/Newsletter signups securely.
> **Standard:** Next.js Serverless Functions. CSRF Validation. Minimal footprint.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Waitlist Proxy (No Direct DB Connection)
- **Constraint:** Opening a Prisma database connection directly from the Marketing Site Next.js functions defeats the microservices architecture and introduces a massive attack vector.
- **Elite Logic:**
  - When a user submits an email to the waitlist (`POST /api/waitlist`), intercept it using a Next.js App Router Route Handler.
  - Do NOT import Prisma.
  - Execute a secure `fetch()` call holding an internal service-to-service API key to the `api-gateway` which routes to the `project-service/auth-service`.
  - Return the 200 OK or 400 Bad Request to the UI.

### 2. Edge Response Caching
- **Constraint:** Thousands of people viewing the Marketing page will trigger `GET /api/stats` to show "Total Apps Generated Today". We cannot hit the database on every load.
- **Elite Logic:**
  - Ensure API handlers fetching aggregate platform statistics use Next.js Cache parameters.
  - `export const revalidate = 3600; // Cache for 1 hour`.
  - Vercel/Cloudflare will execute this function exactly once per hour geographically and serve static JSON to all subsequent users globally, eliminating database loads.

### 3. Stripe Checkout Conversions
- **Constraint:** Redirecting from Stripe checkout back to the frontend without validating the session can allow bad actors to spoof successful payments visually.
- **Elite Logic:**
  - Accept the Stripe success callback in `app/api/billing/success/route.ts`.
  - Wait for the backend webhook from Stripe to clear in the database via the `billing-service` (this takes ~1-3 seconds).
  - Check the secure session. If valid, trigger a celebratory UI confetti animation. If invalid or pending, show a loading spinner polling the backend until the invoice clears.
