# 🚀 AI-Native IDE - Simple Startup Guide

## ⚡ EASIEST WAY - One Command!

```powershell
cd D:\AI-Native-IDE\platform

# Start ALL backend services + IDE
pnpm dev
```

**That's it!** This single command starts:
- ✅ 14 Backend Services (TypeScript)
- ✅ IDE Frontend (React + Vite)
- ✅ All with proper concurrency (no errors!)

**Then open:** `http://localhost:5173`

---

## 🎯 Complete Setup (First Time Only)

If this is your first time running:

### Step 1: Start Docker Infrastructure
```powershell
cd D:\AI-Native-IDE\platform
pnpm docker:dev
```

Wait 30 seconds for containers to start.

### Step 2: Initialize Database
```powershell
pnpm db:push
```

### Step 3: Start All Services
```powershell
pnpm dev
```

**Done!** Open `http://localhost:5173`

---

## 📝 Optional: Start AI Agents (Python)

If you want AI code generation features:

**Open a SECOND terminal:**

```powershell
cd D:\AI-Native-IDE\platform\ai-agents
python -m uvicorn src.api.main:app --reload --port 9000
```

**Or use the shortcut:**
```powershell
pnpm start:ai-agents
```

---

## 🛑 Stop Everything

```powershell
# Stop Docker
docker-compose down

# Or close the terminal windows
```

---

## 📊 Quick Reference

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Start all backend + IDE |
| `pnpm docker:dev` | Start PostgreSQL, Redis, Kafka |
| `pnpm db:push` | Initialize database |
| `pnpm start:ai-agents` | Start Python AI agents |

---

## ✅ Success Indicators

You'll know it's working when you see:
```
✅ api-gateway ready on http://localhost:8000
✅ ai-service ready on http://localhost:8003
✅ project-service ready on http://localhost:8002
... (and more services)
```

Then open: **`http://localhost:5173`**

---

**That's it! Just `pnpm dev` and you're ready to code! 🎉**
