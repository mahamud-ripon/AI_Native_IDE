# Frontend Agent - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/src/agents/frontend-agent/`  
> **Tech Stack:** Python, LangGraph, Pydantic, LangChain  
> **LLM Tier:** Tier 2 (Claude 3.5 Haiku / Gemini Flash) - Bulk code generation

---

## 1. Executive Summary

The Frontend Agent generates React UI components, pages, and styling based on the system architecture designed by the Architect Agent. It operates in parallel with the Backend and DevOps agents.

---

## 2. Agent Configuration

### 2.1 LLM Configuration

```python
from langchain_anthropic import ChatAnthropic
import os

class FrontendLLM:
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
    """Output from Architect Agent - input to Frontend Agent"""
    tech_stack: List[str]
    db_schema: str
    api_design: str
    files_to_create: List[FileSpec]
    architecture_decisions: List[Dict]
```

### 3.2 Backend Output (Optional - for API integration)

```python
from typing import Optional

class CodeOutput(BaseModel):
    """Output from Backend Agent (optional input)"""
    files: Dict[str, str]
    dependencies: List[str]
```

---

## 4. Output Schema

### 4.1 Frontend Output

```python
from pydantic import BaseModel
from typing import Dict, List, Optional

class FrontendOutput(BaseModel):
    """Structured output from Frontend Agent"""
    
    # Generated files
    files: Dict[str, str]  # path -> content
    
    # Dependencies
    dependencies: List[str]
    dev_dependencies: List[str]
    
    # Configuration
    tailwind_config: Optional[str] = None
    next_config: Optional[str] = None
    
    # Routes
    routes: List[RouteSpec] = []
    
    # Setup instructions
    setup_instructions: Optional[str] = None

class RouteSpec(BaseModel):
    path: str
    component: str
    description: str
    auth_required: bool = False
```

---

## 5. Implementation

### 5.1 Agent Code (src/agents/frontend-agent/agent.py)

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_anthropic import ChatAnthropic
from ..routing.cost_manager import cost_manager
from ..orchestrator.state_schema import CodeOutput, AgentState

FRONTEND_SYSTEM_PROMPT = """You are a Frontend Developer Agent. Your role is to generate high-quality, production-ready React UI code.

## Your Responsibilities:
1. Generate React components (Next.js App Router)
2. Create pages with proper routing
3. Implement responsive UI with Tailwind CSS
4. Add form validation and state management
5. Integrate with backend APIs

## Technology Preferences:
- Use Next.js 14+ with App Router
- Use Tailwind CSS for styling
- Use TypeScript for type safety
- Use React Query for data fetching
- Use Zustand for client state
- Use shadcn/ui components when appropriate

## Output Format:
You must output a valid JSON object with files dict (path -> content).
"""

FRONTEND_USER_PROMPT = """## Input from Architect Agent:

**Tech Stack:** {tech_stack}
**API Design:** {api_design}
**Files to Create:** {files_to_create}

## Backend API (for integration):
{backend_output}

## Your Task:
Generate complete frontend code including:

1. **Pages:**
   - Landing page
   - Dashboard
   - Auth pages (login, register)
   - CRUD pages for each entity

2. **Components:**
   - Reusable UI components
   - Form components with validation
   - Data display components (tables, cards)
   - Navigation components

3. **Configuration:**
   - Tailwind config
   - Next.js config
   - TypeScript config

4. **State Management:**
   - React Query hooks
   - Zustand stores

Output as JSON: {{"files": {{"path": "content"}}}}.
"""

