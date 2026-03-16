# Security Agent - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/src/agents/security-agent/`  
> **Tech Stack:** Python, LangGraph, Pydantic, LangChain  
> **LLM Tier:** Tier 3 (Llama-3 70B via Groq) - Simple scans

---

## 1. Executive Summary

The Security Agent scans the generated code for vulnerabilities, security issues, and best practice violations. It runs after QA and is the final checkpoint before code is committed.

---

## 2. Agent Configuration

### 2.1 LLM Configuration

```python
from langchain_openai import ChatOpenAI
import os

class SecurityLLM:
    """Tier 3 LLM for simple security scans"""
    
    def __init__(self):
        self.llm = ChatOpenAI(
            model="llama-3-70b-8192",
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY"),
            temperature=0.1,
            max_tokens=2000
        )
```

---

## 3. Input Schema

### 3.1 All Code Outputs (Received from Code Agents)

```python
from pydantic import BaseModel
from typing import Dict, List

class CodeOutput(BaseModel):
    """Output from code generation agents"""
    files: Dict[str, str]  # path -> content
    dependencies: List[str]
```

---

## 4. Output Schema

### 4.1 Security Output

```python
from pydantic import BaseModel
from typing import List, Dict, Optional

class SecurityOutput(BaseModel):
    """Structured output from Security Agent"""
    
    # Vulnerability summary
    vulnerabilities: List[Vulnerability]
    total_issues: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    
    # Risk assessment
    risk_level: str  # "low", "medium", "high", "critical"
    
    # Recommendations
    recommendations: List[str]
    
    # Dependencies check
    dependency_issues: List[DependencyIssue]

class Vulnerability(BaseModel):
    id: str
    severity: str  # "critical", "high", "medium", "low"
    category: str  # "sql_injection", "xss", "hardcoded_secret", etc.
    file: str
    line: Optional[int] = None
    description: str
    recommendation: str

class DependencyIssue(BaseModel):
    package: str
    current_version: str
    vulnerability: str
    severity: str
    recommendation: str
```

---

## 5. Implementation

### 5.1 Agent Code (src/agents/security-agent/agent.py)

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_openai import ChatOpenAI
from ..routing.cost_manager import cost_manager
from ..orchestrator.state_schema import SecurityOutput, AgentState

SECURITY_SYSTEM_PROMPT = """You are a Security Engineer Agent. Your role is to scan the generated code for security vulnerabilities and best practice violations.

## Your Responsibilities:
1. Identify security vulnerabilities (SQL injection, XSS, etc.)
2. Detect hardcoded secrets and credentials
3. Check for insecure dependencies
4. Verify authentication/authorization implementation
5. Report security best practice violations

## Vulnerability Categories to Check:
- SQL Injection
- Cross-Site Scripting (XSS)
- Command Injection
- Path Traversal
- Hardcoded Secrets/Keys
- Insecure Dependencies
- Missing Input Validation
- Insecure Authentication
- Authorization Issues
- Race Conditions

## Output Format:
You must output a valid JSON object with vulnerabilities list and risk assessment.
"""

SECURITY_USER_PROMPT = """## Code to Scan:
{code}

## Dependencies:
{dependencies}

## Your Task:
Scan the code for security vulnerabilities. For each issue found:
1. Identify the vulnerability type
2. Specify the file and line number
3. Explain the risk
4. Provide remediation advice

Output as JSON with vulnerabilities list.
"""

class SecurityAgent:
    """Security Engineer Agent - scans for vulnerabilities"""
    
    def __init__(self):
        # Use Tier 3 LLM for simple scans (cheapest)
        self.llm = cost_manager.get_llm("tier3")
        self.parser = PydanticOutputParser(pydantic_object=SecurityOutput)
    
    async def run(self, state: AgentState) -> AgentState:
        """
        Execute the Security Agent
        
        Args:
            state: Current agent state containing code outputs
            
        Returns:
            Updated state with security output
        """
        # Combine all code for scanning
        all_code = ""
        
        if state.backend_output:
            all_code += "\n--- BACKEND ---\n"
            for path, content in state.backend_output.files.items():
                all_code += f"\n### File: {path}\n{content}\n"
        
        if state.frontend_output:
            all_code += "\n--- FRONTEND ---\n"
            for path, content in state.frontend_output.files.items():
                all_code += f"\n### File: {path}\n{content}\n"
        
        if state.devops_output:
            all_code += "\n--- DEVOPS ---\n"
            for path, content in state.devops_output.files.items():
                all_code += f"\n### File: {path}\n{content}\n"
        
        # Build prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", SECURITY_SYSTEM_PROMPT),
            ("user", SECURITY_USER_PROMPT)
        ])
        
        # Create chain
        chain = prompt | self.llm.with_structured_output(SecurityOutput)
        
        # Execute
        try:
            result = await chain.ainvoke({
                "code": all_code,
                "dependencies": str(state.backend_output.dependencies if state.backend_output else [])
            })
            
            state.security_output = result
            
        except Exception as e:
            state.errors.append(f"Security Agent error: {str(e)}")
        
        return state
