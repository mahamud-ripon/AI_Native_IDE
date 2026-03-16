# Backend Agent - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/src/agents/backend-agent/`  
> **Tech Stack:** Python, LangGraph, Pydantic, LangChain  
> **LLM Tier:** Tier 2 (Claude 3.5 Haiku / Gemini Flash) - Bulk code generation

---

## 1. Executive Summary

The Backend Agent is responsible for generating API routes, database schemas, and business logic based on the system architecture designed by the Architect Agent. It operates in parallel with the Frontend and DevOps agents.

---

## 2. Agent Configuration

### 2.1 LLM Configuration

```python
from langchain_anthropic import ChatAnthropic
import os

class BackendLLM:
    """Tier 2 LLM for bulk code generation"""
    
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
from typing import List, Dict, Optional

class ArchitectOutput(BaseModel):
    """Output from Architect Agent - input to Backend Agent"""
    tech_stack: List[str]
    db_schema: str
    api_design: str
    files_to_create: List[FileSpec]
    architecture_decisions: List[Dict]
```

---

## 4. Output Schema

### 4.1 Backend Output

```python
from pydantic import BaseModel
from typing import Dict, List, Optional

class BackendOutput(BaseModel):
    """Structured output from Backend Agent"""
    
    # Generated files
    files: Dict[str, str]  # path -> content
    
    # Dependencies
    dependencies: List[str]
    dev_dependencies: List[str]
    
    # Database
    prisma_schema: Optional[str] = None
    migrations: List[str] = []
    
    # API Documentation
    openapi_spec: Optional[str] = None
    
    # Setup instructions
    setup_instructions: Optional[str] = None
    
    # Environment variables
    env_vars: List[EnvVar] = []

class EnvVar(BaseModel):
    name: str
    description: str
    required: bool = True
    default: Optional[str] = None
```

---

## 5. Implementation

### 5.1 Agent Code (src/agents/backend-agent/agent.py)

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_anthropic import ChatAnthropic
from ..routing.cost_manager import cost_manager
from ..orchestrator.state_schema import CodeOutput, AgentState

BACKEND_SYSTEM_PROMPT = """You are a Backend Developer Agent. Your role is to generate high-quality, production-ready backend code.

## Your Responsibilities:
1. Generate API routes (REST/GraphQL)
2. Create database schemas (Prisma/SQLAlchemy)
3. Implement business logic
4. Add authentication/authorization
5. Write validation logic

## Technology Preferences:
- Use TypeScript/Node.js with Express or FastAPI
- Use Prisma ORM for database operations
- Use Zod for input validation
- Follow RESTful conventions
- Implement proper error handling

## Output Format:
You must output a valid JSON object with files dict (path -> content).
"""

BACKEND_USER_PROMPT = """## Input from Architect Agent:

**Tech Stack:** {tech_stack}
**Database Schema:** {db_schema}
**API Design:** {api_design}
**Files to Create:** {files_to_create}

## Your Task:
Generate complete backend code including:

1. **API Routes:**
   - CRUD operations for each entity
   - Proper HTTP methods (GET, POST, PUT, DELETE)
   - Request validation with Zod
   - Error handling

2. **Database Schema:**
   - Prisma schema with all models
   - Relations between models
   - Indexes for performance

3. **Business Logic:**
   - Service layer functions
   - Utility functions
   - Type definitions

4. **Configuration:**
   - Environment variable templates
   - TypeScript config
   - Package.json scripts

Output as JSON: {{"files": {{"path": "content"}}}}.
"""

class BackendAgent:
    """Backend Developer Agent - generates API and database code"""
    
    def __init__(self):
        # Use Tier 2 LLM for bulk code generation
        self.llm = cost_manager.get_llm("tier2")
        self.parser = PydanticOutputParser(pydantic_object=CodeOutput)
    
    async def run(self, state: AgentState) -> AgentState:
        """
        Execute the Backend Agent
        
        Args:
            state: Current agent state containing architect output
            
        Returns:
            Updated state with backend output
        """
        # Validate input
        if not state.architect_output:
            state.errors.append("Backend Agent: Missing architect output")
            return state
        
        # Build prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", BACKEND_SYSTEM_PROMPT),
            ("user", BACKEND_USER_PROMPT)
        ])
        
        # Create chain
        chain = prompt | self.llm.with_structured_output(CodeOutput)
        
        # Execute
        try:
            result = await chain.ainvoke({
                "tech_stack": ", ".join(state.architect_output.tech_stack),
                "db_schema": state.architect_output.db_schema,
                "api_design": state.architect_output.api_design,
                "files_to_create": ", ".join([f.path for f in state.architect_output.files_to_create])
            })
            
            state.backend_output = result
            
        except Exception as e:
            state.errors.append(f"Backend Agent error: {str(e)}")
        
        return state
