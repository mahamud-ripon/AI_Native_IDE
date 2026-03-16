# 🚪 API Gateway Service

The API Gateway is the absolute front door of the AI-Native IDE platform. All HTTP traffic from the React frontend, IDE client, and external APIs hits here first before being routed to downstream microservices.

## 📁 Architecture

```
src/
├── index.ts                      # Server entry point
├── app.ts                        # Fastify app configuration
├── middleware/
│   ├── edge_auth.ts              # JWT signature verification (stateless)
│   ├── global_rate_limiter.ts    # Auth-aware rate limiting (Redis)
│   ├── ddos_protection.ts        # Payload security (prototype pollution, deep nesting)
│   └── idempotency.ts            # Duplicate request prevention
├── routes/
│   └── proxy_router.ts           # Service routing with circuit breakers
├── proxy/
│   └── circuit_breaker.ts        # Fail-fast for downstream services
├── lib/
│   └── redis.ts                  # Redis connection
└── logging/
    └── request_tracer.ts         # X-Trace-Id injection
```

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Build the service
npm run build

# Start the server
npm start

# Development mode with hot reload
npm run dev
```

## 🔧 Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8000` |
| `HOST` | Server host | `0.0.0.0` |
| `JWT_PUBLIC_KEY` | RS256 public key for JWT verification | *(required)* |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `*_SERVICE_URL` | Downstream service URLs | `http://localhost:800x` |

## 🛡️ Security Features

### 1. Stateless Edge Authentication
- Loads JWT public key once on boot
- Validates RS256 signatures locally (microseconds)
- Injects `X-User-Id`, `X-User-Role`, `X-User-Email` headers
- Strips spoofed headers from clients
- No database queries on each request

### 2. Auth-Aware Rate Limiting
- Authenticated users: Rate limited by User ID (1000 req/min)
- Anonymous users: Rate limited by IP (50 req/min)
- Prevents NAT users from being collectively blocked
- High-cost endpoints have stricter limits

### 3. DDoS Protection
- Max JSON nesting depth: 20 levels
- Prototype pollution blocking (`__proto__`, `constructor`)
- Max body size: 2MB (50MB for storage uploads)

### 4. Idempotency
- `Idempotency-Key` header required for POST/PUT/DELETE
- 24-hour deduplication window
- Automatic cleanup on 5xx errors (deadlock defense)

### 5. Circuit Breaker
- Opens after 50% failure rate or 5s timeout
- 30-second recovery window
- Instant 503 when service unavailable
- Admin endpoint: `GET /gateway/circuit-breakers`

## 🌐 Service Routing

| Path | Target Service |
|------|----------------|
| `/api/v1/auth/*` | auth-service:8001 |
| `/api/v1/projects/*` | project-service:8002 |
| `/api/v1/billing/*` | billing-service:8006 |
| `/api/v1/ai/*` | ai-service:8003 |
| `/api/v1/exec/*` | execution-service:8004 |
| `/api/v1/search/*` | search-service:8008 |
| `/api/v1/deploy/*` | deployment-service:8011 |
| `/api/v1/storage/*` | storage-service:8009 |
| `/api/v1/admin/analytics/*` | analytics-service:8010 |
| `/api/v1/admin/feature-flags/*` | analytics-service:8010 |
| `/api/v1/notifications/*` | notification-service:8007 |

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test -- --coverage

# Run specific test file
npm test -- tests/unit/edge_auth.test.ts
```

## 📊 Monitoring

### Request Logs
```
[2026-03-12T10:30:00.000Z] Route=/api/v1/projects Status=200 Duration=45ms Trace=uuid
```

### Circuit Breaker Status
```bash
curl http://localhost:8000/gateway/circuit-breakers
```

## 🔒 JWT Token Format

Expected JWT payload structure:
```json
{
  "sub": "user_id_uuid",
  "email": "user@example.com",
  "role": "user",
  "iss": "ai-native-ide.auth",
  "iat": 1690000000,
  "exp": 1690000900
}
```

Signed with RS256 (asymmetric key pair).

## 📚 Documentation

- System Design: `AI_Native_IDE_System_Design.md`
- Architecture: `SYSTEM_BACKBONE_ARCHITECTURE.md`
- Event Contracts: `KAFKA_EVENT_CONTRACTS.md`
- Development Logic: `DEVELOPMENT_LOGIC.md`

## 🏛️ Compliance

This implementation follows the engineering rules defined in:
- Stateless edge authentication (no DB queries)
- Auth-aware rate limiting (not IP-based)
- SAGA pattern support for distributed transactions
- Idempotency for all mutating operations
- Circuit breakers for cascading failure protection
