# 💳 Billing & Usage Service — Development Logic & Architecture

> **Target:** `services/billing-service/` (Node.js / Go)
> **Goal:** The single source of truth for platform Subscriptions, Plan enforcement, and Stripe Integration. Tracks AI tokens, VM compute minutes, and storage usage.
> **Standard:** Complete precision. Zero lost revenue. High-throughput metering without locking the database.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── controllers/
 │    ├── checkout_controller.ts   # Stripe Checkout Session generation
 │    ├── webhooks_controller.ts   # Stripe Webhook listener (Crucial)
 │    └── usage_controller.ts      # API for frontend to show usage graphs
 ├── services/
 │    ├── subscription_srv.ts      # SSOT Plan management logic
 │    └── metering_srv.ts          # High-speed usage incrementing
 ├── workers/
 │    └── daily_rollup_worker.ts   # Cron logic to sync Redis usage to Postgres
 ├── middleware/
 │    └── stripe_validator.ts      # Cryptographic webhook verification
 ├── events/
 │    ├── kafka_consumer.ts        # Listens to "user.created" -> creates Stripe Customer
 │    └── kafka_publisher.ts       # Publishes "plan.upgraded", "usage.limit_reached"
 └── README.md
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Single Source of Truth (SSOT) Rule
- **Constraint:** The `users` table NO LONGER contains a `plan` column (to prevent data inconsistency).
- **Logic:** 
  - Every time any service needs to know a user's plan limits (e.g., `ai-service` checking if a user can use GPT-4), it must ask the `billing-service`.
  - To prevent excessive DB queries, the `billing-service` must maintain a continuously updated Redis cache: `SET plan:{user_id} "PRO" EX 3600`.
  - When `subscription` changes in DB (via webhook), update the Redis cache instantly and broadcast a Kafka event `subscription.updated` so other services drop any stale cache.

### 2. High-Throughput Usage Metering (Atomic Lua Scripts)
- **Constraint:** AI Agents generate tokens extremely fast. An agent might make 5 LLM calls in 2 seconds. You CANNOT execute an `UPDATE usage...` in Postgres. Furthermore, you CANNOT separate the "check limit" and "increment" API calls, as 1,000 parallel requests will pass the check before the increment fires (TOCTOU Race Condition).
- **Logic:**
  - **Atomic Check-and-Decrement:** The check and increment MUST happen via a single, atomic **Redis Lua Script**.
  - Script logic: Check if `limit - current_usage >= requested_amount`. If true, `INCRBY usage 100` and return success. If false, return `-1` (Quota Exceeded) without modifying the counter.
  - **Cron Rollup:** The `daily_rollup_worker.ts` runs every 5 minutes. It reads the counters from Redis, batch-updates the `usage_daily` PostgreSQL table via Prisma, and resets the synced Redis values.

### 3. Stripe Webhook Cryptographic Security
- **Constraint:** Hackers will try to POST fake payloads to `/api/v1/billing/webhooks/stripe` to give themselves a free Enterprise plan.
- **Logic:**
  - The webhook endpoint MUST use the raw HTTP body buffer, not the parsed JSON body.
  - Verify the `Stripe-Signature` header using the `stripe_webhook_secret` from HashiCorp Vault.
  - Only process `invoice.payment_succeeded`, `customer.subscription.updated`, and `customer.subscription.deleted`.

### 4. Hard Limit Enforcement vs Soft Limits
- **Constraint:** We cannot allow infinite AI execution or VM runtime on Free Tiers.
- **Logic:**
  - Before starting a heavy task, services call `POST /v1/billing/meter` passing `{ type: "ai_tokens", amount: 1000 }`.
  - The billing service runs the **Redis Lua Script**. If it returns `-1`, the service returns `429 Too Many Requests` with `{ error: "QUOTA_EXCEEDED" }`.
  - Publish `{ topic: "usage.limit_reached", ... }` so Notification service emails the user to upgrade.

### 5. Asynchronous Customer Creation
- **Constraint:** User registration API must be <200ms. Calling Stripe API during signup makes it too slow.
- **Logic:**
  - The Auth-Service publishes `user.created`.
  - The Billing-Service Kafka Consumer picks this up.
  - It calls `stripe.customers.create({ email, name })`.
  - It saves the `stripe_customer_id` back to the PostgreSQL DB, and creates a default `subscriptions` record with `plan = FREE` and `status = active`.

---

## 🚀 API Endpoints Contract (Must Implement Exactly)

### POST `/api/v1/billing/checkout`
- **Header:** `Authorization: Bearer <token>`
- **Body:** `{ plan: "PRO", success_url: "...", cancel_url: "..." }`
- **Action:** Generates a Stripe Checkout URL securely linked to the user's `stripe_customer_id`.
- **Response:** `200 OK` | `Body: { url: "https://checkout.stripe.com/c/pay/..." }`

### POST `/api/v1/billing/webhooks/stripe`
- **Header:** `Stripe-Signature: t=16...,v1=...`
- **Body:** Raw Buffer
- **Action:** Validate signature. Update `subscriptions` table (SSOT). Update Redis cache. Fire Kafka events.
- **Response:** `200 OK` (Always return 200 quickly to Stripe to prevent retries).

### POST `/api/v1/billing/meter`  (Internal Microservice API)
- **Body:** `{ user_id: "...", type: "ai_token" | "vm_minute" | "storage_gb", amount: 154 }`
- **Action:** Increment Redis usage counters (O(1) time complexity). Fast return.
- **Response:** `200 OK`

### GET `/api/v1/billing/usage/current`
- **Header:** `Authorization: Bearer <token>`
- **Action:** Aggregate data from Postgres `usage_daily` PLUS the current un-synced Redis counters to show accurate real-time usage graphs on the frontend D3 dashboards.
- **Response Format:**

---

## ⚠️ ACTION ITEMS (Priority Order)

### Priority 1: Critical

#### 1.1 Add Circuit Breaker
- **Current:** No circuit breaker for Stripe API calls
- **Required:** Add circuit breaker to prevent cascading failures
- **File:** `src/services/stripe_client.ts`
- **Reference:** `@developer_guidelines.md` Section 1.3

### Priority 2: High

#### 2.1 Add Composite Indexes
- **Current:** No composite indexes for usage queries
- **Required:** Add indexes for (user_id, date), (user_id, plan)
- **File:** Database migration file
- **Reference:** `@developer_guidelines.md` Section 2.2

---

*Last Updated: March 12, 2026 - Action items from analysis*
```json
{
  "success": true,
  "data": {
    "plan": "PRO",
    "status": "active",
    "usage": {
      "ai_tokens_used": 45000,
      "ai_tokens_limit": 1000000,
      "vm_compute_minutes": 120,
      "vm_compute_limit": 500
    }
  }
}
```