```

---

## 6. Code Generation Patterns

### 6.1 Express API Route Pattern

```python
API_ROUTE_TEMPLATE = '''import express from 'express';
import {{ {{model_name}} }} from '../models/{{model_name}}.model';
import {{ create{{model_name}}Schema, update{{model_name}}Schema }} from '../validations/{{model_name}}.validation';
import validate from '../middleware/validate';

const router = express.Router();

// Get all {{model_name}}s
router.get('/', async (req, res) => {{
  try {{
    const {{model_name | lowercase}}s = await {{model_name}}.find();
    res.json({{model_name | lowercase}}s);
  }} catch (error) {{
    res.status(500).json({{ message: 'Server error' }});
  }}
}});

// Get single {{model_name}}
router.get('/:id', async (req, res) => {{
  try {{
    const {{model_name | lowercase}} = await {{model_name}}.findById(req.params.id);
    if (!{{model_name | lowercase}}) {{
      return res.status(404).json({{ message: '{{model_name}} not found' }});
    }}
    res.json({{model_name | lowercase}});
  }} catch (error) {{
    res.status(500).json({{ message: 'Server error' }});
  }}
}});

// Create {{model_name}}
router.post('/', validate(create{{model_name}}Schema), async (req, res) => {{
  try {{
    const {{model_name | lowercase}} = new {{model_name}}(req.body);
    await {{model_name | lowercase}}.save();
    res.status(201).json({{model_name | lowercase}});
  }} catch (error) {{
    res.status(400).json({{ message: error.message }});
  }}
}});

// Update {{model_name}}
router.put('/:id', validate(update{{model_name}}Schema), async (req, res) => {{
  try {{
    const {{model_name | lowercase}} = await {{model_name}}.findByIdAndUpdate(
      req.params.id,
      req.body,
      {{ new: true }}
    );
    if (!{{model_name | lowercase}}) {{
      return res.status(404).json({{ message: '{{model_name}} not found' }});
    }}
    res.json({{model_name | lowercase}});
  }} catch (error) {{
    res.status(400).json({{ message: error.message }});
  }}
}});

// Delete {{model_name}}
router.delete('/:id', async (req, res) => {{
  try {{
    const {{model_name | lowercase}} = await {{model_name}}.findByIdAndDelete(req.params.id);
    if (!{{model_name | lowercase}}) {{
      return res.status(404).json({{ message: '{{model_name}} not found' }});
    }}
    res.json({{ message: '{{model_name}} deleted' }});
  }} catch (error) {{
    res.status(500).json({{ message: 'Server error' }});
  }}
}});

export default router;
'''
```

### 6.2 Prisma Schema Pattern

```python
PRISMA_SCHEMA_TEMPLATE = '''generator client {{
  provider = "prisma-client-js"
}}

datasource db {{
  provider = "postgresql"
  url      = env("DATABASE_URL")
}}

model {{model_name}} {{
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  {{#fields}}
  {{name}} {{type}}{{#if required}}@default({{default}}){{/if}}
  {{/fields}}
  
  {{#relations}}
  {{relationName}} {{relationModel}}? @relation(fields: [{{localField}}], references: [{{foreignField}}])
  {{/relations}}
}}
'''
```

### 6.3 Validation Schema Pattern

```python
ZOD_VALIDATION_TEMPLATE = '''import z from 'zod';

export const create{{model_name}}Schema = z.object({{#fields}}
  {{name}}: z.{{type}}(){{#unless required}}.optional(){{/unless}}{{#if default}}.default({{default}}){{/if}},{{/fields}}
});

export const update{{model_name}}Schema = create{{model_name}}Schema.partial();

export type Create{{model_name}}Input = z.infer<typeof create{{model_name}}Schema>;
export type Update{{model_name}}Input = z.infer<typeof update{{model_name}}Schema>;
'''
```

---

## 7. Cost Optimization

### 7.1 Token Usage Tracking

```python
class BackendCostTracker:
    """Track costs for backend agent"""
    
    # Tier 2 pricing (Claude 3.5 Haiku)
    INPUT_COST_PER_1M = 0.25   # $0.25 per 1M input tokens
    OUTPUT_COST_PER_1M = 1.25  # $1.25 per 1M output tokens
    
    def estimate(self, input_text: str, output_text: str) -> float:
        input_tokens = len(input_text) * 0.75
        output_tokens = len(output_text) * 0.75
        
        return (
            (input_tokens / 1_000_000) * self.INPUT_COST_PER_1M +
            (output_tokens / 1_000_000) * self.OUTPUT_COST_PER_1M
        )
