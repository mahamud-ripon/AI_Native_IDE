# PM Agent - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/src/agents/pm-agent/`  
> **Tech Stack:** Python, LangGraph, Pydantic, LangChain  
> **LLM Tier:** Tier 1 (Claude 3.5 Sonnet / GPT-4o) - Complex reasoning

---

## 1. Executive Summary

The PM (Product Manager) Agent is the entry point of the AI orchestration pipeline. It receives the user's natural language prompt and outputs a structured Product Requirements Document (PRD) that defines what to build.

---

## 2. Agent Configuration

### 2.1 LLM Configuration

```python
from langchain_anthropic import ChatAnthropic
import os

class PMLLM:
    """Tier 1 LLM for complex reasoning"""
    
    def __init__(self):
        self.llm = ChatAnthropic(
            model="claude-3-5-sonnet-20241022",
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
            temperature=0.3,
            max_tokens=4000
        )
```

---

## 3. Input Schema

### 3.1 User Input (Direct from User)

```python
from pydantic import BaseModel

class UserInput(BaseModel):
    """Raw user prompt"""
    prompt: str
    project_id: str
```

---

## 4. Output Schema

### 4.1 PM Output

```python
from pydantic import BaseModel
from typing import List, Optional

class PMOutput(BaseModel):
    """Structured output from PM Agent"""
    
    # Project identity
    project_name: str
    description: str
    
    # Requirements
    requirements: List[str]
    features: List[FeatureSpec]
    
    # Users
    target_users: str
    user_personas: List[Persona]
    
    # Success metrics
    success_metrics: List[str]
    
    # Constraints
    budget_tier: str  # "low", "medium", "high"
    timeline: str  # "immediate", "weeks", "months"
    tech_preferences: Optional[List[str]] = None

class FeatureSpec(BaseModel):
    name: str
    description: str
    priority: str  # "must-have", "should-have", "nice-to-have"
    dependencies: List[str] = []

class Persona(BaseModel):
    name: str
    role: str
    goals: List[str]
    pain_points: List[str]
```

---

## 5. Implementation

### 5.1 Agent Code (src/agents/pm-agent/agent.py)

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_anthropic import ChatAnthropic
from ..routing.cost_manager import cost_manager
from ..orchestrator.state_schema import PMOutput, AgentState
import os

PM_SYSTEM_PROMPT = """You are a Product Manager Agent. Your role is to understand what the user wants to build and translate it into a clear, actionable product specification.

## Your Responsibilities:
1. Understand the user's natural language request
2. Define the project scope and goals
3. Break down requirements into features
4. Identify target users and their needs
5. Define success metrics

## Guidelines:
- Ask clarifying questions if the request is ambiguous
- Focus on MVP features first
- Consider technical feasibility
- Think about user experience

## Output Format:
You must output a valid JSON object matching the provided schema.
"""

PM_USER_PROMPT = """## User Request:

**Prompt:** {user_prompt}

## Your Task:
Analyze this request and create a comprehensive product specification:

1. **Project Name:** Create a catchy, descriptive name for this project

2. **Description:** Write a 2-3 sentence description of what this project does

3. **Requirements:** List all the requirements the user mentioned or implied

4. **Features:** Break down the project into specific features with priorities

5. **Target Users:** Define who this product is for

6. **Success Metrics:** Define how we measure if this project is successful

7. **Constraints:** Note any budget, timeline, or technical preferences

{format_instructions}
"""

class PMAgent:
    """Product Manager Agent - translates user requests into PRDs"""
    
    def __init__(self):
        # Use Tier 1 LLM for complex reasoning
        self.llm = cost_manager.get_llm("tier1")
        self.parser = PydanticOutputParser(pydantic_object=PMOutput)
    
    async def run(self, state: AgentState) -> AgentState:
        """
        Execute the PM Agent
        
        Args:
            state: Current agent state containing user prompt
            
        Returns:
            Updated state with PM output
        """
        # Validate input
        if not state.user_prompt:
            state.errors.append("PM Agent: Missing user prompt")
            return state
        
        # Build prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", PM_SYSTEM_PROMPT),
            ("user", PM_USER_PROMPT)
        ])
        
        # Create chain
        chain = prompt | self.llm.with_structured_output(PMOutput)
        
        # Execute
        try:
            result = await chain.ainvoke({
                "user_prompt": state.user_prompt,
                "format_instructions": self.parser.get_format_instructions()
            })
            
            state.pm_output = result
            
        except Exception as e:
            state.errors.append(f"PM Agent error: {str(e)}")
        
        return state
