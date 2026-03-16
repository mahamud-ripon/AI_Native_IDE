# Architect Agent - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/src/agents/architect-agent/`  
> **Tech Stack:** Python, LangGraph, Pydantic, LangChain  
> **LLM Tier:** Tier 1 (Claude 3.5 Sonnet / GPT-4o) - Complex reasoning

---

## 1. Executive Summary

The Architect Agent is the second phase of the AI orchestration pipeline. It receives structured input from the PM Agent and outputs a complete system design including tech stack, database schema, API design, and file structure.

---

## 2. Agent Configuration

### 2.1 LLM Configuration

```python
from langchain_anthropic import ChatAnthropic
import os

class ArchitectLLM:
    """Tier 1 LLM for complex reasoning"""
    
    def __init__(self):
        self.llm = ChatAnthropic(
            model="claude-3-5-sonnet-20241022",
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
            temperature=0.2,  # Low temperature for deterministic output
            max_tokens=8000
        )
```

---

## 3. Input Schema

### 3.1 PM Output (Received from PM Agent)

```python
from pydantic import BaseModel
from typing import List, Optional

class PMOutput(BaseModel):
    """Output from PM Agent - input to Architect Agent"""
    project_name: str
    description: str
    requirements: List[str]
    target_users: str
    success_metrics: List[str]
```

---

## 4. Output Schema

### 4.1 Architect Output

```python
from pydantic import BaseModel
from typing import List, Dict, Optional

class ArchitectOutput(BaseModel):
    """Structured output from Architect Agent"""
    
    # Technology decisions
    tech_stack: List[str]  # e.g., ["nextjs", "postgresql", "prisma", "tailwind"]
    
    # Database design
    db_schema: str  # Prisma schema or SQL DDL
    tables: List[TableDefinition]
    
    # API design
    api_design: str  # OpenAPI spec or REST endpoints
    endpoints: List[EndpointDefinition]
    
    # File structure
    files_to_create: List[FileSpec]
    
    # Architecture decisions
    architecture_decisions: List[ADR]  # Architecture Decision Records
    
    # Optional diagram
    architecture_diagram: Optional[str] = None  # Mermaid or PlantUML

class TableDefinition(BaseModel):
    name: str
    columns: List[ColumnDefinition]
    relations: List[str]

class ColumnDefinition(BaseModel):
    name: str
    type: str
    nullable: bool
    primary_key: bool = False
    foreign_key: Optional[str] = None

class EndpointDefinition(BaseModel):
    method: str  # GET, POST, PUT, DELETE
    path: str
    description: str
    request_body: Optional[str] = None
    response: Optional[str] = None

class FileSpec(BaseModel):
    path: str
    description: str
    priority: str  # critical, high, medium, low

class ADR(BaseModel):
    id: str
    title: str
    decision: str
    rationale: str
    status: str  # proposed, accepted, deprecated
```

---

## 5. Implementation

### 5.1 Agent Code (src/agents/architect-agent/agent.py)

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_anthropic import ChatAnthropic
from ..routing.cost_manager import cost_manager
from ..orchestrator.state_schema import ArchitectOutput, AgentState
import os

ARCHITECT_SYSTEM_PROMPT = """You are a System Architect Agent. Your role is to design robust, scalable systems based on product requirements.

## Your Responsibilities:
1. Select appropriate technology stack
2. Design database schema
3. Define API endpoints
4. Plan file structure
5. Document architecture decisions (ADRs)

## Constraints:
- Prefer proven, battle-tested technologies
- Minimize infrastructure complexity
- Design for horizontal scaling
- Ensure security best practices
- Optimize for developer productivity

## Output Format:
You must output a valid JSON object matching the provided schema.
"""

ARCHITECT_USER_PROMPT = """## Input from PM Agent:

**Project Name:** {project_name}
**Description:** {description}
**Requirements:**
{requirements}

**Target Users:** {target_users}
**Success Metrics:** {success_metrics}

## Your Task:
Design a complete system architecture for this project. Consider:

1. **Tech Stack Selection:**
   - Frontend framework (Next.js, React, Vue)
   - Backend runtime (Node.js, Python, Go)
   - Database (PostgreSQL, MongoDB, SQLite)
   - ORM (Prisma, Drizzle, SQLAlchemy)
   - Styling (Tailwind, CSS Modules)
   - Authentication (NextAuth, Clerk, custom)

2. **Database Schema:**
   - Design all tables with relationships
   - Define columns, types, constraints
   - Plan indexes for performance

3. **API Design:**
   - RESTful endpoints
   - Request/response schemas
   - Error handling strategy

4. **File Structure:**
   - List all files to create
   - Prioritize by importance

5. **Architecture Decisions:**
   - Document key decisions with rationale

{format_instructions}
"""

