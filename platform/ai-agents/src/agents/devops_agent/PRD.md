# DevOps Agent - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/src/agents/devops-agent/`  
> **Tech Stack:** Python, LangGraph, Pydantic, LangChain  
> **LLM Tier:** Tier 2 (Claude 3.5 Haiku / Gemini Flash) - Config generation

---

## 1. Executive Summary

The DevOps Agent generates deployment configurations including Dockerfiles, Kubernetes manifests, CI/CD pipelines, and other infrastructure-as-code files. It runs in parallel with Backend and Frontend agents.

---

## 2. Agent Configuration

### 2.1 LLM Configuration

```python
from langchain_anthropic import ChatAnthropic
import os

class DevOpsLLM:
    """Tier 2 LLM for config generation"""
    
    def __init__(self):
        self.llm = ChatAnthropic(
            model="claude-3-haiku-20240307",
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
            temperature=0.3,
            max_tokens=4000
        )
```

---

## 3. Input Schema

### 3.1 Architect Output (Received from Architect Agent)

```python
from pydantic import BaseModel
from typing import List, Dict

class ArchitectOutput(BaseModel):
    """Output from Architect Agent - input to DevOps Agent"""
    tech_stack: List[str]
    db_schema: str
    api_design: str
    files_to_create: List[FileSpec]
    architecture_decisions: List[Dict]
```

---

## 4. Output Schema

### 4.1 DevOps Output

```python
from pydantic import BaseModel
from typing import Dict, List, Optional

class DevOpsOutput(BaseModel):
    """Structured output from DevOps Agent"""
    
    # Generated files
    files: Dict[str, str]  # path -> content
    
    # Docker
    dockerfile: Optional[str] = None
    docker_compose: Optional[str] = None
    
    # Kubernetes
    deployment_yaml: Optional[str] = None
    service_yaml: Optional[str] = None
    ingress_yaml: Optional[str] = None
    
    # CI/CD
    github_workflow: Optional[str] = None
    gitlab_ci: Optional[str] = None
    
    # Environment
    env_file: Optional[str] = None
    
    # Scripts
    build_script: Optional[str] = None
    deploy_script: Optional[str] = None
```

---

## 5. Implementation

### 5.1 Agent Code (src/agents/devops-agent/agent.py)

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_anthropic import ChatAnthropic
from ..routing.cost_manager import cost_manager
from ..orchestrator.state_schema import CodeOutput, AgentState

DEVOPS_SYSTEM_PROMPT = """You are a DevOps Engineer Agent. Your role is to generate deployment configurations and infrastructure-as-code files.

## Your Responsibilities:
1. Generate Dockerfile for containerization
2. Create docker-compose.yml for local development
3. Generate Kubernetes manifests for deployment
4. Create CI/CD pipeline configurations
5. Generate environment configuration files
6. Write build and deployment scripts

## Technology Preferences:
- Multi-stage Docker builds for smaller images
- Node.js and Python base images
- GitHub Actions for CI/CD
- Standard Kubernetes manifests
- Environment variables for configuration

## Output Format:
You must output a valid JSON object with files dict (path -> content).
"""

DEVOPS_USER_PROMPT = """## Input from Architect Agent:

**Tech Stack:** {tech_stack}
**Architecture:** {architecture}

## Your Task:
Generate complete DevOps configurations:

1. **Dockerfile:** Multi-stage build for the application
2. **docker-compose.yml:** Local development environment
3. **Kubernetes:** Deployment, Service, Ingress manifests
4. **CI/CD:** GitHub Actions workflow
5. **Environment:** .env.example file
6. **Scripts:** Build and deploy scripts

Consider:
- Node.js backend + React frontend
- PostgreSQL database
- Redis for caching
- Nginx for reverse proxy

Output as JSON: {{"files": {{"path": "content"}}}}.
"""

class DevOpsAgent:
    """DevOps Engineer Agent - generates deployment configs"""
    
    def __init__(self):
        # Use Tier 2 LLM for config generation
        self.llm = cost_manager.get_llm("tier2")
        self.parser = PydanticOutputParser(pydantic_object=CodeOutput)
    
    async def run(self, state: AgentState) -> AgentState:
        """
        Execute the DevOps Agent
        
        Args:
            state: Current agent state containing architect output
            
        Returns:
            Updated state with devops output
        """
        # Validate input
        if not state.architect_output:
            state.errors.append("DevOps Agent: Missing architect output")
            return state
        
        # Build prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", DEVOPS_SYSTEM_PROMPT),
            ("user", DEVOPS_USER_PROMPT)
        ])
        
        # Create chain
        chain = prompt | self.llm.with_structured_output(CodeOutput)
        
        # Execute
        try:
            result = await chain.ainvoke({
                "tech_stack": ", ".join(state.architect_output.tech_stack),
                "architecture": state.architect_output.db_schema
            })
            
            state.devops_output = result
            
        except Exception as e:
            state.errors.append(f"DevOps Agent error: {str(e)}")
        
        return state
