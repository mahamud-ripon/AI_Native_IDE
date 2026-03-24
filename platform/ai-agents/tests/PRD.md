# Tests - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/tests/`  
> **Tech Stack:** Python, pytest, pytest-asyncio

---

## 1. Executive Summary

The Tests module provides comprehensive test coverage for the AI-Agents system, including unit tests for individual agents, integration tests for the orchestrator, and end-to-end tests for the full pipeline.

---

## 2. Test Structure

### 2.1 Directory Structure

```
tests/
├── unit/
│   ├── test_agents/
│   │   ├── test_pm_agent.py
│   │   ├── test_architect_agent.py
│   │   ├── test_backend_agent.py
│   │   ├── test_frontend_agent.py
│   │   ├── test_devops_agent.py
│   │   ├── test_qa_agent.py
│   │   └── test_security_agent.py
│   ├── test_llm_router.py
│   └── test_tools/
├── integration/
│   ├── test_orchestrator.py
│   └── test_pipeline.py
├── fixtures/
│   └── sample_states.py
├── conftest.py
└── pytest.ini
```

---

## 3. Test Configuration

### 3.1 conftest.py

```python
import pytest
import os
from unittest.mock import Mock, AsyncMock

# Set test environment variables
os.environ["ANTHROPIC_API_KEY"] = "test-key"
os.environ["OPENAI_API_KEY"] = "test-key"
os.environ["GROQ_API_KEY"] = "test-key"
os.environ["API_GATEWAY_URL"] = "http://localhost:8000"
os.environ["WS_GATEWAY_URL"] = "ws://localhost:8012"

@pytest.fixture
def mock_llm():
    """Mock LLM for testing"""
    llm = Mock()
    llm.invoke = Mock(return_value=Mock(content="test response"))
    llm.ainvoke = AsyncMock(return_value=Mock(content="test response"))
    return llm

@pytest.fixture
def sample_user_prompt():
    return "Build a task management app with user auth"

@pytest.fixture
def sample_project_id():
    return "test-project-123"
```

---

## 4. Unit Tests

### 4.1 PM Agent Tests (tests/unit/test_agents/test_pm_agent.py)

```python
import pytest
from src.agents.pm_agent import PMAgent
from src.orchestrator.state_schema import AgentState

@pytest.mark.asyncio
async def test_pm_agent_returns_output(sample_user_prompt, sample_project_id):
    """Test PM Agent returns valid output"""
    agent = PMAgent()
    state = AgentState(
        user_prompt=sample_user_prompt,
        project_id=sample_project_id
    )
    
    result = await agent.run(state)
    
    assert result.pm_output is not None
    assert result.pm_output.project_name is not None
    assert len(result.pm_output.requirements) > 0

@pytest.mark.asyncio
async def test_pm_agent_handles_empty_prompt():
    """Test PM Agent handles empty prompt"""
    agent = PMAgent()
    state = AgentState(user_prompt="", project_id="123")
    
    result = await agent.run(state)
    
    assert len(result.errors) > 0

@pytest.mark.asyncio
async def test_pm_agent_output_schema():
    """Test PM Agent output has correct schema"""
    agent = PMAgent()
    state = AgentState(user_prompt="Build a blog", project_id="123")
    
    result = await agent.run(state)
    
    # Verify all required fields
    assert hasattr(result.pm_output, 'project_name')
    assert hasattr(result.pm_output, 'description')
    assert hasattr(result.pm_output, 'requirements')
    assert hasattr(result.pm_output, 'target_users')
    assert hasattr(result.pm_output, 'success_metrics')
```

### 4.2 Architect Agent Tests

```python
import pytest
from src.agents.architect_agent import ArchitectAgent
from src.orchestrator.state_schema import AgentState, PMOutput

@pytest.mark.asyncio
async def test_architect_agent_requires_pm_output():
    """Test Architect Agent fails without PM output"""
    agent = ArchitectAgent()
    state = AgentState(user_prompt="test", project_id="123")
    
    result = await agent.run(state)
    
    assert len(result.errors) > 0
    assert "Missing PM output" in result.errors[0]

@pytest.mark.asyncio
async def test_architect_agent_output():
    """Test Architect Agent returns tech stack"""
    agent = ArchitectAgent()
    state = AgentState(
        user_prompt="Build a blog",
        project_id="123",
        pm_output=PMOutput(
            project_name="Test Blog",
            description="A blog",
            requirements=["Auth", "Posts"],
            target_users="Writers",
            success_metrics=["Posts created"]
        )
    )
    
    result = await agent.run(state)
    
    assert result.architect_output is not None
    assert len(result.architect_output.tech_stack) > 0
```

