# 🔐 Authentication Service — Development Logic & Architecture

> **Target:** `services/auth-service/` (Node.js + Fastify / NestJS)
> **Goal:** The central Identity Provider (IdP) for the entire platform. Handles user registration, JWT issuance, OAuth (GitHub/Google), MFA, and strict session management. 
> **Standard:** Enterprise-grade security. Zero trust. Stateless where possible.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── controllers/
 │    ├── auth_controller.ts       # Route handlers (Login, Register, Logout, MFA)
 │    ├── oauth_controller.ts      # GitHub/Google OAuth callbacks
 │    └── account_controller.ts    # Password reset, Email verification
 ├── services/
 │    ├── jwt_service.ts           # RS256 token signing and verification
 │    ├── session_service.ts       # Manages refresh_tokens table in DB
 │    └── github_oauth.ts          # GitHub API integration for developer auth
 ├── middleware/
 │    ├── rate_limiter.ts          # Redis-based strict rate limiting (prevent brute force)
 │    └── require_auth.ts          # Validates Authorization headers
 ├── events/
 │    └── kafka_publisher.ts       # Publishes user lifecycle and email events
 └── config/
      └── keys/                    # Public/Private keys for JWT (Loaded from Vault)
```

## 🧠 Core Engineering Rules for Developer

### 1. The Token Strategy (Strict JWT Rotation)
- **Constraint:** Do NOT issue long-lived access tokens. If a token is stolen, the attacker cannot have permanent access.
- **Logic:**
  - **Access Token:** Short-lived `.jwt` (Expires in 15 minutes). Signed with `RS256` (Asymmetric Private Key).
  - **Refresh Token:** Long-lived (7 days). Stored in the `refresh_tokens` database table as an opaque hashed string (SHA-256).
  - **Rotation:** Every time a user uses a refresh token to get a new access token, the old refresh token MUST be immediately revoked (`is_revoked = true`), and a new one issued. (Refresh Token Rotation guards against session hijacking).

### 2. JWT Payload Standard
- **Constraint:** Do not bloat the JWT. Keep it under 1KB.
- **Mandatory Payload Structure:**
```json
{
  "sub": "user_id_uuid",
  "email": "user@example.com",
  "role": "user",
  "jti": "unique_jwt_id_uuid",
  "iss": "ai-native-ide.auth",
  "iat": 1690000000,
  "exp": 1690000900
}
```
*(Note: Do NOT include the `plan` in the JWT anymore, as the subscription is the Single Source of Truth and verified at the Gateway/Billing level to prevent stale claims).*

### 3. Password Hashing & MFA
- **Constraint:** Never store plaintext passwords. Even simple MD5/SHA is unacceptable.
- **Logic:** 
  - Use **Argon2id** or **Bcrypt (Cost >= 12)** for hashing passwords.
  - If a user has `mfa_enabled = true` in the `users` table, the `/v1/auth/login` endpoint must return `202 Accepted` with a temporary `mfa_required_token` (expires in 5 mins), NOT the final access token. The client must then call `/v1/auth/mfa-verify` with the TOTP code to get the actual tokens.

### 4. Enterprise Single Sign-On (OAuth / GitHub)
- **Constraint:** As an IDE, GitHub integration is mandatory.
- **Logic:**
  - Upon successful OAuth flow, store the GitHub `provider_user_id` and the AES-256 encrypted `access_token` in the `oauth_accounts` table.
  - This allows the `project-service` to clone private repositories on behalf of the user.
  - **Pre-Account Takeover Defense (Critical Rate):** If a GitHub email matches an existing password-based account, check `is_verified`. If the password account is `<is_verified: false>`, immediately OVERWRITE it and grant the OAuth login (attacker pre-registered the victim's email). If `<is_verified: true>`, force the user to verify email ownership by sending an OTP before merging the GitHub account.

### 5. Event-Driven Architecture (Pub/Sub)
- **Constraint:** Auth service must decouple itself from billing or mailing services. Do NOT use Nodemailer here.
- **Logic:**
  - **Registration:** Publish Kafka message: `{ topic: "user.created", payload: { userId, email, username } }`. (Billing-service will create a Free Tier subscription, Notification-service will send a Welcome email).
  - **Password Reset / Email Verify:** Publish `{ topic: "auth.email_action", payload: { userId, email, action: "reset_password", token: "otp_or_hash" } }`. The Notification-service will actually dispatch the email.
  - **Logout All Devices:** Update `is_revoked = true` for all user tokens in DB, and publish `{ topic: "user.sessions_revoked", payload: { userId } }` so the WebSocket Gateway kicks the user out instantly.

### 6. Rate Limiting & Audit Logging
- **Constraint:** Login APIs are the #1 target for botnets.
- **Logic:** 
  - Implement Redis-based rate limiters specifically on `/login` and `/register`. 
  - Maximum 5 failed attempts per IP per 10 minutes. 
  - After 5 failures, block the IP for 30 minutes.
  - **Audit Logs:** Every successful login, failed login attempt, password reset, and MFA enablement MUST be logged via Prisma into the `audit_logs` table (include `ip_address`, `user_agent`, and `action`).

---

## 🚀 API Endpoints Contract (Must Implement Exactly)

### POST `/api/v1/auth/register`
- **Body:** `{ email, username, password }`
- **Action:** Hash password, insert into `users` table, fire `user.created` Kafka event, generate Tokens.
- **Response:** `201 Created` 
  - `Body: { accessToken, user }` 
  - `Cookie: refreshToken (HttpOnly, Secure, SameSite=Strict)`

### POST `/api/v1/auth/login`
- **Body:** `{ email_or_username, password }`
- **Action:** Verify password. If `mfa_enabled`, return 202. Else, return 200 with tokens. Write to `audit_logs`.
- **Response:** `200 OK` (Tokens) OR `202 Accepted` `{ mfaRequired: true, mfaToken: "..." }`

### POST `/api/v1/auth/refresh`
- **Cookie:** `refreshToken`
- **Action:** Validate token in `refresh_tokens`. Mark old as revoked. Generate new Access/Refresh pair.
- **Response:** `200 OK` `Body: { accessToken }`, `Cookie: new_refreshToken`

### POST `/api/v1/auth/logout`
- **Header:** `Authorization: Bearer <token>`
- **Action:** Mark the specific `refresh_token` as revoked in DB.
- **Response:** `200 OK` `Clear-Cookie: refreshToken`

### POST `/api/v1/auth/forgot-password`
- **Body:** `{ email }`
- **Action:** Generate 6-digit OTP or signed token, expire in 15m (use Redis). Fire `auth.email_action` Kafka event. DO NOT leak if email exists (return 200 regardless).

*(Developer Note: Rely entirely on `@workspace/database` Prisma client for all DB operations. Do not manually connect to Postgres).*
