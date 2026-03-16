# LLM Router - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/src/llm-router/`  
> **Tech Stack:** Python, LangChain, Pydantic

---

## 1. Executive Summary

The LLM Router is a centralized component that manages dynamic LLM routing for cost optimization across all agents. It implements a tier-based routing strategy to select the appropriate model for each task based on complexity and cost.

---

## 2. Architecture

### 2.1 Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      LLM Router                             │
├─────────────────────────────────────────────────────────────┤
│  Tier 1 (Complex Reasoning)                                 │
│  - Claude 3.5 Sonnet ($15/1M input)                         │
│  - GPT-4o ($15/1M input)                                    │
│                                                             │
│  Tier 2 (Fast/Cheap)                                        │
│  - Claude 3.5 Haiku ($0.25/1M input)                        │
│  - Gemini Flash ($0.25/1M input)                            │
│                                                             │
│  Tier 3 (Local/OSS)                                         │
│  - Llama-3 70B via Groq ($0.10/1M input)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Implementation

### 3.1 Cost Manager (src/llm-router/cost_manager.py)

```python
from typing import Literal, Optional
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
import os

LLM_TIER = Literal["tier1", "tier2", "tier3"]

class CostManager:
    """Dynamic LLM routing for cost optimization"""
    
    # Pricing per 1M tokens (approximate)
    TIER_COSTS = {
        "tier1": {"input": 15.0, "output": 75.0},   # Claude 3.5 Sonnet / GPT-4o
        "tier2": {"input": 0.25, "output": 1.25},   # Claude 3.5 Haiku / Gemini Flash
        "tier3": {"input": 0.10, "output": 0.40},   # Llama-3 70B via Groq
    }
    
    def __init__(self):
        # Initialize all LLM clients
        self.anthropic = ChatAnthropic(
            model="claude-3-5-sonnet-20241022",
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY")
        )
        self.openai = ChatOpenAI(
            model="gpt-4o",
            api_key=os.getenv("OPENAI_API_KEY")
        )
        self.haiku = ChatAnthropic(
            model="claude-3-haiku-20240307",
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY")
        )
    
    def get_llm(self, tier: LLM_TIER):
        """Get LLM instance based on tier"""
        if tier == "tier1":
            return self.anthropic
        elif tier == "tier2":
            return self.haiku
        elif tier == "tier3":
            # Use Groq-hosted Llama-3 for local/OSS
            return ChatOpenAI(
                model="llama-3-70b-8192",
                base_url="https://api.groq.com/openai/v1",
                api_key=os.getenv("GROQ_API_KEY")
            )
    
    def get_tier_for_agent(self, agent_name: str) -> LLM_TIER:
        """Route agent to appropriate tier"""
        tier_map = {
            "pm_agent": "tier1",        # Complex reasoning
            "architect_agent": "tier1", # Complex reasoning
            "backend_agent": "tier2",   # Bulk code gen
            "frontend_agent": "tier2",  # Bulk code gen
            "devops_agent": "tier2",    # Straightforward configs
            "qa_agent": "tier2",        # Test generation
            "security_agent": "tier3",  # Simple scans
        }
        return tier_map.get(agent_name, "tier2")
    
    def estimate_cost(self, tier: LLM_TIER, input_tokens: int, output_tokens: int) -> float:
        """Estimate cost for a call"""
        costs = self.TIER_COSTS[tier]
        return (input_tokens / 1_000_000 * costs["input"] +
                output_tokens / 1_000_000 * costs["output"])

# Global instance
cost_manager = CostManager()
```

---

## 4. Tier Definitions

### 4.1 Tier 1 - Complex Reasoning

```python
TIER1_CONFIG = {
    "name": "Complex Reasoning",
    "models": ["claude-3-5-sonnet-20241022", "gpt-4o"],
    "use_cases": [
        "Product requirements analysis",
        "System architecture design",
        "Complex problem solving",
        "Strategic planning"
    ],
    "cost_per_1m_input": 15.0,
    "cost_per_1m_output": 75.0,
    "characteristics": [
        "Best for complex reasoning",
        "Highest quality output",
        "Most expensive tier"
    ]
}
```

### 4.2 Tier 2 - Fast/Cheap

