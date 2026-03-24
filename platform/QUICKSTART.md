# 🚀 AI-Native IDE - Quick Start Commands

**TL;DR:** One command to start everything!

---

## ⚡ Super Quick Start

```powershell
# Navigate to platform
cd D:\AI-Native-IDE\platform

# Start EVERYTHING with one command!
pnpm start:all
```

**Then open:** `http://localhost:5173`

---

## 📋 All Available Commands

### Start Services

| Command | Description |
|---------|-------------|
| `pnpm start:all` | **🌟 Start everything automatically** (recommended) |
| `pnpm dev` | Start all backend services + IDE (manual mode) |
| `pnpm dev:all` | Same as `pnpm dev` |
| `pnpm start` | Same as `pnpm dev` |

### Docker Infrastructure

| Command | Description |
|---------|-------------|
| `pnpm docker:dev` | Start PostgreSQL, Redis, Kafka, MinIO |
| `pnpm docker:down` | Stop all Docker containers |
| `pnpm docker:db-init` | Initialize database schema |

### Build & Test

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all services and apps |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run ESLint |

### Database

| Command | Description |
|---------|-------------|
| `pnpm db:push` | Push Prisma schema to database |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:generate` | Generate Prisma client |

---

## 🎯 Typical Workflow

### First Time Setup

```powershell
# 1. Start Docker infrastructure
pnpm docker:dev

# 2. Wait for containers to be healthy (30 seconds)
docker-compose ps

# 3. Initialize database
pnpm db:push

# 4. Start all services
pnpm start:all
```

### Daily Development

```powershell
# Just one command!
pnpm start:all
```

### Stop Everything

```powershell
# Close terminal windows OR
docker-compose down
```

---

## 🔍 Troubleshooting

### "Turbo concurrency error"

**Fixed!** The `turbo.json` has been updated with `--concurrency=20`

### "Database not found"

```powershell
pnpm db:push
```

### "Docker not running"

Start Docker Desktop, then:

```powershell
docker-compose ps
```

### "Port already in use"

```powershell
# Find process using port
netstat -ano | findstr :8000

# Kill process
taskkill /PID <PID> /F
```

---

## 📊 Service Ports

| Service | Port | URL |
|---------|------|-----|
| IDE Frontend | 5173 | http://localhost:5173 |
| API Gateway | 8000 | http://localhost:8000 |
| AI Service | 8003 | http://localhost:8003 |
| AI Agents (Python) | 9000 | http://localhost:9000 |
| WebSocket | 8012 | ws://localhost:8012 |

---

## 🎉 Success Indicators

You'll know everything is working when you see:

```
✅ API Gateway
✅ AI Service  
✅ AI Agents
╔══════════════════════════════════════════════════════════╗
║           🎉 All Services Started Successfully!          ║
╚══════════════════════════════════════════════════════════╝
```

---

**That's it! Just run `pnpm start:all` and code! 🚀**
