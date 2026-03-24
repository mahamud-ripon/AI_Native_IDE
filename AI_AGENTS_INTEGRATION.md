# AI-Native IDE - Python AI Agents Integration

## 📊 **Integration Summary**

### **Problem Identified:**
1. **AI Agents (Python)** ছিল কিন্তু **চলছিল না** (Not running in Docker)
2. **AI Service (Node.js)** workflow execute করছিল কিন্তু **Python Agents এর সাথে connection ছিল না**
3. **Port Conflict**: AI Agents port 8000 ব্যবহার করছিল যেটা API Gateway এর সাথে conflict

---

## ✅ **Fixes Applied:**

### **1. Fixed AI Agents Port**
- **Before:** `PORT=8000` (conflict with API Gateway)
- **After:** `PORT=9000` (dedicated port)
- **File:** `platform/ai-agents/.env`

### **2. Added AI Agents to Docker Compose**
```yaml
ai-agents:
  build:
    context: ./ai-agents
    dockerfile: Dockerfile.dev
  container_name: ai-native-python-agents
  ports:
    - "9000:9000"
  environment:
    PORT: 9000
    GROQ_API_KEY: ${GROQ_API_KEY}
    ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
  depends_on:
    - redis
    - kafka
```
- **File:** `platform/docker-compose.dev.yml`

