# 🔐 Marketing Site — Authentication Flow Integration Logic

> **Target:** `apps/marketing-site/components/auth/`
> **Goal:** The "Login" and "Sign Up" screens presented right on the marketing domain.
> **Standard:** Fully integrated with `auth-service` via API Gateway. Seamless SSR rediction logic. Minimal UI friction.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Direct API Binding vs Next-Auth
- **Constraint:** We built a custom microservice (`auth-service`) in the backend. We DO NOT want the Marketing Site running its own separate database connections using libraries like default `next-auth` (Auth.js) connecting to Postgres.
- **Elite Logic:**
  - If using `next-auth` (Auth.js), configure it EXCLUSIVELY with the `CredentialsProvider`.
  - Inside the `authorize()` function, perform a `fetch` directly to `https://api.platform.io/v1/auth/login` (API Gateway -> `auth-service`).
  - Pass the returned JWT `AccessToken` and `RefreshToken` securely into the Next.js encrypted session cookie.
  - The Marketing Frontend never reads passwords. It only forwards them.

### 2. The CSRF / State Protection (OAuth Generation)
- **Constraint:** Enterprise users will click "Sign in with GitHub". If the OAuth state parameter is hijacked, the user logs into the attacker's account.
- **Elite Logic:**
  - When the user clicks the GitHub button, the component MUST trigger a server-side redirect to the `/api/v1/auth/github` endpoint.
  - The `auth-service` generates a unique `state` hash and sets an `httpOnly` cookie before redirecting the user to `github.com`.
  - When GitHub redirects back to the Marketing Site (`/auth/callback`), the API Gateway automatically consumes the cookie and the `?code=xxx` parameter securely on the backend, bypassing frontend React JS entirely for maximum security.

### 3. The "Logged-In" Redirect Trap
- **Constraint:** An existing user navigating to `platform.io` (Marketing Page) should not see the "Sign Up" hero banner. It's annoying.
- **Elite Logic:**
  - In the root layout or root page Server Component, check for the authentication cookie.
  - If it exists and is valid, intercept the render and execute `redirect('https://app.platform.io/dashboard')` (Send them instantly to the actual IDE App).
  - Do NOT flick the screen. The redirect must happen on the Edge Server before a single byte of HTML is painted to the browser.
