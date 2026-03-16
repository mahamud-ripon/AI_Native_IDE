# 🔗 Full-Stack Connection Guide

**Purpose:** Ensure frontend, backend, and AI agents are properly connected for end-to-end functionality.

---

## 📊 Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (IDE) - port 5173                                     │
│  - Monaco Editor + Yjs                                          │
│  - API Client → http://localhost:3000                          │
│  - WebSocket → ws://localhost:8012                             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ HTTP/WSS
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  API Gateway - port 3000                                        │
│  - Routes to 14 backend services                                │
│  - Circuit breakers, rate limiting, auth                        │
└────────────────────┬────────────────────────────────────────────┘
                     │
         ┌───────────┼───────────┬───────────┐
         │           │           │           │
         ▼           ▼           ▼           ▼
    ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
    │  Auth  │  │Project │  │   AI   │  │Execution│
    │ :3001  │  │ :3002  │  │ :8003  │  │ :8004   │
    └────────┘  └────────┘  └───┬────┘  └────────┘
                                │
                                │ HTTP
                                ▼
                       ┌────────────────┐
                       │  AI Agents     │
                       │  (Python)      │
                       │  :8000         │
                       └────────────────┘
```

---

## ✅ Connection Status

| Connection | Status | Port | Protocol | Notes |
|------------|--------|------|----------|-------|
| IDE → API Gateway | ✅ | 3000 | HTTP | Configured in `.env` |
| IDE → WS Gateway | ✅ | 8012 | WebSocket | Configured in `.env` |
| Gateway → Auth Service | ✅ | 3001 | HTTP | Proxy route configured |
| Gateway → Project Service | ✅ | 3002 | HTTP | Proxy route configured |
| Gateway → AI Service | ✅ | 8003 | HTTP | **FIXED** (was 8005) |
| Gateway → Execution | ✅ | 8004 | HTTP | Proxy route configured |
| AI Service → AI Agents | ⚠️ | 8000 | HTTP | **URL added, needs implementation** |
| WS Gateway → Services | ⚠️ | - | WebSocket | Needs verification |
| Services → Database | ⚠️ | 5432 | PostgreSQL | **Needs initialization** |

---

## 🔧 Setup Instructions

### Step 1: Start Infrastructure

```bash
cd platform

# Start PostgreSQL, Redis, Kafka, MinIO
pnpm docker:dev

# Wait for services to be healthy (check with docker-compose ps)
docker-compose ps
```

### Step 2: Initialize Database

```bash
# Push Prisma schema to database
pnpm --filter @workspace/database db:push

# OR run migrations
pnpm --filter @workspace/database db:migrate

# Verify tables created
docker-compose exec postgres psql -U ainative -d ainative_ide -c "\dt"
```

### Step 3: Start Backend Services

```bash
# Terminal 1: Start all TypeScript services
cd platform
pnpm dev

# This starts:
# - api-gateway (3000)
# - auth-service (3001)
# - project-service (3002)
# - ai-service (8003)
# - execution-service (8004)
# - ... and 9 more services
```

### Step 4: Start AI Agents (Python)

```bash
# Terminal 2: Start Python AI agents
cd platform/ai-agents

# Install dependencies (first time only)
pip install -r requirements.txt

# Start FastAPI server
python -m uvicorn src.api.main:app --reload --port 8000 --host 0.0.0.0

# Verify running:
curl http://localhost:8000/api/v1/workflow/status
```

### Step 5: Start IDE Frontend

```bash
# Terminal 3: Start IDE
cd platform/apps/ide

# Already running via pnpm dev in root
# But can run standalone:
npm run dev

# Open browser:
# http://localhost:5173
```

---

## 🧪 Verification Tests

### Test 1: API Gateway Routing

```bash
# Test health endpoint
curl http://localhost:3000/health
# Expected: {"status":"ok","service":"api-gateway"}

# Test circuit breaker status
curl http://localhost:3000/gateway/circuit-breakers
# Expected: List of services with states
```

### Test 2: Backend Services

```bash
# Auth Service
curl http://localhost:3001/health
# Expected: {"status":"ok","service":"auth-service"}

