# 📊 Analytics Service — Development Logic & Architecture

> **Target:** `services/analytics-service/` (TypeScript / Node.js)
> **Port:** `8010`
> **Goal:** Platform-wide usage analytics (DAU, MAU, MRR, churn rate), feature flag evaluation, and telemetry aggregation for the Admin Dashboard.
> **Standard:** Real-time metrics. Zero impact on user-facing latency. GDPR-compliant data aggregation.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── controllers/
 │    ├── overview_controller.ts       # GET /admin/analytics/overview — DAU, MAU, MRR
 │    ├── usage_controller.ts          # GET /admin/analytics/usage — AI calls, compute, storage
 │    ├── revenue_controller.ts        # GET /admin/analytics/revenue — Revenue by plan, growth
 │    └── feature_flag_controller.ts   # GET/POST/PATCH /admin/feature-flags
 ├── services/
 │    ├── metrics_aggregator.ts        # Aggregates raw events into materialized views
 │    ├── revenue_calculator.ts        # Calculates MRR, ARR, churn from subscriptions table
 │    ├── feature_flag_engine.ts       # Runtime flag evaluation (plan-based, percentage rollout)
 │    └── retention_analyzer.ts        # Cohort analysis, D7/D30 retention calculations
 ├── workers/
 │    ├── daily_snapshot_worker.ts     # Nightly: snapshot DAU, signups, revenue into time-series
 │    └── hourly_usage_rollup.ts      # Hourly: aggregate usage_daily into dashboard-ready format
 ├── events/
 │    └── kafka_consumer.ts           # Listens to user.created, project.created, subscription.updated
 └── config/
      └── feature_flags_seed.json     # Default feature flag definitions
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Materialized Views, NOT Live Queries
- **Constraint:** The Admin Dashboard cannot run `SELECT COUNT(*) FROM users WHERE last_active_at > NOW() - INTERVAL '24 hours'` on every page load. With 1M users, this query takes 3+ seconds and locks the DB.
- **Logic:**
  - Use **materialized views** or a dedicated `analytics_snapshots` table.
  - The `daily_snapshot_worker.ts` runs at midnight UTC. It calculates DAU, WAU, MAU, new signups, churn count, and total MRR, then inserts one row into `analytics_snapshots` with the date.
  - The API controller reads from this pre-computed table (O(1) query time).

### 2. Feature Flag System (LaunchDarkly-like)
- **Constraint:** We need to toggle features for specific plans (e.g., "AI Code Review" only for Pro users) without redeploying code.
- **Logic:**
  - Store flags in PostgreSQL: `feature_flags` table with `id, name, is_enabled, target_plans JSONB, rollout_percentage INTEGER, created_at`.
  - The `feature_flag_engine.ts` evaluates flags at runtime:
    1. Check `is_enabled`. If `false`, return `false`.
    2. Check if user's `plan` (from `billing-service` Redis cache) is in `target_plans`.
    3. If `rollout_percentage < 100`, hash `user_id` to deterministically decide inclusion.
  - Cache flag evaluations in Redis: `feature:{flag_name}:{user_id}` with 5-minute TTL.
  - The Admin Dashboard can toggle flags via `PATCH /admin/feature-flags/{id}`, which flushes the Redis cache.

### 3. Revenue Metrics (MRR/ARR)
- **Constraint:** MRR (Monthly Recurring Revenue) must be accurate to the cent. Do NOT calculate it from `users.plan` (which doesn't exist anymore). Calculate from the `subscriptions` table.
- **Logic:**
  - Query `subscriptions WHERE status = 'active'`.
  - Map each `stripe_price_id` to its monthly price (from a config file or Stripe API cache).
  - Sum = MRR. MRR × 12 = ARR.
  - Churn rate = `(cancelled_this_month / active_start_of_month) × 100`.

### 4. GDPR-Compliant Aggregation & Erasure Paradox
- **Constraint:** Analytics must NEVER store personally identifiable information (PII). A user requesting "Right to Erasure" cannot alter historical aggregated DAU or MRR numbers.
- **Logic:**
  - All high-level analytics data is irreversibly aggregated (counts, sums, averages). Historical snapshots in Postgres are immutable and exempt from deletion.
  - Individual user tracking uses only `user_id` UUIDs, never email or name.
  - If raw, line-item telemetry events are stored in a Data Lake (e.g., ClickHouse), they MUST be strictly partitioned by `user_id` to allow the `DELETE /admin/users/{id}/analytics` endpoint to execute a bulk Tombstone drop on the specific user's raw event history.

---

## 🚀 API Endpoints Contract (Must Implement Exactly)

### GET `/api/v1/admin/analytics/overview`
- **Auth:** `Bearer + Admin role`
- **Response:**
```json
{
  "success": true,
  "data": {
    "dau": 4521,
    "wau": 18340,
    "mau": 52100,
    "total_users": 125000,
    "new_signups_today": 234,
    "mrr_usd": 89500.00,
    "arr_usd": 1074000.00,
    "churn_rate_pct": 2.1
  }
}
```

### GET `/api/v1/admin/analytics/usage`
- **Auth:** `Bearer + Admin role`
- **Query:** `?period=7d|30d|90d`
- **Response:** Time-series arrays of `ai_requests`, `compute_hours`, `storage_gb`, `deployments` per day.

### GET `/api/v1/admin/analytics/revenue`
- **Auth:** `Bearer + Admin role`
- **Response:** Revenue breakdown by plan (Free, Pro, Team, Enterprise), MRR growth trend, and top churned plan.

### GET `/api/v1/admin/feature-flags`
- **Auth:** `Bearer + Admin role`
- **Response:** List of all flags with current status, target plans, and rollout percentage.

### POST `/api/v1/admin/feature-flags`
- **Auth:** `Bearer + Admin role`
- **Body:** `{ name: "ai_code_review", is_enabled: true, target_plans: ["pro", "enterprise"], rollout_percentage: 100 }`

### PATCH `/api/v1/admin/feature-flags/{id}`
- **Auth:** `Bearer + Admin role`
- **Body:** `{ is_enabled: false }` or `{ rollout_percentage: 50 }`
- **Action:** Update flag. Flush Redis cache for this flag instantly.

### GET `/api/v1/features/evaluate` (Internal — called by other services)
- **Query:** `?user_id=uuid&flag=ai_code_review`
- **Response:** `{ enabled: true }`