```

---

## 6. Vulnerability Detection Patterns

### 6.1 SQL Injection Detection

```python
SQL_INJECTION_PATTERNS = [
    r"execute\s*\(\s*['\"].*\%s",  # Python string formatting in SQL
    r"cursor\.execute\s*\(\s*f['\"]",  # f-string in SQL
    r"\.format\s*\(\s*.*\).*execute",  # .format() in SQL
    r"SELECT.*\+.*request",  # String concatenation with user input
]
```

### 6.2 Hardcoded Secret Detection

```python
HARDCODED_SECRET_PATTERNS = [
    (r"password\s*=\s*['\"][^'\"]+['\"]", "Hardcoded password"),
    (r"api_key\s*=\s*['\"][^'\"]+['\"]", "Hardcoded API key"),
    (r"secret\s*=\s*['\"][^'\"]+['\"]", "Hardcoded secret"),
    (r"token\s*=\s*['\"][a-zA-Z0-9_-]{20,}['\"]", "Hardcoded token"),
    (r"PRIVATE\s*KEY\s*[-—]", "Private key detected"),
]
```

### 6.3 XSS Detection

```python
XSS_PATTERNS = [
    (r"dangerouslySetInnerHTML", "Potential XSS via innerHTML"),
    (r"innerHTML\s*=", "Direct innerHTML assignment"),
    (r"eval\s*\(", "eval() usage - potential code injection"),
    (r"document\.write\s*\(", "document.write() usage"),
]
```

---

## 7. Cost Optimization

### 7.1 Token Usage Tracking

```python
class SecurityCostTracker:
    """Track costs for security agent"""
    
    # Tier 3 pricing (Llama-3 via Groq)
    INPUT_COST_PER_1M = 0.10   # $0.10 per 1M input tokens
    OUTPUT_COST_PER_1M = 0.40  # $0.40 per 1M output tokens
    
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
from ..agents.security_agent import SecurityAgent

workflow.add_node("security", SecurityAgent().run)
workflow.add_edge("qa", "security")
workflow.add_edge("security", END)
```

### 8.2 Pipeline Flow

```
PM Agent → Architect Agent → Backend/Frontend/DevOps (parallel)
                                    ↓
                              QA Agent
                                    ↓
                              Security Agent
                                    ↓
                                COMPLETE
```

---

## 9. Testing

### 9.1 Unit Tests

```python
import pytest
from src.agents.security_agent import SecurityAgent
from src.orchestrator.state_schema import AgentState, CodeOutput

@pytest.fixture
def sample_state():
    return AgentState(
        user_prompt="Build a blog",
        project_id="123",
        backend_output=CodeOutput(
            files={"src/app.py": "password = 'secret123'"},
            dependencies=["fastapi"]
        )
    )

@pytest.mark.asyncio
async def test_security_agent_detects_secrets(sample_state):
    agent = SecurityAgent()
    result = await agent.run(sample_state)
    
    assert result.security_output is not None
    # Should detect hardcoded password
    assert any("password" in v.category.lower() or "secret" in v.category.lower() 
               for v in result.security_output.vulnerabilities)
```

---

## 10. Implementation Status

| Component | Status |
|-----------|--------|
| LLM Configuration | ✅ Complete |
| Input Schema | ✅ Complete |
| Output Schema | ✅ Complete |
| Agent Implementation | ✅ Complete |
| Detection Patterns | ✅ Complete |
| Cost Tracking | ✅ Complete |
| Graph Integration | ✅ Complete |

---

## 11. Key Implementation Notes

### 11.1 LLM Selection
- **Tier 3**: Simple scans (cheapest - $0.10/1M input)
- Use Llama-3 70B via Groq
- Temperature: 0.1 for focused output

### 11.2 Vulnerability Categories
- SQL Injection
- XSS
- Command Injection
- Hardcoded Secrets
- Insecure Dependencies
- Input Validation
- Authentication Issues

### 11.3 Cost Control
- Cheapest tier - designed for simple pattern matching
- Much lower cost than Tier 1/2 agents
- Track usage for billing

### 11.4 Final Checkpoint
- Runs after QA
- Last agent in the pipeline
- No feedback loop - issues are reported but not auto-fixed
