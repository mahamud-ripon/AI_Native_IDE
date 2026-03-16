# Orchestrator - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/src/orchestrator/`  
> **Tech Stack:** Python, LangGraph, Pydantic

---

## 1. Executive Summary

The Orchestrator manages the LangGraph workflow that coordinates all AI agents. It defines the DAG (Directed Acyclic Graph) structure, state management, and execution flow from PM Agent through to Security Agent.

---

## 2. Components

### 2.1 Graph Builder

```python
# src/orchestrator/graph_builder.py
from langgraph.graph import StateGraph, END
from .state_schema import AgentState
from ..agents.pm_agent import PMAgent
from ..agents.architect_agent import ArchitectAgent
from ..agents.backend_agent import BackendAgent
from ..agents.frontend_agent import FrontendAgent
from ..agents.devops_agent import DevOpsAgent
from ..agents.qa_agent import QAAgent
from ..agents.security_agent import SecurityAgent

class GraphBuilder:
    """Builds and compiles the LangGraph DAG"""
    
    def __init__(self):
        self.pm = PMAgent()
        self.architect = ArchitectAgent()
        self.backend = BackendAgent()
        self.frontend = FrontendAgent()
        self.devops = DevOpsAgent()
        self.qa = QAAgent()
        self.security = SecurityAgent()
    
    def should_continue_qa(self, state: AgentState) -> str:
        """Decide whether to retry or end"""
        if state.iteration >= state.max_iterations:
            return "end"
        if state.qa_output and state.qa_output.tests_passed:
            return "end"
        return "retry"
    
    def build(self) -> StateGraph:
        """Build the LangGraph workflow"""
        workflow = StateGraph(AgentState)
        
        # Add nodes
        workflow.add_node("pm", self.pm.run)
        workflow.add_node("architect", self.architect.run)
        workflow.add_node("backend", self.backend.run)
        workflow.add_node("frontend", self.frontend.run)
        workflow.add_node("devops", self.devops.run)
        workflow.add_node("qa", self.qa.run)
        workflow.add_node("security", self.security.run)
        
        # Sequential: PM -> Architect
        workflow.add_edge("__start__", "pm")
        workflow.add_edge("pm", "architect")
        
        # Parallel: Architect -> Backend + Frontend + DevOps
        workflow.add_edge("architect", "backend")
        workflow.add_edge("architect", "frontend")
        workflow.add_edge("architect", "devops")
        
        # After parallel, go to QA and Security
        workflow.add_edge("backend", "qa")
        workflow.add_edge("frontend", "qa")
        workflow.add_edge("devops", "qa")
        workflow.add_edge("qa", "security")
        workflow.add_edge("security", END)
        
        # Conditional: QA feedback loop
        workflow.add_conditional_edges(
            "qa",
            self.should_continue_qa,
            {
                "retry": "backend",
                "end": END
            }
        )
        
        return workflow
    
    def compile(self):
        """Compile and return the graph"""
        return self.build().compile()
```

---

## 3. State Schema

### 3.1 Agent State (src/orchestrator/state_schema.py)

```python
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum

class ConversationStatus(str, Enum):
    QUEUED = "queued"
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class PMOutput(BaseModel):
    project_name: str
    description: str
    requirements: List[str]
    target_users: str
    success_metrics: List[str]

class ArchitectOutput(BaseModel):
    tech_stack: List[str]
    db_schema: str
    api_design: str
    files_to_create: List[Dict]
    architecture_decisions: List[Dict]

class CodeOutput(BaseModel):
    files: Dict[str, str]
    dependencies: List[str]
    setup_instructions: Optional[str] = None

class QAOutput(BaseModel):
    tests_passed: bool
    test_results: Dict[str, bool]
    errors: List[str]
    coverage: Optional[float] = None

class SecurityOutput(BaseModel):
    vulnerabilities: List[Dict[str, Any]]
    risk_level: str

class AgentState(BaseModel):
    # Input
    user_prompt: str
    project_id: str
    
    # Phase outputs
    pm_output: Optional[PMOutput] = None
    architect_output: Optional[ArchitectOutput] = None
    backend_output: Optional[CodeOutput] = None
    frontend_output: Optional[CodeOutput] = None
    devops_output: Optional[CodeOutput] = None
    qa_output: Optional[QAOutput] = None
    security_output: Optional[SecurityOutput] = None
    
    # Metadata
    iteration: int = 0
    max_iterations: int = 3
    errors: List[str] = []
    cost_sofar: float = 0.0
```

---

## 4. Execution Flow

### 4.1 Pipeline Stages

```
Stage 1: Sequential
┌──────────────┐     ┌────────────────┐
│   PM Agent   │ ──► │ Architect Agent│
└──────────────┘     └────────────────┘

Stage 2: Parallel
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Backend Agent  │  │Frontend Agent  │  │ DevOps Agent   │
└───────┬────────┘  └───────┬────────┘  └───────┬────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
Stage 3: Validation
                 ┌────────────────┐
                 │   QA Agent     │
                 └───────┬────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌─────────┐     ┌──────────┐    ┌──────────┐
   │ Retry?  │     │  Retry?  │    │  Retry?  │
   └────┬────┘     └────┬─────┘    └────┬─────┘
        │               │               │
        └───────────────┼───────────────┘
                        ▼
Stage 4: Security
                 ┌──────────────────┐
                 │ Security Agent   │
                 └────────┬─────────┘
                          ▼
                       COMPLETE
```

### 4.2 Feedback Loop

```python
def should_continue_qa(state: AgentState) -> str:
    """
    QA Feedback Loop Logic:
    1. If max_iterations reached -> end (fail gracefully)
    2. If tests passed -> end (success)
    3. If tests failed -> retry (loop back to code agents)
    """
    if state.iteration >= state.max_iterations:
        # Max retries reached
        state.errors.append("Max iterations reached. Tests still failing.")
        return "end"
    
    if state.qa_output and state.qa_output.tests_passed:
        # All tests passed
        return "end"
    
    # Tests failed, increment iteration and retry
    state.iteration += 1
    return "retry"
```

---

## 5. Usage

### 5.1 Running the Pipeline

```python
from src.orchestrator.graph_builder import GraphBuilder
from src.orchestrator.state_schema import AgentState

async def run_pipeline(user_prompt: str, project_id: str):
    # Initialize graph
    graph = GraphBuilder().compile()
    
    # Create initial state
    initial_state = AgentState(
        user_prompt=user_prompt,
        project_id=project_id
    )
    
    # Run pipeline
    result = await graph.ainvoke(initial_state)
    
    return result
```

---

## 6. Implementation Status

| Component | Status |
|-----------|--------|
| Graph Builder | ✅ Complete |
| State Schema | ✅ Complete |
| Feedback Loop | ✅ Complete |
| Parallel Execution | ✅ Complete |

---

## 7. Key Implementation Notes

### 7.1 DAG Structure
- **Sequential**: PM → Architect
- **Parallel**: Backend + Frontend + DevOps (concurrent)
- **Convergent**: QA → Security

### 7.2 Feedback Loop
- Max iterations = 3 to prevent infinite loops
- Loops back to Backend on test failure
- Tracks iteration count in state

### 7.3 State Management
- All agents communicate via Pydantic schemas
- State passed through entire pipeline
- Errors accumulated in state.errors