```python
TIER2_CONFIG = {
    "name": "Fast/Cheap",
    "models": ["claude-3-haiku-20240307", "gemini-flash"],
    "use_cases": [
        "Bulk code generation",
        "Straightforward React components",
        "Test generation",
        "Config file creation"
    ],
    "cost_per_1m_input": 0.25,
    "cost_per_1m_output": 1.25,
    "characteristics": [
        "Fast response times",
        "Cost-effective for bulk operations",
        "Good enough for simple tasks"
    ]
}
```

### 4.3 Tier 3 - Local/OSS

```python
TIER3_CONFIG = {
    "name": "Local/OSS",
    "models": ["llama-3-70b-8192"],
    "provider": "Groq",
    "use_cases": [
        "Simple linting fixes",
        "Typo corrections",
        "Syntax checks",
        "Basic security scans"
    ],
    "cost_per_1m_input": 0.10,
    "cost_per_1m_output": 0.40,
    "characteristics": [
        "Lowest cost",
        "Fast inference",
        "Good for simple pattern matching"
    ]
}
```

---

## 5. Usage Examples

### 5.1 Basic Usage

```python
from src.llm_router.cost_manager import cost_manager

# Get LLM for specific tier
llm = cost_manager.get_llm("tier1")

# Get LLM based on agent
llm = cost_manager.get_llm(cost_manager.get_tier_for_agent("pm_agent"))

# Estimate cost
estimated_cost = cost_manager.estimate_cost("tier1", 1000, 2000)
print(f"Estimated cost: ${estimated_cost:.4f}")
```

### 5.2 Integration with Agents

```python
from src.llm_router.cost_manager import cost_manager
from langchain_core.prompts import ChatPromptTemplate

class BaseAgent:
    def __init__(self, agent_name: str):
        self.agent_name = agent_name
        self.tier = cost_manager.get_tier_for_agent(agent_name)
        self.llm = cost_manager.get_llm(self.tier)
    
    def run(self, prompt: str):
        # Track cost
        input_tokens = len(prompt) * 0.75
        estimated = cost_manager.estimate_cost(self.tier, int(input_tokens), 1000)
        
        # Use appropriate LLM
        response = self.llm.invoke(prompt)
        return response
```

---

## 6. Cost Tracking

### 6.1 Cost Tracker

```python
from dataclasses import dataclass
from typing import Dict

@dataclass
class CostRecord:
    tier: str
    input_tokens: int
    output_tokens: int
    cost: float
    agent: str

class CostTracker:
    """Track and report LLM costs"""
    
    def __init__(self):
        self.records: list[CostRecord] = []
    
    def record(self, tier: str, input_tokens: int, output_tokens: int, agent: str):
        cost = cost_manager.estimate_cost(tier, input_tokens, output_tokens)
        self.records.append(CostRecord(tier, input_tokens, output_tokens, cost, agent))
    
    def total_cost(self) -> float:
        return sum(r.cost for r in self.records)
    
    def cost_by_agent(self) -> Dict[str, float]:
        result = {}
        for r in self.records:
            result[r.agent] = result.get(r.agent, 0) + r.cost
        return result
    
    def report(self) -> str:
        return f"""
LLM Cost Report
===============
Total Cost: ${self.total_cost():.4f}

By Agent:
{chr(10).join(f"  {agent}: ${cost:.4f}" for agent, cost in self.cost_by_agent().items())}
"""
```

---

## 7. Implementation Status

| Component | Status |
|-----------|--------|
| Cost Manager | ✅ Complete |
| Tier 1 Config | ✅ Complete |
| Tier 2 Config | ✅ Complete |
| Tier 3 Config | ✅ Complete |
| Cost Tracking | ✅ Complete |

---

## 8. Key Implementation Notes

### 8.1 Routing Strategy
- **Tier 1**: PM Agent, Architect Agent (complex reasoning)
- **Tier 2**: Backend, Frontend, DevOps, QA (bulk generation)
- **Tier 3**: Security Agent (simple scans)

### 8.2 Cost Optimization
- Use cheapest tier that can完成任务
- Track costs per agent for billing
- Estimate costs before execution

### 8.3 Model Selection
- Anthropic for Tier 1 & 2
- Groq-hosted Llama-3 for Tier 3
- OpenAI as backup option
