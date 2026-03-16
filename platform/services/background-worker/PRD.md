# Background Worker - Product Requirements Document (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Service:** background-worker (Worker Daemon)  
> **Tech Stack:** Node.js + BullMQ + Redis + Prisma

---

## 1. Executive Summary

The Background Worker is the unsung hero of the platform. It executes all asynchronous cron jobs, data cleanups, garbage collection, and usage aggregations. It runs completely headless with no HTTP server, and is 100% resilient to crashes with idempotent operations.

---

## 2. Current Implementation Status

### ✅ Already Implemented

| Feature | File | Status |
|---------|------|--------|
| BullMQ Queue System | `queue_consumer.ts` | ✅ Complete |
| Cron Manager | `cron_manager.ts` | ✅ Complete |
| VM Hibernation Job | `vm_hibernation_job.ts` | ✅ Complete |
| Usage Rollup Job | `usage_rollup_job.ts` | ✅ Complete |
| Garbage Collector | `garbage_collector.ts` | ✅ Complete |
| Telemetry Job | `telemetry_job.ts` | ✅ Complete |
| Dead Letter Queue | `dead_letter_queue.ts` | ✅ Complete |
| Distributed Locking | `lib/redis.ts` | ✅ Complete |
| Graceful Shutdown | `index.ts` | ✅ Complete |
| Health Check | `index.ts` | ✅ Complete |

### ❌ Missing / To Be Implemented

| Feature | Priority | Status |
|---------|----------|--------|
| Kafka Consumer for Events | HIGH | ❌ Missing |
| AI Tasks (ai.generate_orchestrate) | HIGH | ❌ Missing |
| AI Tasks (ai.scan_generated_code) | HIGH | ❌ Missing |
| AI Tasks (ai.fallback_provider) | HIGH | ❌ Missing |
| Embedding Tasks | MEDIUM | ❌ Missing |
| Email Tasks | HIGH | ❌ Missing |
| Stripe Usage Sync | MEDIUM | ❌ Missing |
| Project Archival | LOW | ❌ Missing |

---

## 3. Architecture

### 3.1 No HTTP Endpoints

This is a pure worker daemon. It does NOT serve web traffic. Jobs are triggered via:
- Cron schedules (node-cron)
- Redis Queue (BullMQ)
- Kafka events (future)

### 3.2 Queue Configuration

| Queue | Workers | Priority | Purpose |
| :--- | :---: | :--- | :--- |
| `ai` | 2 | HIGH | AI orchestration and security scanning |
| `email` | 10 | HIGH | Transactional emails |
| `cleanup` | 5 | LOW | Resource cleanup and archival |
| `embedding` | 3 (CPU-heavy) | MEDIUM | Code embedding generation |
| `usage` | 2 | MEDIUM | Usage aggregation and billing sync |

---

## 4. Scheduled Jobs (Cron)

### 4.1 Current Jobs

| Job Name | Schedule | Status |
|----------|----------|--------|
| VM Hibernation | `*/1 * * * *` (every 60s) | ✅ |
| Usage Rollup | `*/5 * * * *` (every 5min) | ✅ |
| Garbage Collector | `0 3 * * *` (daily 03:00 UTC) | ✅ |
| Telemetry Aggregation | `*/15 * * * *` (every 15min) | ✅ |

### 4.2 Job Details

#### A. VM Hibernation (Every 60 Seconds)
- Query Redis: `GET vm_last_active:{vm_id}`
- If VM idle > 10 minutes, acquire lock and trigger hibernation
- Update `project_snapshots.status = hibernated`

#### B. Usage Rollup (Every 5 Minutes)
- Scan Redis: `usage:{user_id}:{date}:*`
- Batch update `usage_daily` in Postgres
- Delete processed Redis keys

#### C. Garbage Collector (Daily 03:00 UTC)
- Delete expired `refresh_tokens`
- Delete expired `invitations`
- Delete orphaned `project_files` (s3_key IS NULL AND inline_content IS NULL)

#### D. Telemetry (Every 15 Minutes)
- Aggregate system metrics
- Store for Admin Dashboard