```

---

## 6. Configuration Templates

### 6.1 Dockerfile Template

```dockerfile
# Multi-stage build for Node.js application

# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built artifacts
COPY --from=builder /app/.next ./nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

USER nextjs

EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
```

### 6.2 Docker Compose Template

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/app
      - REDIS_URL=redis://cache:6379
    depends_on:
      - db
      - cache

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=app
    volumes:
      - postgres_data:/var/lib/postgresql/data

  cache:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 6.3 Kubernetes Deployment Template

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{app_name}}
  labels:
    app: {{app_name}}
spec:
  replicas: 3
  selector:
    matchLabels:
      app: {{app_name}}
  template:
    metadata:
      labels:
        app: {{app_name}}
    spec:
      containers:
      - name: app
        image: {{image}}
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: database-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: {{app_name}}
spec:
  selector:
    app: {{app_name}}
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
```

### 6.4 GitHub Actions Workflow Template

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run tests
        run: npm test
        
      - name: Build
        run: npm run build
        
      - name: Build Docker image
        run: docker build -t app:${{ github.sha }} .
        
      - name: Push to registry
        run: |
          docker push registry.io/app:${{ github.sha }}
          
      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/app app=registry.io/app:${{ github.sha }}
```

---

## 7. Cost Optimization

### 7.1 Token Usage Tracking

```python
class DevOpsCostTracker:
    """Track costs for devops agent"""
    
    # Tier 2 pricing (Claude 3.5 Haiku)
    INPUT_COST_PER_1M = 0.25
    OUTPUT_COST_PER_1M = 1.25
    
    def estimate(self, input_text: str, output_text: str) -> float:
        input_tokens = len(input_text) * 0.75
        output_tokens = len(output_text) * 0.75
        
        return (
            (input_tokens / 1_000_000) * self.INPUT_COST_PER_1M +
            (output_tokens / 1_000_000) * self.OUTPUT_COST_PER_1M
        )
```

---

## 8. Integration

### 8.1 Graph Integration

```python
# In graph_builder.py
from ..agents.devops_agent import DevOpsAgent

workflow.add_node("devops", DevOpsAgent().run)
workflow.add_edge("architect", "devops")
```

### 8.2 Parallel Execution

```
Architect Output:
{
  "tech_stack": ["nextjs", "postgresql", "redis"],
  ...
}
        ↓
┌─────────────────────────────────────┐
│  Backend    │  Frontend   │ DevOps  │
│  (Tier 2)   │  (Tier 2)   │ (Tier 2)│
│  Parallel   │  Parallel   │ Parallel│
└─────────────────────────────────────┘
        ↓
All converge to QA Agent
```

---

## 9. Testing

### 9.1 Unit Tests

```python
import pytest
from src.agents.devops_agent import DevOpsAgent
from src.orchestrator.state_schema import AgentState, ArchitectOutput

@pytest.fixture
def sample_state():
    return AgentState(
        user_prompt="Build a blog",
        project_id="123",
        architect_output=ArchitectOutput(
            tech_stack=["nextjs", "postgresql", "redis"],
            db_schema="User, Post",
            api_design="REST",
            files_to_create=[],
            architecture_decisions=[]
        )
    )

@pytest.mark.asyncio
async def test_devops_agent_returns_output(sample_state):
    agent = DevOpsAgent()
    result = await agent.run(sample_state)
    
    assert result.devops_output is not None
    assert len(result.devops_output.files) > 0
```

---

## 10. Implementation Status

| Component | Status |
|-----------|--------|
| LLM Configuration | ✅ Complete |
| Input Schema | ✅ Complete |
| Output Schema | ✅ Complete |
| Agent Implementation | ✅ Complete |
| Config Templates | ✅ Complete |
| Cost Tracking | ✅ Complete |
| Graph Integration | ✅ Complete |

---

## 11. Key Implementation Notes

### 11.1 LLM Selection
- **Tier 2**: Config generation (fast/cheap)
- Use Claude 3.5 Haiku or Gemini Flash

### 11.2 Generated Files
- Dockerfile (multi-stage)
- docker-compose.yml
- Kubernetes manifests
- GitHub Actions workflow
- .env.example
- Build/deploy scripts

### 11.3 Parallel Execution
- Runs with Backend + Frontend agents
- All receive Architect output simultaneously
- Results converge at QA phase

### 11.4 Cost Control
- Cheaper than Tier 1 agents
- Track usage for billing