### 4.3 LLM Router Tests (tests/unit/test_llm_router.py)

```python
import pytest
from src.llm_router.cost_manager import CostManager, cost_manager

def test_get_tier_for_agent():
    """Test agent to tier mapping"""
    assert cost_manager.get_tier_for_agent("pm_agent") == "tier1"
    assert cost_manager.get_tier_for_agent("architect_agent") == "tier1"
    assert cost_manager.get_tier_for_agent("backend_agent") == "tier2"
    assert cost_manager.get_tier_for_agent("security_agent") == "tier3"

def test_estimate_cost_tier1():
    """Test cost estimation for Tier 1"""
    cost = cost_manager.estimate_cost("tier1", 1_000_000, 1_000_000)
    assert cost == 90.0  # $15 input + $75 output

def test_estimate_cost_tier2():
    """Test cost estimation for Tier 2"""
    cost = cost_manager.estimate_cost("tier2", 1_000_000, 1_000_000)
    assert cost == 1.5  # $0.25 input + $1.25 output

def test_estimate_cost_tier3():
    """Test cost estimation for Tier 3"""
    cost = cost_manager.estimate_cost("tier3", 1_000_000, 1_000_000)
    assert cost == 0.5  # $0.10 input + $0.40 output
```

---

## 5. Integration Tests

### 5.1 Orchestrator Tests (tests/integration/test_orchestrator.py)

```python
import pytest
from src.orchestrator.graph_builder import GraphBuilder
from src.orchestrator.state_schema import AgentState

@pytest.mark.asyncio
async def test_graph_compilation():
    """Test graph compiles successfully"""
    graph = GraphBuilder().compile()
    assert graph is not None

@pytest.mark.asyncio
async def test_graph_nodes():
    """Test all nodes are added"""
    builder = GraphBuilder()
    workflow = builder.build()
    
    # Verify nodes exist
    nodes = workflow.nodes
    assert "pm" in nodes
    assert "architect" in nodes
    assert "backend" in nodes
    assert "frontend" in nodes
    assert "devops" in nodes
    assert "qa" in nodes
    assert "security" in nodes

def test_should_continue_qa_passed():
    """Test QA continuation when tests pass"""
    from src.orchestrator.state_schema import QAOutput
    
    builder = GraphBuilder()
    state = AgentState(
        user_prompt="test",
        project_id="123",
        qa_output=QAOutput(
            tests_passed=True,
            test_results={},
            errors=[]
        )
    )
    
    result = builder.should_continue_qa(state)
    assert result == "end"

def test_should_continue_qa_failed():
    """Test QA continuation when tests fail"""
    from src.orchestrator.state_schema import QAOutput
    
    builder = GraphBuilder()
    state = AgentState(
        user_prompt="test",
        project_id="123",
        qa_output=QAOutput(
            tests_passed=False,
            test_results={"test1": False},
            errors=["Test failed"]
        ),
        iteration=0,
        max_iterations=3
    )
    
    result = builder.should_continue_qa(state)
    assert result == "retry"
    assert state.iteration == 1

def test_should_continue_qa_max_iterations():
    """Test QA stops at max iterations"""
    builder = GraphBuilder()
    state = AgentState(
        user_prompt="test",
        project_id="123",
        iteration=3,
        max_iterations=3
    )
    
    result = builder.should_continue_qa(state)
    assert result == "end"
```

---

## 6. Running Tests

### 6.1 pytest.ini

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short
```

### 6.2 Commands

```bash
# Run all tests
pytest

# Run unit tests only
pytest tests/unit/

# Run integration tests
pytest tests/integration/

# Run specific agent tests
pytest tests/unit/test_agents/test_pm_agent.py

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific test
pytest tests/unit/test_llm_router.py::test_get_tier_for_agent
```

---

## 7. Implementation Status

| Component | Status |
|-----------|--------|
| Test Configuration | ✅ Complete |
| PM Agent Tests | ✅ Complete |
| Architect Agent Tests | ✅ Complete |
| LLM Router Tests | ✅ Complete |
| Orchestrator Tests | ✅ Complete |
| Test Fixtures | ✅ Complete |

---

## 8. Key Implementation Notes

### 8.1 Test Strategy
- Unit tests for each agent
- Integration tests for orchestrator
- Mock LLM responses for fast testing

### 8.2 Async Testing
- Use `pytest-asyncio` for async tests
- Mark async tests with `@pytest.mark.asyncio`

### 8.3 Fixtures
- Reusable fixtures in `conftest.py`
- Mock LLM for deterministic tests