class FrontendAgent:
    """Frontend Developer Agent - generates React UI code"""
    
    def __init__(self):
        # Use Tier 2 LLM for bulk code generation
        self.llm = cost_manager.get_llm("tier2")
        self.parser = PydanticOutputParser(pydantic_object=CodeOutput)
    
    async def run(self, state: AgentState) -> AgentState:
        """
        Execute the Frontend Agent
        
        Args:
            state: Current agent state containing architect output
            
        Returns:
            Updated state with frontend output
        """
        # Validate input
        if not state.architect_output:
            state.errors.append("Frontend Agent: Missing architect output")
            return state
        
        # Build prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", FRONTEND_SYSTEM_PROMPT),
            ("user", FRONTEND_USER_PROMPT)
        ])
        
        # Create chain
        chain = prompt | self.llm.with_structured_output(CodeOutput)
        
        # Execute
        try:
            result = await chain.ainvoke({
                "tech_stack": ", ".join(state.architect_output.tech_stack),
                "api_design": state.architect_output.api_design,
                "files_to_create": ", ".join([f.path for f in state.architect_output.files_to_create]),
                "backend_output": state.backend_output.model_dump_json() if state.backend_output else "No backend output"
            })
            
            state.frontend_output = result
            
        except Exception as e:
            state.errors.append(f"Frontend Agent error: {str(e)}")
        
        return state
```

---

## 6. Code Generation Patterns

### 6.1 Next.js Page Pattern

```python
NEXTJS_PAGE_TEMPLATE = '''import {{ useState }} from 'react';
import {{ useRouter }} from 'next/navigation';
import {{ api }} from '@/lib/api';

export default function {{page_name}}Page() {{
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {{
    e.preventDefault();
    setLoading(true);
    setError('');

    try {{
      const response = await api.post('/{{resource}}', formData);
      if (response.ok) {{
        router.push('/{{resource}}');
      }}
    }} catch (err) {{
      setError('Failed to create {{resource}}');
    }} finally {{
      setLoading(false);
    }}
  }};

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Create {{resource}}</h1>
      
      {{#fields}}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">{{label}}</label>
        <input
          type="{{type}}"
          value={formData.{{name}}}
          onChange={(e) => setFormData({{...formData, {{name}}: e.target.value}})}
          className="w-full px-3 py-2 border rounded"
          required
        />
      </div>
      {{/fields}}

      {{#if error}}
      <div className="text-red-500 mb-4">{{error}}</div>
      {{/if}}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {{#if loading}}Loading...{{else}}Create{{/if}}
      </button>
    </div>
  );
}}
'''
```

### 6.2 Component Pattern

```python
REACT_COMPONENT_TEMPLATE = '''import {{ useState }} from 'react';

interface {{component_name}}Props {{
  {{#props}}
  {{name}}: {{type}};
  {{/props}}
  onSubmit: (data: {{interface_name}}Data) => void;
}}

interface {{interface_name}}Data {{
  {{#fields}}
  {{name}}: {{type}};
  {{/fields}}
}}

export function {{component_name}}({{props}}: {{component_name}}Props) {{
  const [formData, setFormData] = useState<{{interface_name}}Data>({{initial_data}});

  const handleSubmit = (e: React.FormEvent) => {{
    e.preventDefault();
    onSubmit(formData);
  }};

  return (
    <form onSubmit={handleSubmit} className="{{classes}}">
      {{#fields}}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">{{label}}</label>
        <input
          type="{{type}}"
          value={formData.{{name}}}
          onChange={(e) => setFormData({{...formData, {{name}}: e.target.value}})}
          className="w-full px-3 py-2 border rounded"
        />
      </div>
      {{/fields}}
      <button type="submit" className="px-4 py-2 bg-primary text-white rounded">
        Submit
      </button>
    </form>
  );
}}
'''
```

### 6.3 API Hook Pattern

```python
REACT_QUERY_HOOK_TEMPLATE = '''import {{ useQuery, useMutation, useQueryClient }} from '@tanstack/react-query';
import {{ api }} from '@/lib/api';

{{#entities}}
export function use{{entity_name}}s() {{
  return useQuery({{
    queryKey: ['{{entity_name | lowercase}}s'],
    queryFn: () => api.get('/{{entity_name | lowercase}}s').then(res => res.data)
  }});
}}

export function use{{entity_name}}(id: string) {{
  return useQuery({{
    queryKey: ['{{entity_name | lowercase}}', id],
    queryFn: () => api.get('/{{entity_name | lowercase}}s/$(id)').then(res => res.data)
  }});
}}

export function useCreate{{entity_name}}() {{
  const queryClient = useQueryClient();
  
  return useMutation({{
    mutationFn: (data: Create{{entity_name}}Input) =>
      api.post('/{{entity_name | lowercase}}s', data).then(res => res.data),
    onSuccess: () => {{
      queryClient.invalidateQueries({{ queryKey: ['{{entity_name | lowercase}}s'] }});
    }}
  }});
}}

export function useUpdate{{entity_name}}() {{
  const queryClient = useQueryClient();
  
  return useMutation({{
    mutationFn: ({{{id}, data}}) =>
      api.put('/{{entity_name | lowercase}}s/$(id)', data).then(res => res.data),
    onSuccess: (_, {{id}}) => {{
      queryClient.invalidateQueries({{ queryKey: ['{{entity_name | lowercase}}', id] }});
    }}
  }});
}}

export function useDelete{{entity_name}}() {{
  const queryClient = useQueryClient();
  
  return useMutation({{
    mutationFn: (id: string) =>
      api.delete('/{{entity_name | lowercase}}s/$(id)'),
    onSuccess: () => {{
      queryClient.invalidateQueries({{ queryKey: ['{{entity_name | lowercase}}s'] }});
    }}
  }});
}}
{{/entities}}
'''
```

---

## 7. Cost Optimization

### 7.1 Token Usage Tracking

```python
class FrontendCostTracker:
    """Track costs for frontend agent"""
    
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

