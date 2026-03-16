# 🚪 API Gateway — Development Logic & Architecture

> **Target:** `services/api-gateway/` (Node.js/Fastify, Go, or Kong/Nginx)
> **Goal:** The absolute front door of the backend platform. All HTTP traffic from the React frontend, IDE client, and external APIs hits here first before being routed to downstream microservices.
> **Standard:** Microsecond latency. Zero tolerance for security bypasses. Robust circuit-breaking.

## 📁 Required File Structure (Developer must follow)

```text
src/
 ├── routes/
 │    └── proxy_router.ts          # Central routing dictionary
 ├── middleware/
 │    ├── edge_auth.ts             # JWT signature verification (Stateless)
 │    ├── global_rate_limiter.ts   # IP-based edge throttling (Redis)
 │    └── ddos_protection.ts       # Payload size checks, slow-loris protection
 ├── proxy/
 │    └── circuit_breaker.ts       # Fail-fast logic if a microservice is down
 └── logging/
      └── request_tracer.ts        # Inject X-Trace-Id into all downstream requests
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Stateless Edge Authentication (The "Bouncer" Rule)

- **Constraint:** The API Gateway MUST NOT query the database to check if a user is valid on every request. That defeats the purpose of microservices.
- **Logic:**
  - The Gateway only loads the `JWT Public Key` on boot.
  - When a request hits `/api/v1/projects/...`, the Gateway intercepts the `Authorization: Bearer <token>`.
  - It validates the signature locally (takes microseconds).
  - If valid, it decodes the payload, injects `X-User-Id` and `X-User-Role` into the raw HTTP headers, and forwards the request to the `project-service`.
  - Downstream services NEVER verify the JWT; they only trust the `X-User-Id` header injected by the internal Gateway.
    _(Exception: Requests to `/api/v1/auth/_`bypass this check and go straight to`auth-service`).\*

### 2. Centralized Routing & Load Balancing

- **Constraint:** Hardcoding IP addresses or ports of microservices is strictly forbidden.
- **Logic:**
  - Route configurations must read from environment variables or a service mesh (e.g., Kubernetes CoreDNS).
  - **Complete Routing Map (ALL services):**
    - `^/api/v1/auth/(.*)$` ➔ `http://auth-service:8001/$1`
    - `^/api/v1/projects/(.*)$` ➔ `http://project-service:8002/$1`
    - `^/api/v1/billing/(.*)$` ➔ `http://billing-service:8003/$1`
    - `^/api/v1/ai/(.*)$` ➔ `http://ai-service:8004/$1`
    - `^/api/v1/exec/(.*)$` ➔ `http://execution-service:8005/$1`
    - `^/api/v1/search/(.*)$` ➔ `http://search-service:8006/$1`
    - `^/api/v1/deploy/(.*)$` ➔ `http://deployment-service:8007/$1`
    - `^/api/v1/storage/(.*)$` ➔ `http://storage-service:8008/$1` _(file upload: max 50MB body)_
    - `^/api/v1/templates/(.*)$` ➔ `http://project-service:8002/templates/$1`
    - `^/api/v1/packages/(.*)$` ➔ `http://execution-service:8005/packages/$1`
    - `^/api/v1/admin/analytics/(.*)$` ➔ `http://analytics-service:8009/$1`
    - `^/api/v1/admin/feature-flags/(.*)$` ➔ `http://analytics-service:8009/feature-flags/$1`
    - `^/api/v1/admin/(.*)$` ➔ `http://project-service:8002/admin/$1` _(user mgmt, reports)_
    - `^/api/v1/notifications/(.*)$` ➔ `http://notification-service:8010/$1`
  - **WebSocket Upgrade** (NOT proxied through HTTP routing):
    - `wss://ws.platform.io/gateway` ➔ `http://websocket-gateway:8011/` _(handled by separate Nginx upstream)_

### 3. Circuit Breaker Pattern (Cascading Failure Protection)

- **Constraint:** If the `ai-service` crashes, requests to `/api/v1/projects` MUST NOT be delayed or impacted.
- **Logic:**
  - Use a Circuit Breaker (e.g., `opossum` in Node.js).
  - If `ai-service` fails 50% of requests or takes >5000ms for 10 consecutive calls, the Circuit Breaker trips to "OPEN".
  - Subsequent calls to `/api/v1/ai/*` instantly fail with `503 Service Unavailable` at the Gateway level, allowing the `ai-service` time to recover without overwhelming it.