### **3. Created Dockerfile for AI Agents**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y build-essential curl git
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ ./src/
EXPOSE 9000
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "9000", "--reload"]
```
- **File:** `platform/ai-agents/Dockerfile.dev`

### **4. Created Python Agents Client in AI Service**
```typescript
// platform/services/ai-service/src/python_agents/client.ts
export async function callPythonAgent(request: PythonAgentRequest)
export async function* callPythonAgentStream(request: PythonAgentRequest)
export async function checkPythonAgentsHealth()
```

### **5. Updated Environment Configuration**
```bash
# platform/.env
PYTHON_AGENTS_URL=http://ai-native-python-agents:9000
AI_AGENTS_API_KEY=internal-api-key
```

---

## 🏗️ **New Architecture:**

```
┌─────────────────────────────────────────────────────┐
│ Browser (IDE) - http://localhost:5173 │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│  API Gateway (Port 8000)                             │
│  Routes: /api/v1/*, /workflows/*                     │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│ AI Service (Port 8003) - Node.js │
│  - Workflow orchestration                            │
│  - Step execution                                    │
│  - WebSocket real-time updates                       │
│  - Python Agents client                              │
└────────────┬────────────────────────────────────────┘
             │ HTTP
             ▼
┌─────────────────────────────────────────────────────┐
│  AI Agents Service (Port 9000) - Python LangGraph    │
│  - PM Agent (Product Manager)                        │
│  - Architect Agent (System Design)                   │
│  - Backend Agent (API Development)                   │
│  - Frontend Agent (UI Development)                   │
│  - DevOps Agent (Deployment)                         │
│  - QA Agent (Testing)                                │
│  - Security Agent (Code Review)                      │
│                                                      │
│  Endpoints:                                          │
│  - POST /api/v1/workflow                             │
│  - POST /api/v1/workflow/stream (SSE)                │
│  - GET  /health                                      │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 **How to Run:**

### **Start All Services:**
```bash
cd platform
pnpm docker:dev       # Start infrastructure
pnpm dev              # Start all services including AI Agents
```

### **Start AI Agents Only:**
```bash
docker-compose -f docker-compose.dev.yml up -d ai-agents
```

### **Check Status:**
```bash
docker ps --filter name="ai-native"
curl http://localhost:9000/health
```

---

## 📝 **Next Steps:**

### **1. Integrate Python Client in Step Executor**
Update `platform/services/ai-service/src/workflows/engine/step_executor.ts`:
```typescript
import { callPythonAgent } from '../../python_agents/client.js';

// In executeStep function:
const pythonResult = await callPythonAgent({
  user_prompt: state.context.variables.userPrompt as string,
  project_id: state.context.projectId,
  stream: false,
});
```

### **2. Add Debug Logging**
Add comprehensive logging to track workflow execution:
```typescript
console.log('[StepExecutor] Calling Python AI Agent for step:', stepDef.stepName);
console.log('[StepExecutor] Python Agent Response:', pythonResult);
```

### **3. Enable Mock AI Mode (Fallback)**
Add environment variable to switch between Python Agents and mock mode:
```bash
# platform/.env
USE_PYTHON_AGENTS=true  # Set to false for mock mode
```

---

## 🐛 **Troubleshooting:**

### **AI Agents Not Starting:**
```bash
docker logs ai-native-python-agents
docker-compose -f docker-compose.dev.yml up -d --build ai-agents
```

### **Port Already in Use:**
```bash
netstat -ano | findstr 9000
taskkill /F /PID <PID>
```

### **Connection Refused:**
Check network connectivity:
```bash
docker exec ai-native-ai-service curl http://ai-native-python-agents:9000/health
```

---

## 📋 **Service Status:**

| Service | Port | Status |
|---------|------|--------|
| IDE | 5173 | ✅ Running |
| API Gateway | 8000 | ✅ Running |
| AI Service (Node.js) | 8003 | ✅ Running |
| **AI Agents (Python)** | **9000** | ⏳ Building |
| PostgreSQL | 5432 | ✅ Running |
| Redis | 6379 | ✅ Running |
| Kafka | 9092 | ✅ Running |

---

## 🎯 **Expected Workflow:**

1. User types: "build a todolist app"
2. IDE → API Gateway → AI Service
3. AI Service → Python AI Agents (`POST /api/v1/workflow`)
4. Python Agents execute LangGraph workflow:
   - PM Agent → Requirements
   - Architect Agent → Design
   - Backend Agent → API code
   - Frontend Agent → UI code
   - DevOps Agent → Deploy config
   - QA Agent → Tests
   - Security Agent → Review
5. Results streamed back via SSE/WebSocket
6. IDE displays progress and generated code

---

**Last Updated:** March 19, 2026  
**Status:** ✅ Integration Complete - Ready for Testing

---

## ✅ **Integration Complete!**

### **What's Been Done:**

1. ✅ **Step Executor Integration** - Python AI Agents called first, LLM Gateway as fallback
2. ✅ **API Gateway Routes** - `/api/v1/agents/*` routes to Python AI Agents
3. ✅ **Environment Config** - All services configured with correct URLs
4. ✅ **Debug Logging** - Comprehensive logging added to track execution flow
5. ✅ **Health Checks** - Automatic fallback if Python Agents unavailable

### **How It Works:**

```
User Prompt → IDE → API Gateway → AI Service (Node.js)
                                              ↓
                              Check Python Agents Health
                                              ↓
                              ┌───────────────┴───────────────┐
                              │                               │
                         Healthy?                         Unhealthy?
                              ↓                               ↓
                    Call Python AI Agents            Fallback to LLM Gateway
                    (LangGraph Multi-Agent)          (Direct LLM calls)
                              ↓                               ↓
                    Stream Results via SSE            Return LLM response
                              ↓                               ↓
                    Update Database & Emit          Update Database & Emit
                    Workflow Events                 Workflow Events
```

### **Test Now:**

1. **Refresh Browser:** http://localhost:5173 (Ctrl+Shift+R)
2. **Type:** "build a todolist app"
3. **Watch Console:** Look for `[StepExecutor] Calling Python AI Agents`
4. **Monitor Logs:**
   ```bash
   docker logs -f ai-native-ai-service
   docker logs -f ai-native-python-agents
   ```

### **Environment Variables:**

```bash
# Enable/Disable Python AI Agents
USE_PYTHON_AGENTS=true   # Default: true

# Fallback automatically enabled if Python Agents unavailable
```