```

---

## 8. Error Handling

### 8.1 Retry Logic

```python
import asyncio

class BackendAgentRetry:
    """Retry logic for backend agent"""
    
    MAX_RETRIES = 3
    RETRY_DELAY = 2
    
    async def run_with_retry(self, state: AgentState) -> AgentState:
        last_error = None
        
        for attempt in range(self.MAX_RETRIES):
            try:
                agent = BackendAgent()
                return await agent.run(state)
            except Exception as e:
                last_error = e
                if attempt < self.MAX_RETRIES - 1:
                    await asyncio.sleep(self.RETRY_DELAY * (attempt + 1))
        
        state.errors.append(f"Backend Agent failed after {self.MAX_RETRIES} attempts: {last_error}")
        return state
```

---

## 9. Integration

### 9.1 Graph Integration

```python
# In graph_builder.py
from ..agents.backend_agent import BackendAgent

workflow.add_node("backend", BackendAgent().run)
workflow.add_edge("architect", "backend")
```

### 9.2 State Flow

```
Architect Output:
{
  "tech_stack": ["nextjs", "postgresql", "prisma"],
  "db_schema": "...",
  "api_design": "...",
  "files_to_create": [...],
  ...
}
        ↓
Backend Agent:
- Uses Tier 2 LLM
- Generates API routes
- Creates Prisma schema
- Writes business logic
        ↓
Backend Output:
{
  "files": {
    "src/routes/users.ts": "...",
    "prisma/schema.prisma": "...",
    ...
  },
  "dependencies": ["express", "prisma", "zod"],
  ...
}
```

---

## 10. Testing

### 10.1 Unit Tests

```python
import pytest
from src.agents.backend_agent import BackendAgent
from src.orchestrator.state_schema import AgentState, ArchitectOutput

@pytest.fixture
def sample_state():
    return AgentState(
        user_prompt="Build a blog",
        project_id="123",
        architect_output=ArchitectOutput(
            tech_stack=["nextjs", "postgresql", "prisma"],
            db_schema="User, Post, Comment models",
            api_design="RESTful endpoints",
            files_to_create=[],
            architecture_decisions=[]
        )
    )

@pytest.mark.asyncio
async def test_backend_agent_returns_output(sample_state):
    agent = BackendAgent()
    result = await agent.run(sample_state)
    
    assert result.backend_output is not None
    assert len(result.backend_output.files) > 0
```

---

## 11. Implementation Status

| Component | Status |
|-----------|--------|
| LLM Configuration | ✅ Complete |
| Input Schema | ✅ Complete |
| Output Schema | ✅ Complete |
| Agent Implementation | ✅ Complete |
| Code Templates | ✅ Complete |
| Cost Tracking | ✅ Complete |
| Error Handling | ✅ Complete |
| Graph Integration | ✅ Complete |
| Unit Tests | ✅ Complete |

---

## 12. Key Implementation Notes

### 12.1 LLM Selection
- **Tier 2**: Bulk code generation (fast/cheap)
- Use Claude 3.5 Haiku or Gemini Flash
- Temperature: 0.3 for consistent output

### 12.2 Code Generation
- Generate complete Express/FastAPI routes
- Create Prisma schemas with relations
- Add Zod validation schemas
- Include error handling

### 12.3 Parallel Execution
- Backend runs in parallel with Frontend and DevOps
- All three agents receive Architect output simultaneously
- Results converge at QA phase

### 12.4 Cost Control
- Much cheaper than Tier 1 agents
- Track usage for billing
- Optimize prompts for shorter output