### 4. Strict Payload and CORS Security & NAT Defense

- **Constraint:** The system must drop malicious payloads before they hit internal subnets, and prevent university NAT users from being collectively banned by IP rate limits.
- **Logic:**
  - **Payload Size & Deep JSON:** Reject any HTTP POST/PUT body > 2MB. Furthermore, the middleware MUST enforce a max JSON nesting depth (e.g., 20) and drop payloads with prototype pollution vectors (`__proto__`, `constructor`) before passing them to backend JSON parsers.
  - **Auth-Aware Rate Limiting (Critical):** The global rate limiter MUST NOT blindly rate-limit by IP for authenticated routes. Standard IP rate limiting will permanently block 1,000 developers behind a single corporate/university NAT. It MUST rate limit by `X-User-Id` (derived from the JWT), and fall back to IP _only_ for anonymous endpoints (e.g., `/login` or `/api/v1/public`).
  - **CORS:** Only allow origins from `https://platform.io`, `https://*.platform.io`, and `http://localhost:3000` (in dev). Reject all others.
  - **Headers:** Strip out any custom headers from the client that try to spoof internal states (e.g., if a hacker sends `X-User-Id: 123` from their browser, the Gateway MUST drop it and override it with the real one from the JWT).

### 5. Datadog / ELK Tracing

- **Constraint:** Tracing an error across 9 microservices is impossible without a unified ID.
- **Logic:**
  - Generate a unique `UUID` for every incoming request.
  - Set it as `X-Trace-Id` and pass it to downstream services.
  - Log exactly 1 line per HTTP request: `[2024-03-12T...] Route=/api/v1/projects Status=200 Duration=45ms Trace=xxx`.

### 6. The "Double-Click" Defense (Idempotency Middleware)

- **Constraint:** A lagging user double-clicking "Deploy" will spin up 2 Vercel builds and double-charge their credit card if the Gateway doesn't block the duplicate HTTP `POST`.
- **Logic (Extreme Rule):**
  - For EVERY `POST`, `PUT`, or `DELETE` request, the Gateway MUST extract the `Idempotency-Key` from the HTTP Header.
  - Query Redis: `SETNX idempotency:{key} "PROCESSING" EX 86400`.
  - If Redis returns `0` (exists) and value is `PROCESSING`, instantly return `HTTP 409 Conflict` (Duplicate, dropping).
  - If it exists and has a cached JSON response, return the cached `HTTP 200` response.
  - If it returns `1` (new), forward to the microservice. On return, overwrite the Redis key with the final JSON payload.
  - **Idempotency Cleanup (The Deadlock Defense):** If the upstream microservice times out, crashes, or returns a 5xx error, the Gateway MUST explicitly `DEL idempotency:{key}`. Leaving it as `PROCESSING` permanently locks the user out from retrying their failed action for 24 hours.

---

## ⚠️ ACTION ITEMS (Priority Order)

### Priority 1: Critical

#### 1.1 Verify Port Numbers Match System Design

- **Current:** Routes use ports 8001-8011
- **Required:** Update to match system design ports (8001-8011)
- **Files:** `src/routes/proxy_router.ts`
- **Reference:** `@analysis_report.md` Section 3.1

#### 1.2 Add API Versioning Strategy

- **Current:** No clear API versioning policy
- **Required:** Implement URL-based versioning (e.g., `/api/v1/projects`)
- **File:** `src/middleware/api_versioning.ts` (new)
- **Reference:** `@developer_guidelines.md` Section 2.3

### Priority 2: High

#### 2.1 Fix Routing Map to Match Services

- **Current:** Routes point to analytics-service:8009 which doesn't exist
- **Required:** Update routing to use correct service ports
- **File:** `src/routes/proxy_router.ts`
- **Reference:** `@analysis_report.md` Section 3.1

#### 2.2 Add Composite Indexes Documentation

- **Current:** No mention of composite indexes for common queries
- **Required:** Document recommended indexes for API query patterns
- **File:** `src/middleware/query_optimizer.ts` (new)
- **Reference:** `@developer_guidelines.md` Section 2.2

---

_Last Updated: March 12, 2026 - Action items from analysis_