# Project Service
curl http://localhost:3002/health
# Expected: {"status":"ok","service":"project-service"}

# AI Service
curl http://localhost:8003/health
# Expected: {"status":"ok","service":"ai-service"}
```

### Test 3: AI Agents Connection

```bash
# Python AI Agents
curl http://localhost:8000/api/v1/workflow/status
# Expected: {"status":"ready","workflows":[]}

# Test AI Service → Agents connection
curl -X POST http://localhost:8003/ai/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Create a hello world app","project_id":"test123"}'
# Expected: Should trigger Python agent and return task ID
```

### Test 4: WebSocket Connection

```bash
# Use websocat or wscat
websocat ws://localhost:8012

# Send subscribe message
{"type":"subscribe","channel":"collab:test123"}

# Expected: Acknowledgment message
```

### Test 5: Full IDE Flow

1. **Open IDE:** `http://localhost:5173`
2. **Create Project:**
   ```javascript
   // Browser console
   fetch('http://localhost:3000/api/v1/projects', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ name: 'Test Project' })
   })
   ```
3. **Edit File:** Open Monaco editor, type code
4. **Check Collaboration:** Open same file in incognito window
5. **Run Code:** Click run button, check terminal output

---

## 🔍 Troubleshooting

### Issue: API Gateway returns 503

**Cause:** Backend service not running or circuit breaker open

**Fix:**
```bash
# Check service status
docker-compose ps

# Check service logs
docker-compose logs ai-service

# Reset circuit breaker
curl http://localhost:3000/gateway/circuit-breakers/reset
```

### Issue: Database connection error

**Cause:** Database not initialized

**Fix:**
```bash
pnpm --filter @workspace/database db:push
```

### Issue: AI Service doesn't trigger agents

**Cause:** AI_AGENTS_URL not configured or agents not running

**Fix:**
```bash
# Check .env
cat platform/services/ai-service/.env | grep AI_AGENTS

# Should show:
# AI_AGENTS_URL=http://localhost:8000
# AI_AGENTS_ENABLED=true

# Restart AI service after changing .env
docker-compose restart ai-service
```

### Issue: WebSocket won't connect

**Cause:** WS Gateway not running or port blocked

**Fix:**
```bash
# Check if port is listening
netstat -an | grep 8012

# Check WS Gateway logs
docker-compose logs websocket-gateway

# Try direct connection (bypass gateway)
websocat ws://localhost:8012
```

---

## 📋 Pre-Launch Checklist

- [ ] Infrastructure running (PostgreSQL, Redis, Kafka, MinIO)
- [ ] Database schema pushed/migrated
- [ ] All 14 backend services running
- [ ] AI Agents (Python) running on port 8000
- [ ] IDE frontend accessible at localhost:5173
- [ ] API Gateway routing verified
- [ ] WebSocket connection working
- [ ] Health checks passing
- [ ] Circuit breakers closed
- [ ] CORS configured correctly

---

## 🎯 Success Criteria

**End-to-end flow is working when:**

1. ✅ Can create project via IDE
2. ✅ Project saved to database
3. ✅ File edits sync via Yjs
4. ✅ AI chat generates code
5. ✅ Generated code appears in editor
6. ✅ Code runs in WebContainer
7. ✅ Terminal shows output
8. ✅ Collaboration works (multiple users)

---

## 📝 Next Steps After Verification

1. **Run Integration Test Script:**
   ```bash
   bash platform/scripts/integration-test.sh
   ```

2. **Create E2E Tests with Playwright:**
   ```bash
   cd platform
   npm init playwright@latest
   ```

3. **Load Testing:**
   ```bash
   npm install -g artillery
   artillery quick --count 10 --num 100 http://localhost:3000/health
   ```

4. **Performance Monitoring:**
   - Set up Datadog APM
   - Configure Prometheus metrics
   - Enable Sentry error tracking

---

**Last Updated:** March 16, 2026  
**Status:** ⚠️ **READY FOR TESTING** - Connections configured, needs verification
