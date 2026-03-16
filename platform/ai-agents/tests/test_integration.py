"""Integration tests for Parallel Execution and Validation with GraphBuilder."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.orchestrator.graph_builder import GraphBuilder
from src.orchestrator.state_schema import AgentState
from src.orchestrator.streaming import EventEmitter, StreamEvent, EventType
from src.orchestrator.parallel_execution import (
    ParallelExecutor,
    Task,
    TaskGroup,
    ExecutionPriority,
    ExecutionStatus,
    get_parallel_executor,
    reset_parallel_executor,
)
from src.orchestrator.schema_validation import (
    ValidationMiddleware,
    ValidationResult,
    ValidationStatus,
    get_validation_middleware,
    reset_validation_middleware,
)


class TestGraphBuilderIntegration:
    """Integration tests for GraphBuilder with parallel execution and validation."""

    def test_graph_builder_initialization(self):
        """Test GraphBuilder initializes with all components."""
        builder = GraphBuilder()

        assert builder.parallel_executor is not None
        assert builder.validation is not None
        assert builder.cost_aggregator is not None
        assert builder.human_manager is not None
        assert builder.ENABLE_PARALLEL_EXECUTION is True
        assert builder.ENABLE_SCHEMA_VALIDATION is True

    def test_graph_builder_with_custom_components(self):
        """Test GraphBuilder with custom components."""
        emitter = EventEmitter()
        parallel_executor = ParallelExecutor(max_concurrent=5)
        validation = ValidationMiddleware(strict_mode=False)

        builder = GraphBuilder(
            emitter=emitter,
            parallel_executor=parallel_executor,
            validation_middleware=validation,
        )

        assert builder.parallel_executor is parallel_executor
        assert builder.validation is validation

    def test_build_with_parallel_execution_enabled(self):
        """Test workflow builds with parallel execution node."""
        builder = GraphBuilder()
        workflow = builder.build()

        # Check that parallel_phase node exists
        node_names = [node for node in workflow.nodes]
        assert "parallel_phase" in node_names
        assert "backend" not in node_names  # Individual nodes not added when parallel enabled

    def test_build_with_parallel_execution_disabled(self):
        """Test workflow builds with individual agent nodes when parallel disabled."""
        builder = GraphBuilder()
        builder.ENABLE_PARALLEL_EXECUTION = False
        workflow = builder.build()

        # Check that individual nodes exist
        node_names = [node for node in workflow.nodes]
        assert "parallel_phase" not in node_names
        assert "backend" in node_names
        assert "frontend" in node_names
        assert "devops" in node_names

    def test_compile_workflow(self):
        """Test workflow compiles successfully."""
        builder = GraphBuilder()
        graph = builder.compile()

        assert graph is not None

    @pytest.mark.asyncio
    async def test_validate_output_pm_agent(self):
        """Test validation is called for PM agent output."""
        builder = GraphBuilder()

        # Create mock PM output
        pm_output = MagicMock()
        pm_output.model_dump.return_value = {
            "project_name": "Test Project",
            "description": "Test description",
            "requirements": ["req1", "req2"],
        }

        # Validate output
        result = await builder._validate_output("pm_agent", pm_output)

        assert result is not None
        assert isinstance(result, ValidationResult)

    @pytest.mark.asyncio
    async def test_validate_output_architect_agent(self):
        """Test validation is called for Architect agent output."""
        builder = GraphBuilder()

        architect_output = MagicMock()
        architect_output.model_dump.return_value = {
            "tech_stack": ["Python", "FastAPI"],
            "db_schema": "test_schema",
            "api_design": "REST",
            "files_to_create": [],
        }

        result = await builder._validate_output("architect_agent", architect_output)

        assert result is not None

    @pytest.mark.asyncio
    async def test_run_parallel_phase_success(self):
        """Test parallel phase execution with successful agents."""
        builder = GraphBuilder()
        state = AgentState(user_prompt="Test prompt", project_id="test-project")

        # Mock agent run methods
        async def mock_backend_run(s):
            return {"backend_output": {"files": {"main.py": "code"}}, "cost_sofar": 0.01}

        async def mock_frontend_run(s):
            return {"frontend_output": {"files": {"App.tsx": "code"}}, "cost_sofar": 0.01}

        async def mock_devops_run(s):
            return {"devops_output": {"files": {"Dockerfile": "code"}}, "cost_sofar": 0.01}

        builder.backend.run = mock_backend_run
        builder.frontend.run = mock_frontend_run
        builder.devops.run = mock_devops_run

        # Run parallel phase
        result = await builder._run_parallel_phase(state)

        assert "backend_output" in result
        assert "frontend_output" in result
        assert "devops_output" in result
        assert "cost_sofar" in result

    @pytest.mark.asyncio
    async def test_run_parallel_phase_with_errors(self):
        """Test parallel phase handles agent errors."""
        builder = GraphBuilder()
        state = AgentState(user_prompt="Test prompt", project_id="test-project")

        # Mock agents with one failing
        async def mock_backend_run(s):
            raise ValueError("Backend failed")

        async def mock_frontend_run(s):
            return {"frontend_output": {"files": {}}, "cost_sofar": 0.01}

        async def mock_devops_run(s):
            return {"devops_output": {"files": {}}, "cost_sofar": 0.01}

        builder.backend.run = mock_backend_run
        builder.frontend.run = mock_frontend_run
        builder.devops.run = mock_devops_run

        # Run parallel phase
        result = await builder._run_parallel_phase(state)

        # Should have errors from backend
        assert "errors" in result or "backend" in result.get("errors", {})

    @pytest.mark.asyncio
    async def test_run_pm_with_validation(self):
        """Test PM agent run includes validation."""
        emitter = EventEmitter()
        builder = GraphBuilder(emitter=emitter)
        state = AgentState(user_prompt="Test prompt", project_id="test-project")

        # Mock PM agent
        async def mock_pm_run(s):
            return {
                "pm_output": MagicMock(
                    model_dump=MagicMock(return_value={
                        "project_name": "Test",
                        "description": "Test",
                        "requirements": ["r1"],
                    })
                ),
                "cost_sofar": 0.01,
            }

        builder.pm.run = mock_pm_run

        result = await builder._run_pm(state)

        assert result is not None
        # Validation should have been attempted

    @pytest.mark.asyncio
    async def test_run_architect_with_validation(self):
        """Test Architect agent run includes validation."""
        emitter = EventEmitter()
        builder = GraphBuilder(emitter=emitter)
        state = AgentState(user_prompt="Test prompt", project_id="test-project")

        # Mock architect agent
        async def mock_architect_run(s):
            return {
                "architect_output": MagicMock(
                    model_dump=MagicMock(return_value={
                        "tech_stack": ["Python"],
                        "db_schema": "schema",
                        "api_design": "REST",
                        "files_to_create": [],
                    })
                ),
                "cost_sofar": 0.01,
            }

        builder.architect.run = mock_architect_run

        result = await builder._run_architect(state)

        assert result is not None


class TestStreamingIntegration:
    """Integration tests for streaming events."""

    @pytest.mark.asyncio
    async def test_parallel_phase_emits_events(self):
        """Test parallel phase emits streaming events."""
        events = []
        emitter = EventEmitter()

        # Capture events by overriding emit
        original_emit = emitter.emit
        async def capture_emit(event):
            events.append(event)
            await original_emit(event)
        emitter.emit = capture_emit

        builder = GraphBuilder(emitter=emitter)
        state = AgentState(user_prompt="Test", project_id="test-project")

        # Mock agents
        builder.backend.run = AsyncMock(return_value={"backend_output": {}, "cost_sofar": 0})
        builder.frontend.run = AsyncMock(return_value={"frontend_output": {}, "cost_sofar": 0})
        builder.devops.run = AsyncMock(return_value={"devops_output": {}, "cost_sofar": 0})

        await builder._run_parallel_phase(state)

        # Check for parallel events
        event_types = [e.event_type for e in events]
        assert EventType.PARALLEL_START in event_types
        assert EventType.PARALLEL_COMPLETE in event_types

    @pytest.mark.asyncio
    async def test_agent_complete_emits_validation_events(self):
        """Test agent completion emits validation events."""
        events = []
        emitter = EventEmitter()

        # Capture events by overriding emit
        original_emit = emitter.emit
        async def capture_emit(event):
            events.append(event)
            await original_emit(event)
        emitter.emit = capture_emit

        builder = GraphBuilder(emitter=emitter)
        state = AgentState(user_prompt="Test", project_id="test-project")

        # Mock PM agent with valid output
        builder.pm.run = AsyncMock(return_value={
            "pm_output": MagicMock(
                model_dump=MagicMock(return_value={
                    "project_name": "Test",
                    "description": "Test",
                    "requirements": ["r1"],
                })
            ),
            "cost_sofar": 0.01,
        })

        await builder._run_pm(state)

        # Check for agent events
        event_types = [e.event_type for e in events]
        assert EventType.AGENT_START in event_types
        assert EventType.AGENT_COMPLETE in event_types


class TestCostAggregationIntegration:
    """Integration tests for cost aggregation with parallel execution."""

    @pytest.mark.asyncio
    async def test_parallel_phase_records_costs(self):
        """Test parallel phase records costs for all agents."""
        builder = GraphBuilder()
        state = AgentState(user_prompt="Test", project_id="test-project")

        # Mock agents with cache stats
        builder.backend.run = AsyncMock(return_value={
            "backend_output": {},
            "cost_sofar": 0.05,
            "cache_stats": {"input_tokens": 100, "output_tokens": 50, "cached_tokens": 20},
        })
        builder.frontend.run = AsyncMock(return_value={
            "frontend_output": {},
            "cost_sofar": 0.05,
            "cache_stats": {"input_tokens": 100, "output_tokens": 50, "cached_tokens": 20},
        })
        builder.devops.run = AsyncMock(return_value={
            "devops_output": {},
            "cost_sofar": 0.05,
            "cache_stats": {"input_tokens": 100, "output_tokens": 50, "cached_tokens": 20},
        })

        await builder._run_parallel_phase(state)

        # Check cost summary
        summary = builder.get_cost_summary()
        assert summary is not None

    def test_get_cost_summary_returns_dict(self):
        """Test get_cost_summary returns a dictionary."""
        builder = GraphBuilder()

        summary = builder.get_cost_summary()

        assert isinstance(summary, dict)
        assert "workflow_id" in summary


class TestFeatureFlags:
    """Test feature flag behavior."""

    def test_parallel_execution_flag(self):
        """Test ENABLE_PARALLEL_EXECUTION flag."""
        builder = GraphBuilder()
        assert builder.ENABLE_PARALLEL_EXECUTION is True

        builder.ENABLE_PARALLEL_EXECUTION = False
        assert builder.ENABLE_PARALLEL_EXECUTION is False

    def test_schema_validation_flag(self):
        """Test ENABLE_SCHEMA_VALIDATION flag."""
        builder = GraphBuilder()
        assert builder.ENABLE_SCHEMA_VALIDATION is True

        builder.ENABLE_SCHEMA_VALIDATION = False
        assert builder.ENABLE_SCHEMA_VALIDATION is False

    @pytest.mark.asyncio
    async def test_validation_disabled_skips_validation(self):
        """Test that disabled validation skips validation calls."""
        builder = GraphBuilder()
        builder.ENABLE_SCHEMA_VALIDATION = False
        state = AgentState(user_prompt="Test", project_id="test-project")

        # Mock PM agent
        builder.pm.run = AsyncMock(return_value={
            "pm_output": MagicMock(),
            "cost_sofar": 0.01,
        })

        result = await builder._run_pm(state)

        # Should not have validation_errors key
        assert "validation_errors" not in result


class TestGlobalInstances:
    """Test global instance management."""

    def test_get_parallel_executor_returns_singleton(self):
        """Test get_parallel_executor returns same instance."""
        reset_parallel_executor()
        executor1 = get_parallel_executor()
        executor2 = get_parallel_executor()

        assert executor1 is executor2

    def test_reset_parallel_executor_creates_new(self):
        """Test reset creates new instance."""
        reset_parallel_executor()
        executor1 = get_parallel_executor()

        reset_parallel_executor()
        executor2 = get_parallel_executor()

        # Should be different instances after reset
        assert executor1 is not executor2

    def test_get_validation_middleware_returns_singleton(self):
        """Test get_validation_middleware returns same instance."""
        reset_validation_middleware()
        middleware1 = get_validation_middleware()
        middleware2 = get_validation_middleware()

        assert middleware1 is middleware2

    def test_reset_validation_middleware_creates_new(self):
        """Test reset creates new validation middleware instance."""
        reset_validation_middleware()
        middleware1 = get_validation_middleware()

        reset_validation_middleware()
        middleware2 = get_validation_middleware()

        assert middleware1 is not middleware2
