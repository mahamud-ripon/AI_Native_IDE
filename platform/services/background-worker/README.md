# ⚙️ Background Worker

> The unsung hero of the platform. Executes all asynchronous cron jobs, data cleanups, garbage collection, and usage aggregations.

## 🎯 Overview

The background-worker is a **headless daemon** that runs background tasks without HTTP endpoints. It's designed to be:

- **100% Resilient**: Handles crashes gracefully with idempotent operations
- **Distributed**: Supports multi-instance deployment with Redis locks
- **Event-Driven**: Consumes from Kafka and BullMQ queues
- **Observable**: Tracks metrics and telemetry for the Admin Dashboard

## 📁 Structure

```
src/
├── index.ts                    # Entry point and graceful shutdown
├── lib/
│   ├── redis.ts               # Redis client & distributed locking
│   └── prisma.ts              # PostgreSQL database client
├── scheduler/
│   └── cron_manager.ts        # Cron job scheduling with distributed locks
├── queue/
│   ├── queue_consumer.ts      # BullMQ queue consumers (5 queues)
│   └── dead_letter_queue.ts   # DLQ handling for failed jobs
└── jobs/
    ├── vm_hibernation_job.ts   # Idle VM detection & hibernation
    ├── usage_rollup_job.ts     # Usage aggregation to PostgreSQL
    ├── garbage_collector.ts    # Cleanup expired data
    └── telemetry_job.ts        # System metrics collection
```

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Build
npm run build

# Start the worker
npm start

# Development mode (with auto-reload)
npm run dev
```

## 🔧 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `KAFKA_BROKERS` | Kafka bootstrap servers | `localhost:9092` |
| `EXECUTION_SERVICE_URL` | Execution service endpoint | `http://localhost:3005` |

See `.env.example` for full configuration.

## 🕐 Scheduled Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| VM Hibernation | Every 60s | Hibernate VMs idle >10min |
| Usage Rollup | Every 5min | Aggregate Redis usage to PostgreSQL |
| Garbage Collector | Daily 03:00 UTC | Cleanup expired tokens, invitations, orphans |
| Telemetry | Every 15min | Collect system metrics |

## 📦 Queue Consumers

The worker consumes from 5 BullMQ queues:

| Queue | Workers | Priority | Tasks |
|-------|---------|----------|-------|
| `ai` | 2 | HIGH | AI orchestration, code scanning |
| `email` | 10 | HIGH | Transactional emails |
| `cleanup` | 5 | LOW | Resource cleanup |
| `embedding` | 3 | MEDIUM | Vector embedding generation |
| `usage` | 2 | MEDIUM | Usage aggregation |

## 🔒 Distributed Locking

For multi-instance deployments, the worker uses Redis-based distributed locks:

- Each scheduled job acquires a lock before execution
- Only one instance runs a job at any given time
- Locks have TTL to prevent deadlocks on crash

## 🧹 Idempotency

All jobs are designed to be **idempotent**:

- **Usage Rollup**: Reads from Redis → Updates PostgreSQL → Deletes Redis keys (only after DB commit)
- **Garbage Collector**: Idempotent DELETE queries
- **VM Hibernation**: Lock-based prevents duplicate hibernation

## 🚨 Dead Letter Queue (DLQ)

Failed jobs after max retries go to the DLQ:

- Stored in Redis at `dlq:{queue_name}`
- Critical jobs trigger PagerDuty/Slack alerts
- Admin Dashboard can view/retry/dismiss DLQ entries

## 🧪 Testing

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration
```

## 📝 Architecture Rules

1. **No HTTP Endpoints**: Pure worker daemon, no Express/Fastify
2. **Idempotency Mandatory**: Every job must be safely re-runnable
3. **Distributed Locks**: Required for multi-instance deployments
4. **Graceful Shutdown**: Complete active jobs before exit
5. **DLQ for Failures**: Failed jobs go to DLQ after max retries

## 📊 Monitoring

The worker collects telemetry to Redis:

- Queue depths and processing rates
- Job execution times and success rates
- VM status and idle times
- Database connection metrics

Access via Admin Dashboard at `/admin/queues`.

## 🔗 System Integration

The background-worker integrates with:

- **Redis**: Queues, caching, locks, telemetry
- **PostgreSQL**: Usage aggregation, cleanup
- **Kafka**: Event consumption (file.modified, etc.)
- **Execution Service**: VM hibernation commands
- **AI Service**: Generation orchestration

## 📚 Documentation

- [DEVELOPMENT_LOGIC.md](./DEVELOPMENT_LOGIC.md) - Detailed architecture rules
- [../../SYSTEM_BACKBONE_ARCHITECTURE.md](../../SYSTEM_BACKBONE_ARCHITECTURE.md) - System-wide contracts
- [../../KAFKA_EVENT_CONTRACTS.md](../../KAFKA_EVENT_CONTRACTS.md) - Event schemas

---

**⚠️ Production Note**: For high availability, deploy 3+ replicas behind Kubernetes. The distributed locking ensures only one instance runs scheduled jobs at a time.
