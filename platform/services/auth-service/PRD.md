# Auth Service - Product Requirements Document (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Service:** auth-service (Port 8001)  
> **Tech Stack:** Node.js + Fastify + Prisma + Kafka

---

## 1. Executive Summary

The Auth Service is the central Identity Provider (IdP) for the AI-Native IDE Platform. It handles user registration, JWT issuance with refresh token rotation, OAuth (GitHub/Google), MFA, and strict session management. The service follows enterprise-grade security standards with zero-trust architecture.

---

## 2. Current Implementation Status

### ✅ Already Implemented

| Feature | File | Status |
|---------|------|--------|
| User Registration | `auth_controller.ts` | ✅ Complete |
| User Login | `auth_controller.ts` | ✅ Complete |
| JWT (RS256) | `jwt_service.ts` | ✅ Complete |
| Refresh Token Rotation | `session_service.ts` | ✅ Complete |
| Kafka Event Publishing | `kafka_publisher.ts` | ✅ Complete |
| Audit Logging | `auth_controller.ts` | ✅ Complete |
| Rate Limiting | `auth_controller.ts` | ✅ Complete (5 req/10min) |
| Password Hashing (Argon2id) | `auth_controller.ts` | ✅ Complete |
| Logout | `auth_controller.ts` | ✅ Complete |
| Forgot Password | `auth_controller.ts` | ✅ Complete |
| OpenAPI Documentation | `docs/openapi.yaml` | ✅ Complete |
| X-API-Version Header | `docs/openapi.yaml` | ✅ Complete |
| Health Endpoints | `docs/openapi.yaml` | ✅ Complete |

### ❌ Missing / To Be Implemented

| Feature | Priority | Status |
|---------|----------|--------|
| OAuth Controller (GitHub/Google) | HIGH | ❌ Missing |
| MFA Verify Endpoint | HIGH | ❌ Missing |
| Email Verification | HIGH | ❌ Missing |
| Reset Password Confirm | HIGH | ❌ Missing |
| Logout All Devices | MEDIUM | ❌ Missing |
| Change Password | MEDIUM | ❌ Missing |
| Account Deletion | MEDIUM | ❌ Missing |
| Session Management API | MEDIUM | ❌ Missing |
| Redis Rate Limiter | HIGH | ⚠️ Using in-memory |
| Vault Integration | HIGH | ❌ Missing |
| Middleware: require_auth | HIGH | ❌ Missing |

---

## 3. API Endpoints

### 3.1 Authentication Endpoints

| Method | Endpoint | Auth | Status |
|--------|----------|------|--------|
| POST | `/api/v1/auth/register` | No | ✅ |
| POST | `/api/v1/auth/login` | No | ✅ |
| POST | `/api/v1/auth/refresh` | Cookie | ✅ |
| POST | `/api/v1/auth/logout` | Bearer | ✅ |
| POST | `/api/v1/auth/forgot-password` | No | ✅ |
| POST | `/api/v1/auth/reset-password` | No | ❌ |
| POST | `/api/v1/auth/mfa-verify` | No | ❌ |
| POST | `/api/v1/auth/mfa-enable` | Bearer | ❌ |
| POST | `/api/v1/auth/mfa-disable` | Bearer | ❌ |

