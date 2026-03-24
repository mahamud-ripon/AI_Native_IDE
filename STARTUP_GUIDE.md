# 🚀 AI-Native IDE - Complete Startup Guide

**Last Updated:** March 19, 2026  
**Status:** ✅ **READY TO START** - Database initialized, infrastructure running

---

## 🎯 Quick Start (ONE COMMAND!)

### Option 1: Automated Startup Script (Recommended)

**Windows PowerShell:**

```powershell
cd D:\AI-Native-IDE\platform

# This single command starts EVERYTHING!
pnpm start:all
```

**What this does:**
1. ✅ Checks Docker infrastructure
2. ✅ Verifies database is initialized
3. ✅ Starts all 14 backend services
4. ✅ Starts IDE frontend
5. ✅ Starts AI Agents (Python)
6. ✅ Runs health checks
7. ✅ Shows access points

**Then open:** `http://localhost:5173`

---

### Option 2: Manual Startup (2 terminals)

If you prefer more control:

**Terminal 1 - Backend + IDE:**
```bash
cd D:\AI-Native-IDE\platform
pnpm dev
```

**Terminal 2 - AI Agents (Python):**
```bash
cd D:\AI-Native-IDE\platform\ai-agents
python -m uvicorn src.api.main:app --reload --port 9000
```

**Then open:** `http://localhost:5173`

---

## 🧪 Verify Everything is Working

### Test 1: Check Service Health

```bash
# API Gateway
curl http://localhost:8000/health
# Expected: {"status":"ok","service":"api-gateway"}

# AI Service
curl http://localhost:8003/health
# Expected: {"status":"ok","service":"ai-service"}

# Python AI Agents
curl http://localhost:9000/api/v1/workflow/status
# Expected: {"status":"ready","workflows":[]}
```

### Test 2: Check Database Connection

```bash
docker exec ai-native-postgres psql -U ainative -d ainative_ide -c "SELECT COUNT(*) FROM users;"
# Expected: 0 (or more if you created users)
```

### Test 3: Check WebSocket

Open browser console at `http://localhost:5173` and run:

```javascript
const ws = new WebSocket('ws://localhost:8012');
ws.onopen = () => console.log('✅ WebSocket Connected!');
ws.onerror = (e) => console.error('❌ WebSocket Error:', e);
```

---

## 📊 Service Status Dashboard

| Service | Port | Status | Health Check |
|---------|------|--------|--------------|
| API Gateway | 8000 | ⏳ Starting | `/health` |
| Auth Service | 3100 | ⏳ Starting | `/health` |
| Project Service | 8002 | ⏳ Starting | `/health` |
| AI Service (TS) | 8003 | ⏳ Starting | `/health` |
| AI Agents (Python) | 9000 | ⏳ Starting | `/api/v1/workflow/status` |
| Execution Service | 8004 | ⏳ Starting | `/health` |
| Collab Service | 8005 | ⏳ Starting | `/health` |
| WebSocket Gateway | 8012 | ⏳ Starting | N/A |
| Search Service | 8008 | ⏳ Starting | `/health` |
| Deployment Service | 8010 | ⏳ Starting | `/health` |
| Storage Service | 8009 | ⏳ Starting | `/health` |
| Analytics Service | 8011 | ⏳ Starting | `/health` |
| Notification Service | 8007 | ⏳ Starting | `/health` |
| Background Worker | - | ⏳ Starting | N/A |
| IDE Frontend | 5173 | ⏳ Starting | N/A |

**⏳ = Will show "Starting" until you run `pnpm dev`**

---

## 🔍 Troubleshooting

### Issue: Services won't start

**Check if ports are already in use:**
```bash
# Windows PowerShell
netstat -ano | findstr :8000
netstat -ano | findstr :8003
netstat -ano | findstr :5173
```

**Kill process using port:**
```bash
taskkill /PID <PID> /F
```

### Issue: Database connection error

**Verify PostgreSQL is running:**
```bash
docker ps | grep postgres
```

**Restart if needed:**
```bash
docker-compose restart postgres
```

### Issue: AI Agents not responding

**Check Python dependencies:**
```bash
cd platform\ai-agents
pip install -r requirements.txt
```

**Verify port 8000 is free:**
```bash
netstat -ano | findstr :8000
```

### Issue: IDE won't load

**Clear browser cache:**
- Chrome: `Ctrl + Shift + Delete`
- Or open in Incognito mode

**Check console for errors:**
- Press `F12` → Console tab
- Look for red errors

---

## 🎯 First User Flow

Once everything is running:

1. **Open IDE:** `http://localhost:5173`
2. **Create Account:** Click "Sign Up"
3. **Create Project:** Click "New Project"
4. **Edit File:** Click on `src/index.ts` in file tree
5. **Ask AI:** Type "Add a function to calculate fibonacci" in AI chat
6. **Run Code:** Click "Run" button
7. **See Output:** Check terminal panel for results

---

## 📝 What's Working vs What's Pending

### ✅ Working Now

- Database schema (38 tables)
- All services build successfully
- IDE frontend with Monaco editor
- Real-time collaboration (Yjs)
- WebSocket multiplexer
- Terminal integration (xterm.js)
- WebContainer execution
- D3.js AI workflow visualization
- API Gateway routing
- AI Service ↔ AI Agents connection

### ⏳ Needs Testing

- Full end-to-end user flow
- AI code generation
- Real-time collaboration (multiple users)
- File save/load from database
- Git integration
- Deployment to cloud

### 📋 Post-MVP

- E2E tests with Playwright
- Load testing
- Performance optimization
- Marketing site
- Admin dashboard
- Advanced LSP features

---

## 🚀 Ready to Launch!

**All systems are GO for launch!**

```bash
# Terminal 1: Start backend + IDE
cd D:\AI-Native-IDE\platform
pnpm dev

# Terminal 2: Start AI Agents
cd D:\AI-Native-IDE\platform\ai-agents
python -m uvicorn src.api.main:app --reload --port 9000

# Browser: Open IDE
http://localhost:5173
```

**Good luck! 🎉**

---

**Questions or Issues?**
- Check `docs/CONNECTION_GUIDE.md` for detailed setup
- Check `scripts/integration-test.sh` for automated testing
- Check Docker logs: `docker-compose logs -f`