---

## 5. Queue Tasks (BullMQ)

### 5.1 AI Tasks (Queue: `ai`)

| Task Name | Trigger | Priority | Retry | Status |
| :--- | :--- | :--- | :--- | :--- |
| `ai.generate_orchestrate` | User prompt via API | HIGH | 2x | ❌ |
| `ai.scan_generated_code` | After AI generation | MEDIUM | 3x | ❌ |
| `ai.fallback_provider` | Primary LLM 5xx | HIGH | 1x | ❌ |

### 5.2 Embedding Tasks (Queue: `embedding`)

| Task Name | Trigger | Priority | Retry | Status |
| :--- | :--- | :--- | :--- | :--- |
| `embedding.update_file` | Kafka `file.modified` | MEDIUM | 3x | ❌ |
| `embedding.full_reindex` | Project import | LOW | 2x | ❌ |
| `embedding.remove_file` | Kafka `file.deleted` | LOW | 3x | ❌ |

### 5.3 Email Tasks (Queue: `email`)

| Task Name | Trigger | Priority | Retry | Status |
| :--- | :--- | :--- | :--- | :--- |
| `email.send_verification` | Kafka `user.created` | HIGH | 3x | ❌ |
| `email.send_invitation` | Kafka `invitation.created` | MEDIUM | 3x | ❌ |
| `email.send_deploy_status` | Kafka `deployment.completed` | MEDIUM | 2x | ❌ |
| `email.send_usage_alert` | Kafka `usage.limit_reached` | MEDIUM | 3x | ❌ |

### 5.4 Cleanup Tasks (Queue: `cleanup`)

| Task Name | Trigger | Priority | Retry | Status |
| :--- | :--- | :--- | :--- | :--- |
| `cleanup.idle_vms` | Scheduled: every 60s | LOW | 1x | ✅ |
| `cleanup.expired_invitations` | Daily 02:00 UTC | LOW | 1x | ✅ |
| `cleanup.orphan_s3` | Weekly Sunday 03:00 UTC | LOW | 1x | ❌ |
| `cleanup.archive_projects` | Daily 04:00 UTC | LOW | 1x | ❌ |
| `cleanup.expired_tokens` | Hourly | LOW | 1x | ✅ |

### 5.5 Usage Tasks (Queue: `usage`)

| Task Name | Trigger | Priority | Retry | Status |
| :--- | :--- | :--- | :--- | :--- |
| `usage.aggregate_daily` | Daily midnight UTC | MEDIUM | 3x | ✅ |
| `usage.sync_stripe_usage` | Hourly | MEDIUM | 3x | ❌ |

---

## 6. File Structure

### 6.1 Current Structure

```
src/
├── index.ts                    ✅ Main entry point
├── jobs/
│   ├── vm_hibernation_job.ts   ✅
│   ├── usage_rollup_job.ts     ✅
│   ├── garbage_collector.ts    ✅
│   └── telemetry_job.ts        ✅
├── scheduler/
│   └── cron_manager.ts         ✅
├── queue/
│   ├── queue_consumer.ts       ✅
│   └── dead_letter_queue.ts    ✅
└── lib/
    ├── redis.ts                ✅
    └── prisma.ts               ✅
```

### 6.2 Required Structure

```
src/
├── index.ts                    ✅
├── jobs/
│   ├── vm_hibernation_job.ts   ✅
│   ├── usage_rollup_job.ts     ✅
│   ├── garbage_collector.ts    ✅
│   ├── telemetry_job.ts        ✅
│   ├── ai_orchestrator.ts      ❌ NEW
│   ├── ai_code_scanner.ts      ❌ NEW
│   ├── email_sender.ts         ❌ NEW
│   ├── embedding_processor.ts  ❌ NEW
│   └── stripe_sync.ts          ❌ NEW
├── scheduler/
│   └── cron_manager.ts         ✅
├── queue/
│   ├── queue_consumer.ts       ✅
│   ├── dead_letter_queue.ts    ✅
│   └── kafka_consumer.ts       ❌ NEW
├── lib/
│   ├── redis.ts                ✅
│   └── prisma.ts               ✅
└── utils/
    └── logger.ts               ❌ NEW
```