### 3.2 OAuth Endpoints

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/api/v1/auth/oauth/github` | Initiate GitHub OAuth | ❌ |
| GET | `/api/v1/auth/oauth/github/callback` | GitHub callback | ❌ |
| GET | `/api/v1/auth/oauth/google` | Initiate Google OAuth | ❌ |
| GET | `/api/v1/auth/oauth/google/callback` | Google callback | ❌ |

### 3.3 Account Management Endpoints

| Method | Endpoint | Auth | Status |
|--------|----------|------|--------|
| POST | `/api/v1/auth/account/verify-email` | No | ❌ |
| PUT | `/api/v1/auth/account/password` | Bearer | ❌ |
| DELETE | `/api/v1/auth/account` | Bearer | ❌ |
| GET | `/api/v1/auth/sessions` | Bearer | ❌ |
| DELETE | `/api/v1/auth/sessions/all` | Bearer | ❌ |

### 3.4 Health & Service Endpoints

| Method | Endpoint | Status |
|--------|----------|--------|
| GET | `/api/v1/health` | ✅ |
| GET | `/api/v1/health/circuit-breaker` | ✅ |

---

## 4. Data Models

### 4.1 User (from Prisma Schema)

```prisma
model User {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email            String    @unique @db.VarChar(255)
  username         String    @unique @db.VarChar(50)
  hashedPassword   String?   @map("password_hash") @db.Text
  fullName         String?   @map("full_name") @db.VarChar(255)
  avatarUrl        String?   @map("avatar_url") @db.Text
  stripeCustomerId String?   @unique @map("stripe_customer_id") @db.VarChar(255)
  isVerified       Boolean   @default(false) @map("is_verified")
  isActive         Boolean   @default(true) @map("is_active")
  mfaEnabled       Boolean   @default(false) @map("mfa_enabled")
  mfaSecret        String?   @map("mfa_secret") @db.Text
  lastActiveAt     DateTime? @map("last_active_at") @db.Timestamptz()
  lastLoginAt      DateTime? @map("last_login_at") @db.Timestamptz()
  deletedAt        DateTime? @map("deleted_at") @db.Timestamptz()
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz()
}
```

### 4.2 RefreshToken (from Prisma Schema)

```prisma
model RefreshToken {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique @map("token_hash") @db.VarChar(64)
  deviceInfo String?  @map("device_info") @db.Text
  ipAddress  String?  @map("ip_address") // Intentionally String to act as INET
  isRevoked  Boolean  @default(false) @map("is_revoked")
  expiresAt  DateTime @map("expires_at") @db.Timestamptz()
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([userId])
  @@map("refresh_tokens")
}
```

### 4.3 OAuthAccount (from Prisma Schema)

```prisma
model OAuthAccount {
  id             String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId         String        @map("user_id") @db.Uuid
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider       OAuthProvider
  providerUserId String        @map("provider_user_id") @db.VarChar(255)
  accessToken    String?       @map("access_token") @db.Text
  refreshToken   String?       @map("refresh_token") @db.Text
  tokenExpiresAt DateTime?     @map("token_expires_at") @db.Timestamptz()
  createdAt      DateTime      @default(now()) @map("created_at") @db.Timestamptz()

  @@unique([provider, providerUserId])
  @@index([userId])
  @@map("oauth_accounts")
}
```

---

## 5. Security Requirements

### 5.1 Token Strategy

| Token Type | Lifetime | Storage | Algorithm |
|------------|----------|---------|-----------|
| Access Token | 15 minutes | Memory (JWT) | RS256 |
| Refresh Token | 7 days | HttpOnly Cookie + DB (hashed) | SHA-256 |

### 5.2 JWT Payload Structure

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

### 5.3 Security Features

- **Password Hashing:** Argon2id (cost >= 12)
- **Rate Limiting:** 5 failed attempts per IP per 10 minutes → 30 min block
- **Audit Logging:** All auth events logged to `audit_logs` table
- **MFA:** TOTP-based (Google Authenticator compatible)
- **OAuth:** GitHub + Google with encrypted token storage

---

## 6. Kafka Events

### 6.1 Published Events

| Event | Topic | Payload | Status |
|-------|-------|---------|--------|
| User Registered | `user.created` | `{ userId, email, username }` | ✅ |
| Login Success | `user.login` | `{ userId, ipAddress }` | ⚠️ Audit log only |
| Login Failed | `user.login_failed` | `{ email, ipAddress }` | ⚠️ Audit log only |
| Sessions Revoked | `user.sessions_revoked` | `{ userId }` | ✅ |
| Password Reset Request | `auth.email_action` | `{ userId, email, action, token }` | ✅ |
| Email Verification | `auth.email_action` | `{ userId, email, action, token }` | ❌ |

---

## 7. File Structure

### 7.1 Current Structure

```
src/
├── app.ts                    ✅
├── index.ts                  ✅
├── controllers/
│   └── auth_controller.ts    ✅
├── services/
│   ├── jwt_service.ts        ✅
│   └── session_service.ts    ✅
├── events/
│   └── kafka_publisher.ts    ✅
├── schemas/
│   └── auth.schema.ts        ✅
└── lib/
    └── db.ts                 ⚠️ (stub)