class FrontendAgentRetry:
    """Retry logic for frontend agent"""
    
    MAX_RETRIES = 3
    RETRY_DELAY = 2
    
    async def run_with_retry(self, state: AgentState) -> AgentState:
        last_error = None
        
        for attempt in range(self.MAX_RETRIES):
            try:
                agent = FrontendAgent()
                return await agent.run(state)
            except Exception as e:
                last_error = e
                if attempt < self.MAX_RETRIES - 1:
                    await asyncio.sleep(self.RETRY_DELAY * (attempt + 1))
        
        state.errors.append(f"Frontend Agent failed after {self.MAX_RETRIES} attempts: {last_error}")
        return state
```

---

## 9. Integration

### 9.1 Graph Integration

```python
# In graph_builder.py
from ..agents.frontend_agent import FrontendAgent

workflow.add_node("frontend", FrontendAgent().run)
workflow.add_edge("architect", "frontend")
```

### 9.2 State Flow

```
Architect Output:
{
  "tech_stack": ["nextjs", "tailwind"],
  "api_design": "REST endpoints",
  "files_to_create": [...],
  ...
}
        ↓
Frontend Agent:
- Uses Tier 2 LLM
- Generates React components
- Creates pages with routing
- Adds Tailwind styling
        ↓
Frontend Output:
{
  "files": {
    "app/page.tsx": "...",
    "app/dashboard/page.tsx": "...",
    "components/ui/Button.tsx": "...",
    ...
  },
  "dependencies": ["@tanstack/react-query", "zustand"],
  ...
}
```

---

## 10. Testing

### 10.1 Unit Tests

```python
import pytest
from src.agents.frontend_agent import FrontendAgent
from src.orchestrator.state_schema import AgentState, ArchitectOutput

@pytest.fixture
def sample_state():
    return AgentState(
        user_prompt="Build a blog",
        project_id="123",
        architect_output=ArchitectOutput(
            tech_stack=["nextjs", "tailwind", "react-query"],
            db_schema="User, Post",
            api_design="REST endpoints",
            files_to_create=[],
            architecture_decisions=[]
        )
    )

@pytest.mark.asyncio
async def test_frontend_agent_returns_output(sample_state):
    agent = FrontendAgent()
    result = await agent.run(sample_state)
    
    assert result.frontend_output is not None
    assert len(result.frontend_output.files) > 0
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
- Generate Next.js 14+ App Router pages
- Create reusable React components
- Add Tailwind CSS styling
- Include React Query hooks
- Add Zustand stores

### 12.3 Parallel Execution
- Frontend runs in parallel with Backend and DevOps
- All three agents receive Architect output simultaneously
- Results converge at QA phase

### 12.4 Cost Control
- Much cheaper than Tier 1 agents
- Track usage for billing
- Optimize prompts for shorter output