---

## 7. Kafka Events (To Consume)

| Event | Topic | Action | Status |
|-------|-------|--------|--------|
| User Created | `user.created` | Send verification email | ❌ |
| Invitation Created | `invitation.created` | Send invitation email | ❌ |
| Deployment Completed | `deployment.completed` | Send deploy status email | ❌ |
| Usage Limit Reached | `usage.exceeded` | Send usage alert email | ❌ |
| File Modified | `file.modified` | Re-embed file | ❌ |
| File Deleted | `file.deleted` | Remove embeddings | ❌ |

---

## 8. Idempotency Requirements

Every job MUST be idempotent:
- Read data from Redis/DB
- Process and update
- Delete/zero-out the exact Redis key processed
- If crash halfway, safe retry on next tick

---

## 9. Distributed Locking

Uses Redis-based distributed locks (Redlock pattern):
- Prevents race conditions in multi-pod deployments
- Lock key format: `lock:cron:{job_name}`
- Lock TTL set per job

---

## 10. Retry & DLQ Policy

```
Retry: 3 attempts with exponential backoff (60s, 120s, 240s)
DLQ:   Failed tasks → Redis list "dlq:{task_name}"
       → Alert to PagerDuty (critical: ai.*, email.send_verification)
       → Alert to Slack (all others)
Crash Recovery: task_acks_late=True → re-queue on worker crash
```

---

## 11. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| bullmq | ^5.x | Queue processing |
| node-cron | ^3.x | Cron scheduling |
| ioredis | ^5.x | Redis client |
| redlock | ^5.x | Distributed locking |
| @prisma/client | ^5.x | Database ORM |
| dotenv | ^16.x | Environment config |

---

## 12. Environment Variables

```env
# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://localhost:6379

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_GROUP_ID=background-worker

# Execution Service (for VM hibernation)
EXECUTION_SERVICE_URL=http://execution-service:8004

# Stripe (for usage sync)
STRIPE_SECRET_KEY=
```

---

## 13. Implementation Roadmap

### Phase 1: Infrastructure (Priority: Critical)
- [x] BullMQ Queue System
- [x] Cron Manager
- [x] Distributed Locking
- [x] Graceful Shutdown
- [ ] Kafka Consumer

### Phase 2: Core Jobs (Priority: Critical)
- [x] VM Hibernation
- [x] Usage Rollup
- [x] Garbage Collector
- [x] Telemetry
- [ ] Stripe Usage Sync

### Phase 3: AI Tasks (Priority: High)
- [ ] AI Orchestrator
- [ ] AI Code Scanner
- [ ] Fallback Provider

### Phase 4: Email Tasks (Priority: High)
- [ ] Email Sender
- [ ] Verification Email
- [ ] Invitation Email
- [ ] Deploy Status Email
- [ ] Usage Alert Email

### Phase 5: Embedding Tasks (Priority: Medium)
- [ ] Embedding Processor
- [ ] Full Reindex
- [ ] Remove File

### Phase 6: Additional Cleanup (Priority: Low)
- [ ] Orphan S3 Cleanup
- [ ] Project Archival

---

## 14. Acceptance Criteria

### 14.1 Queue System
- [ ] All 5 queues configured with correct concurrency
- [ ] Jobs retry with exponential backoff
- [ ] Failed jobs go to DLQ after max retries

### 14.2 Cron Jobs
- [ ] All 4 cron jobs run on schedule
- [ ] Distributed locking prevents duplicate execution
- [ ] Idempotent operations

### 14.3 Kafka Integration
- [ ] Consume all required Kafka events
- [ ] Process events and trigger appropriate tasks
- [ ] Handle malformed events gracefully

### 14.4 Reliability
- [ ] Graceful shutdown waits for active jobs
- [ ] Crash recovery re-queues incomplete tasks
- [ ] Health check verifies all connections