```

### 7.2 Required Structure

```
src/
├── app.ts
├── index.ts
├── controllers/
│   ├── auth_controller.ts        ✅
│   ├── oauth_controller.ts       ❌ NEW
│   ├── account_controller.ts     ❌ NEW
│   └── mfa_controller.ts         ❌ NEW
├── services/
│   ├── jwt_service.ts            ✅
│   ├── session_service.ts        ✅
│   ├── oauth_service.ts          ❌ NEW
│   ├── mfa_service.ts            ❌ NEW
│   └── rate_limiter.ts           ❌ NEW
├── middleware/
│   ├── rate_limiter.ts           ❌ NEW
│   └── require_auth.ts           ❌ NEW
├── events/
│   └── kafka_publisher.ts        ✅
├── utils/
│   ├── email_template.ts         ❌ NEW
│   └── crypto_utils.ts           ❌ NEW
└── config/
    └── keys/                     ❌ NEW (Vault integration)
```

---

## 8. Implementation Roadmap

### Phase 1: Core Authentication (Priority: Critical)

- [x] User Registration
- [x] User Login
- [x] JWT Service
- [x] Refresh Token Rotation
- [x] Logout
- [x] Forgot Password
- [ ] Reset Password Confirm
- [ ] Email Verification

### Phase 2: OAuth & MFA (Priority: High)

- [ ] GitHub OAuth Flow
- [ ] Google OAuth Flow
- [ ] MFA Enable/Disable
- [ ] MFA Verify Endpoint
- [ ] Pre-Account Takeover Defense

### Phase 3: Account Management (Priority: Medium)

- [ ] Change Password
- [ ] Account Deletion
- [ ] Session Management API
- [ ] Logout All Devices

### Phase 4: Infrastructure (Priority: High)

- [ ] Redis Rate Limiter
- [ ] Vault Integration for Keys
- [ ] require_auth Middleware
- [ ] Production-grade Prisma Client

---

## 9. Acceptance Criteria

### 9.1 Registration
- [ ] User can register with email, username, password
- [ ] Password is hashed with Argon2id
- [ ] Kafka event `user.created` is published
- [ ] Access token + refresh token cookie returned

### 9.2 Login
- [ ] User can login with email or username
- [ ] Password verified with Argon2id
- [ ] MFA flow triggered if enabled
- [ ] Failed attempts rate-limited
- [ ] Audit log created

### 9.3 Token Management
- [ ] Access token expires in 15 minutes
- [ ] Refresh token valid for 7 days
- [ ] Token rotation on every refresh
- [ ] Old refresh tokens revoked immediately

### 9.4 OAuth
- [ ] GitHub OAuth flow works end-to-end
- [ ] Google OAuth flow works end-to-end
- [ ] Tokens encrypted in database
- [ ] Pre-account takeover defense implemented

### 9.5 MFA
- [ ] User can enable MFA (generate secret)
- [ ] User can disable MFA (verify password first)
- [ ] Login requires MFA code when enabled

---

## 10. Testing Requirements

| Test Type | Coverage Target |
|-----------|-----------------|
| Unit Tests | 80% for services |
| Integration Tests | All endpoints |
| Security Tests | Brute force, token theft |
| Load Tests | 1000 RPS |

---

## 11. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| fastify | ^4.x | HTTP server |
| @fastify/cookie | ^9.x | Cookie management |
| @fastify/rate-limit | ^8.x | Rate limiting |
| argon2 | ^0.30.x | Password hashing |
| jsonwebtoken | ^9.x | JWT handling |
| @prisma/client | ^5.x | Database ORM |
| kafkajs | ^1.x | Kafka client |
| speakeasy | ^1.x | TOTP/MFA |
| otplib | ^1.x | TOTP verification |
| zod | ^3.x | Schema validation |

---

## 12. Environment Variables

```env
# Database
DATABASE_URL=postgresql://...

# Kafka
KAFKA_BROKERS=localhost:9092

# JWT Keys (from Vault in production)
JWT_PRIVATE_KEY=<RS256 private key>
JWT_PUBLIC_KEY=<RS256 public key>

# OAuth (from Vault)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Redis (for rate limiting)
REDIS_URL=redis://localhost:6379

# Vault (for secrets)
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=
```