```

---

## 6. Prompt Engineering

### 6.1 System Prompt Strategy

```python
PM_SYSTEM_PROMPT = """You are a Senior Product Manager at a top-tier tech company.

## Your Expertise:
- User research and persona development
- Feature prioritization frameworks (MoSCoW, RICE, Kano)
- Agile product development
- Technical feasibility assessment
- UX best practices

## Approach:
1. **Understand First**: Make sure you understand what the user wants
2. **Simplify**: Focus on core value proposition
3. **Prioritize**: Distinguish must-have vs nice-to-have
4. **Validate**: Ensure requirements are testable

## Output Requirements:
- Valid JSON only
- Complete schema coverage
- No placeholders or TODO comments
- Actionable specifications that developers can implement
"""
```

### 6.2 Few-Shot Examples

```python
FEW_SHOT_EXAMPLES = """
## Example Input:
"Build a task management app where teams can create projects, assign tasks to members, set due dates, and get notified before deadlines."

## Example Output:
{
  "project_name": "TaskFlow",
  "description": "A collaborative task management platform for teams to organize projects, assign work, and track deadlines.",
  "requirements": [
    "User authentication and team management",
    "Create and manage projects",
    "Create, assign, and track tasks",
    "Set due dates and reminders",
    "Team notifications"
  ],
  "features": [
    {"name": "Project Management", "description": "Create and organize projects", "priority": "must-have"},
    {"name": "Task Assignment", "description": "Assign tasks to team members", "priority": "must-have"},
    {"name": "Due Date Tracking", "description": "Set and track task deadlines", "priority": "must-have"},
    {"name": "Notifications", "description": "Alert users before deadlines", "priority": "should-have"}
  ],
  "target_users": "Small to medium teams needing project organization",
  "user_personas": [
    {"name": "Team Lead", "role": "Manages team and projects", "goals": ["Track progress", "Delegate work"], "pain_points": ["Lost tasks", "Missed deadlines"]}
  ],
  "success_metrics": ["Tasks completed on time", "Active users", "Projects created"],
  "budget_tier": "medium",
  "timeline": "weeks"
}
"""
```

---

## 7. Cost Optimization

### 7.1 Token Usage Tracking

```python
class PMCostTracker:
    """Track costs for PM agent"""
    
    # Tier 1 pricing (Claude 3.5 Sonnet)
    INPUT_COST_PER_1M = 15.00  # $15 per 1M input tokens
    OUTPUT_COST_PER_1M = 75.00  # $75 per 1M output tokens
    
    def estimate(self, input_text: str, output_text: str) -> float:
        input_tokens = len(input_text) * 0.75
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

class PMAgentRetry:
    """Retry logic for PM agent"""
    
    MAX_RETRIES = 3
    RETRY_DELAY = 2
    
    async def run_with_retry(self, state: AgentState) -> AgentState:
        last_error = None
        
        for attempt in range(self.MAX_RETRIES):
            try:
                agent = PMAgent()
                return await agent.run(state)
            except Exception as e:
                last_error = e
                if attempt < self.MAX_RETRIES - 1:
                    await asyncio.sleep(self.RETRY_DELAY * (attempt + 1))
        
        state.errors.append(f"PM Agent failed after {self.MAX_RETRIES} attempts: {last_error}")
        return state
```

### 8.2 Validation

```python
def validate_pm_output(output: dict) -> Optional[str]:
    """Validate PM output before proceeding"""
    required_fields = ["project_name", "description", "requirements", "target_users", "success_metrics"]
    
    for field in required_fields:
        if field not in output:
            return f"Missing required field: {field}"
    
    if not output.get("project_name"):
        return "Project name cannot be empty"
    
    if not output.get("requirements"):
        return "Must specify at least one requirement"
    
    return None
```

---

## 9. Integration

### 9.1 Graph Integration

```python
# In graph_builder.py
from ..agents.pm_agent import PMAgent

workflow.add_node("pm", PMAgent().run)
workflow.add_edge("__start__", "pm")
```

### 9.2 State Flow

```
User Prompt:
"Build a blog where users can create posts, comment, and subscribe"
        ↓
PM Agent:
- Uses Tier 1 LLM
- Analyzes requirements
- Creates structured PRD
        ↓
PM Output:
{
  "project_name": "DevBlog",
  "description": "A blogging platform with comments and subscriptions",
  "requirements": ["User auth", "Create posts", "Comments", "Subscriptions"],
  "features": [...],
  "target_users": "Developers and readers",
  "success_metrics": ["Posts created", "Comments", "Subscribers"],
  ...
}
        ↓
Architect Agent (next)
```

---

## 10. Testing

### 10.1 Unit Tests

```python
import pytest
from src.agents.pm_agent import PMAgent
from src.orchestrator.state_schema import AgentState

@pytest.fixture
def sample_state():
    return AgentState(
        user_prompt="Build a task management app",
        project_id="123"
    )

@pytest.mark.asyncio
async def test_pm_agent_returns_output(sample_state):
    agent = PMAgent()
    result = await agent.run(sample_state)
    
    assert result.pm_output is not None
    assert result.pm_output.project_name is not None
    assert len(result.pm_output.requirements) > 0
    assert len(result.pm_output.success_metrics) > 0

@pytest.mark.asyncio
async def test_pm_agent_handles_empty_prompt():
    agent = PMAgent()
    state = AgentState(user_prompt="", project_id="123")
    
    result = await agent.run(state)
    
    assert len(result.errors) > 0
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
- **Tier 1 Required**: Complex reasoning for understanding user intent
- Use Claude 3.5 Sonnet or GPT-4o
- Temperature: 0.3 for balanced creativity/determinism

### 12.2 Output Validation
- Validate Pydantic schema before proceeding
- Check required fields: project_name, description, requirements, target_users, success_metrics

### 12.3 Cost Control
- Track token usage per agent
- Add to running total in AgentState
- Log costs for billing/optimization

### 12.4 Error Handling
- Retry up to 3 times with exponential backoff
- Preserve error messages in state.errors
- Allow graph to continue with degraded state

### 12.5 First in Pipeline
- PM Agent is the entry point
- Runs before Architect Agent
- Output feeds directly into Architect Agent