class ArchitectAgent:
    """System Architect Agent - designs complete system architecture"""
    
    def __init__(self):
        # Use Tier 1 LLM for complex reasoning
        self.llm = cost_manager.get_llm("tier1")
        self.parser = PydanticOutputParser(pydantic_object=ArchitectOutput)
    
    async def run(self, state: AgentState) -> AgentState:
        """
        Execute the Architect Agent
        
        Args:
            state: Current agent state containing PM output
            
        Returns:
            Updated state with architect output
        """
        # Validate input
        if not state.pm_output:
            state.errors.append("Architect Agent: Missing PM output")
            return state
        
        # Build prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", ARCHITECT_SYSTEM_PROMPT),
            ("user", ARCHITECT_USER_PROMPT)
        ])
        
        # Create chain
        chain = prompt | self.llm.with_structured_output(ArchitectOutput)
        
        # Execute
        try:
            result = await chain.ainvoke({
                "project_name": state.pm_output.project_name,
                "description": state.pm_output.description,
                "requirements": "\n".join(f"- {r}" for r in state.pm_output.requirements),
                "target_users": state.pm_output.target_users,
                "success_metrics": "\n".join(f"- {m}" for m in state.pm_output.success_metrics),
                "format_instructions": self.parser.get_format_instructions()
            })
            
            state.architect_output = result
            
        except Exception as e:
            state.errors.append(f"Architect Agent error: {str(e)}")
        
        return state
```

---

## 6. Prompt Engineering

### 6.1 System Prompt Strategy

```python
ARCHITECT_SYSTEM_PROMPT = """You are a Principal Architect at a top-tier tech company.

## Expertise:
- Microservices and monolith architectures
- Database design (SQL and NoSQL)
- API design (REST, GraphQL, gRPC)
- Cloud infrastructure (AWS, GCP, Azure)
- Security best practices
- Performance optimization

## Design Principles:
1. **Simplicity First**: Don't over-engineer
2. **YAGNI**: Only add what you need now
3. **Fail Fast**: Design for errors
4. **Security by Default**: Encrypt everything
5. **Observable**: Add logging and metrics

## Output Requirements:
- Valid JSON only
- Complete schema coverage
- No placeholders or TODO comments
"""
```

### 6.2 Few-Shot Examples

```python
FEW_SHOT_EXAMPLES = """
## Example Input:
Project: Task Management App
Requirements: ["User auth", "Create tasks", "Assign tasks", "Due dates", "Notifications"]

## Example Output:
{
  "tech_stack": ["nextjs", "postgresql", "prisma", "nextauth", "tailwind"],
  "db_schema": "model User { id, email, password, createdAt } model Task { id, title, status, userId, dueDate }",
  "api_design": "GET /api/tasks, POST /api/tasks, PATCH /api/tasks/:id",
  "files_to_create": [
    {"path": "prisma/schema.prisma", "description": "Database schema", "priority": "critical"},
    {"path": "src/app/api/auth/[...nextauth]/route.ts", "description": "Auth handler", "priority": "critical"}
  ],
  "architecture_decisions": [
    {"id": "ADR-001", "title": "Use Prisma ORM", "decision": "Use Prisma for type-safe DB access", "rationale": "Better DX, type safety, easy migrations", "status": "accepted"}
  ]
}
"""
```

---

## 7. Cost Optimization

### 7.1 Token Usage Tracking

```python
class ArchitectCostTracker:
    """Track costs for architect agent"""
    
    # Tier 1 pricing (Claude 3.5 Sonnet)
    INPUT_COST_PER_1M = 15.00  # $15 per 1M input tokens
    OUTPUT_COST_PER_1M = 75.00  # $75 per 1M output tokens
    
    def estimate(self, input_text: str, output_text: str) -> float:
        input_tokens = len(input_text) * 0.75  # Rough estimate
        output_tokens = len(output_text) * 0.75
        
        return (
            (input_tokens / 1_000_000) * self.INPUT_COST_PER_1M +
            (output_tokens / 1_000_000) * self.OUTPUT_COST_PER_1M
        )
    
    def track(self, state: AgentState, input_tokens: int, output_tokens: int):
        cost = (
            (input_tokens / 1_000_000) * self.INPUT_COST_PER_1M +
            (output_tokens / 1_000_000) * self.OUTPUT_COST_PER_1M
        )
        state.cost_sofar += cost
```

---

## 8. Error Handling

### 8.1 Retry Logic

```python
import asyncio
from typing import Optional

class ArchitectAgentRetry:
    """Retry logic for architect agent"""
    
    MAX_RETRIES = 3
    RETRY_DELAY = 2  # seconds
    
    async def run_with_retry(self, state: AgentState) -> AgentState:
        last_error = None
        
        for attempt in range(self.MAX_RETRIES):
            try:
                agent = ArchitectAgent()
                return await agent.run(state)
            except Exception as e:
                last_error = e
                if attempt < self.MAX_RETRIES - 1:
                    await asyncio.sleep(self.RETRY_DELAY * (attempt + 1))
        
        state.errors.append(f"Architect Agent failed after {self.MAX_RETRIES} attempts: {last_error}")
        return state
```

### 8.2 Validation

```python
from pydantic import ValidationError

def validate_architect_output(output: dict) -> Optional[str]:
    """Validate architect output before proceeding"""
    required_fields = ["tech_stack", "db_schema", "api_design", "files_to_create"]
    
    for field in required_fields:
        if field not in output:
            return f"Missing required field: {field}"
    
    if not output.get("tech_stack"):
        return "Tech stack cannot be empty"
    
    if not output.get("files_to_create"):
        return "Must specify at least one file to create"
    
    return None
```

---

## 9. Integration

### 9.1 Graph Integration

```python
# In graph_builder.py
from ..agents.architect_agent import ArchitectAgent

workflow.add_node("architect", ArchitectAgent().run)
workflow.add_edge("pm", "architect")
```

### 9.2 State Flow

```
PM Agent Output:
{
  "project_name": "Blog App",
  "description": "A blogging platform",
  "requirements": ["Auth", "Posts", "Comments"],
  ...
}
        ↓
Architect Agent:
- Uses Tier 1 LLM
- Designs system architecture
- Outputs structured JSON
        ↓
Architect Output:
{
  "tech_stack": ["nextjs", "postgresql", ...],
  "db_schema": "...",
  "api_design": "...",
  "files_to_create": [...],
  ...
}
```

---

## 10. Testing

### 10.1 Unit Tests

```python
import pytest
from src.agents.architect_agent import ArchitectAgent
from src.orchestrator.state_schema import AgentState, PMOutput

@pytest.fixture
def sample_state():
    return AgentState(
        user_prompt="Build a blog",
        project_id="123",
        pm_output=PMOutput(
            project_name="My Blog",
            description="A blogging platform",
            requirements=["User auth", "Create posts", "Comments"],
            target_users="Writers and readers",
            success_metrics=["Active users", "Posts created"]
        )
    )

@pytest.mark.asyncio
async def test_architect_agent_returns_output(sample_state):
    agent = ArchitectAgent()
    result = await agent.run(sample_state)
    
    assert result.architect_output is not None
    assert len(result.architect_output.tech_stack) > 0
    assert len(result.architect_output.files_to_create) > 0

@pytest.mark.asyncio
async def test_architect_agent_handles_missing_pm_output():
    agent = ArchitectAgent()
    state = AgentState(user_prompt="test", project_id="123")
    
    result = await agent.run(state)
    
    assert len(result.errors) > 0
    assert "Missing PM output" in result.errors[0]
```

### 10.2 Integration Tests

```python
@pytest.mark.asyncio
async def test_full_pipeline_pm_to_architect():
    from src.agents.pm_agent import PMAgent
    from src.agents.architect_agent import ArchitectAgent
    
    # Run PM Agent
    state = AgentState(user_prompt="Build a task app", project_id="123")
    pm_agent = PMAgent()
    state = await pm_agent.run(state)
    
    # Run Architect Agent
    architect = ArchitectAgent()
    state = await architect.run(state)
    
    # Verify
    assert state.architect_output is not None
    assert "postgresql" in state.architect_output.tech_stack or \
           "sqlite" in state.architect_output.tech_stack
```

---

## 11. Implementation Status

| Component | Status |
|-----------|--------|
| LLM Configuration | ✅ Complete |
| Input Schema | ✅ Complete |
| Output Schema | ✅ Complete |
| Agent Implementation | ✅ Complete |
| Prompt Engineering | ✅ Complete |
| Cost Tracking | ✅ Complete |
| Error Handling | ✅ Complete |
| Graph Integration | ✅ Complete |
| Unit Tests | ✅ Complete |

---

## 12. Key Implementation Notes

### 12.1 LLM Selection
- **Tier 1 Required**: Complex reasoning for system design
- Use Claude 3.5 Sonnet or GPT-4o
- Temperature: 0.2 for deterministic output

### 12.2 Output Validation
- Validate Pydantic schema before proceeding
- Check required fields: tech_stack, db_schema, api_design, files_to_create

### 12.3 Cost Control
- Track token usage per agent
- Add to running total in AgentState
- Log costs for billing/optimization

### 12.4 Error Handling
- Retry up to 3 times with exponential backoff
- Preserve error messages in state.errors
- Allow graph to continue with degraded state
