"""Tests for Cost Aggregation functionality."""

import pytest
from datetime import datetime

from src.orchestrator.cost_aggregator import (
    CostAggregator,
    AgentCostRecord,
    WorkflowCostSummary,
    MODEL_PRICING,
    get_cost_aggregator,
    reset_cost_aggregator,
)


class TestAgentCostRecord:
    """Test suite for AgentCostRecord."""

    def test_creation(self):
        """Test record creation."""
        record = AgentCostRecord(
            agent_name="pm_agent",
            workflow_id="wf-123",
            timestamp="2024-01-01T00:00:00",
            model="claude-3-opus",
            input_tokens=1000,
            output_tokens=500,
            cached_tokens=800,
            input_cost=0.015,
            output_cost=0.0375,
            cache_savings=0.0108,
            total_cost=0.0525,
        )

        assert record.agent_name == "pm_agent"
        assert record.workflow_id == "wf-123"
        assert record.model == "claude-3-opus"
        assert record.input_tokens == 1000
        assert record.output_tokens == 500
        assert record.cached_tokens == 800

    def test_to_dict(self):
        """Test conversion to dictionary."""
        record = AgentCostRecord(
            agent_name="pm_agent",
            workflow_id="wf-123",
            timestamp="2024-01-01T00:00:00",
            model="claude-3-opus",
            input_tokens=1000,
            output_tokens=500,
            cached_tokens=0,
            input_cost=0.015,
            output_cost=0.0375,
            cache_savings=0.0,
            total_cost=0.0525,
        )

        d = record.to_dict()
        assert d["agent_name"] == "pm_agent"
        assert d["workflow_id"] == "wf-123"
        assert d["total_cost"] == 0.0525


class TestWorkflowCostSummary:
    """Test suite for WorkflowCostSummary."""

    def test_creation(self):
        """Test summary creation."""
        summary = WorkflowCostSummary(
            workflow_id="wf-123",
            started_at="2024-01-01T00:00:00",
        )

        assert summary.workflow_id == "wf-123"
        assert summary.status == "in_progress"
        assert summary.total_cost == 0.0

    def test_to_dict(self):
        """Test conversion to dictionary."""
        summary = WorkflowCostSummary(
            workflow_id="wf-123",
            started_at="2024-01-01T00:00:00",
            completed_at="2024-01-01T00:05:00",
            status="completed",
            total_input_tokens=5000,
            total_output_tokens=2000,
            total_cached_tokens=1000,
            total_cost=0.15,
            agent_costs={"pm_agent": 0.05, "architect_agent": 0.10},
        )

        d = summary.to_dict()
        assert d["workflow_id"] == "wf-123"
        assert d["status"] == "completed"
        assert d["tokens"]["input"] == 5000
        assert d["tokens"]["output"] == 2000
        assert d["costs"]["total"] == 0.15
        assert d["breakdown"]["by_agent"]["pm_agent"] == 0.05


class TestCostAggregator:
    """Test suite for CostAggregator."""

    def test_initialization(self):
        """Test aggregator initialization."""
        aggregator = CostAggregator()
        assert aggregator._workflow_summaries == {}

    def test_start_workflow(self):
        """Test starting a workflow."""
        aggregator = CostAggregator()
        summary = aggregator.start_workflow("wf-123")

        assert summary.workflow_id == "wf-123"
        assert summary.status == "in_progress"
        assert "wf-123" in aggregator._workflow_summaries

    def test_record_cost(self):
        """Test recording agent cost."""
        aggregator = CostAggregator()
        aggregator.start_workflow("wf-123")

        record = aggregator.record_cost(
            workflow_id="wf-123",
            agent_name="pm_agent",
            input_tokens=1000,
            output_tokens=500,
            cached_tokens=800,
            model="claude-3-opus",
        )

        assert record.agent_name == "pm_agent"
        assert record.input_tokens == 1000
        assert record.output_tokens == 500
        assert record.cached_tokens == 800
        assert record.total_cost > 0

        # Check summary updated
        summary = aggregator.get_workflow_summary("wf-123")
        assert summary.total_input_tokens == 1000
        assert summary.total_output_tokens == 500
        assert "pm_agent" in summary.agent_costs

    def test_record_cost_auto_start(self):
        """Test recording cost auto-starts workflow."""
        aggregator = CostAggregator()

        record = aggregator.record_cost(
            workflow_id="wf-auto",
            agent_name="pm_agent",
            input_tokens=1000,
            output_tokens=500,
            model="claude-3-sonnet",
        )

        assert record is not None
        assert aggregator.get_workflow_summary("wf-auto") is not None

    def test_cost_calculation_claude_opus(self):
        """Test cost calculation for Claude Opus."""
        aggregator = CostAggregator()
        aggregator.start_workflow("wf-123")

        record = aggregator.record_cost(
            workflow_id="wf-123",
            agent_name="pm_agent",
            input_tokens=1_000_000,  # 1M tokens
            output_tokens=500_000,   # 500K tokens
            model="claude-3-opus",
        )

        # Expected: input $15, output $37.50 = $52.50
        assert record.input_cost == 15.0
        assert record.output_cost == 37.5
        assert record.total_cost == 52.5

    def test_cost_calculation_claude_sonnet(self):
        """Test cost calculation for Claude Sonnet."""
        aggregator = CostAggregator()
        aggregator.start_workflow("wf-123")

        record = aggregator.record_cost(
            workflow_id="wf-123",
            agent_name="backend_agent",
            input_tokens=1_000_000,
            output_tokens=500_000,
            model="claude-3-sonnet",
        )

        # Expected: input $3, output $7.50 = $10.50
        assert record.input_cost == 3.0
        assert record.output_cost == 7.5
        assert record.total_cost == 10.5

    def test_cache_savings_calculation(self):
        """Test cache savings calculation."""
        aggregator = CostAggregator()
        aggregator.start_workflow("wf-123")

        record = aggregator.record_cost(
            workflow_id="wf-123",
            agent_name="pm_agent",
            input_tokens=1_000_000,
            output_tokens=500_000,
            cached_tokens=800_000,  # 80% cached
            model="claude-3-opus",
        )

        # Cache savings: 800K tokens at 90% discount
        # Regular: 800K * $15/1M = $12
        # Cached: 800K * $1.50/1M = $1.20
        # Savings: $12 - $1.20 = $10.80
        assert record.cache_savings > 0
        assert record.cache_savings == pytest.approx(10.8, rel=0.01)

    def test_multiple_agents(self):
        """Test recording costs for multiple agents."""
        aggregator = CostAggregator()
        aggregator.start_workflow("wf-123")

        # Record costs for multiple agents
        aggregator.record_cost("wf-123", "pm_agent", 1000, 500, model="claude-3-opus")
        aggregator.record_cost("wf-123", "architect_agent", 2000, 1000, model="claude-3-opus")
        aggregator.record_cost("wf-123", "backend_agent", 3000, 1500, model="claude-3-sonnet")

        summary = aggregator.get_workflow_summary("wf-123")

        assert len(summary.agent_costs) == 3
        assert "pm_agent" in summary.agent_costs
        assert "architect_agent" in summary.agent_costs
        assert "backend_agent" in summary.agent_costs

        # Total tokens
        assert summary.total_input_tokens == 6000
        assert summary.total_output_tokens == 3000

    def test_complete_workflow(self):
        """Test completing a workflow."""
        aggregator = CostAggregator()
        aggregator.start_workflow("wf-123")

        aggregator.record_cost("wf-123", "pm_agent", 1000, 500, model="claude-3-opus")

        summary = aggregator.complete_workflow("wf-123", "completed")

        assert summary is not None
        assert summary.status == "completed"
        assert summary.completed_at is not None

    def test_get_all_workflows(self):
        """Test getting all workflows."""
        aggregator = CostAggregator()

        aggregator.start_workflow("wf-1")
        aggregator.start_workflow("wf-2")
        aggregator.start_workflow("wf-3")

        workflows = aggregator.get_all_workflows()
        assert len(workflows) == 3

    def test_get_total_costs(self):
        """Test getting total costs across workflows."""
        aggregator = CostAggregator()

        aggregator.start_workflow("wf-1")
        aggregator.record_cost("wf-1", "pm_agent", 1000, 500, model="claude-3-opus")

        aggregator.start_workflow("wf-2")
        aggregator.record_cost("wf-2", "backend_agent", 2000, 1000, model="claude-3-sonnet")

        totals = aggregator.get_total_costs()

        assert totals["total_workflows"] == 2
        assert totals["tokens"]["input"] == 3000
        assert totals["tokens"]["output"] == 1500
        assert totals["costs"]["total"] > 0

    def test_estimate_cost(self):
        """Test cost estimation."""
        aggregator = CostAggregator()

        estimate = aggregator.estimate_cost(
            input_tokens=1_000_000,
            output_tokens=500_000,
            model="claude-3-opus",
        )

        assert estimate["input_cost"] == 15.0
        assert estimate["output_cost"] == 37.5
        assert estimate["total_cost"] == 52.5

    def test_estimate_cost_with_cache(self):
        """Test cost estimation with cache ratio."""
        aggregator = CostAggregator()

        estimate = aggregator.estimate_cost(
            input_tokens=1_000_000,
            output_tokens=500_000,
            model="claude-3-opus",
            cache_ratio=0.8,  # 80% cached
        )

        # 80% of input cached
        assert estimate["cache_savings"] > 0
        assert estimate["total_cost"] < estimate["cost_without_cache"]

    def test_clear_workflow(self):
        """Test clearing a workflow."""
        aggregator = CostAggregator()
        aggregator.start_workflow("wf-123")

        success = aggregator.clear_workflow("wf-123")
        assert success is True
        assert aggregator.get_workflow_summary("wf-123") is None

    def test_clear_all(self):
        """Test clearing all workflows."""
        aggregator = CostAggregator()

        aggregator.start_workflow("wf-1")
        aggregator.start_workflow("wf-2")

        count = aggregator.clear_all()
        assert count == 2
        assert len(aggregator.get_all_workflows()) == 0

    def test_model_breakdown(self):
        """Test model cost breakdown."""
        aggregator = CostAggregator()
        aggregator.start_workflow("wf-123")

        aggregator.record_cost("wf-123", "pm_agent", 1000, 500, model="claude-3-opus")
        aggregator.record_cost("wf-123", "backend_agent", 2000, 1000, model="claude-3-sonnet")

        summary = aggregator.get_workflow_summary("wf-123")

        assert "claude-3-opus" in summary.model_costs
        assert "claude-3-sonnet" in summary.model_costs

    def test_failed_execution(self):
        """Test recording failed execution."""
        aggregator = CostAggregator()
        aggregator.start_workflow("wf-123")

        record = aggregator.record_cost(
            workflow_id="wf-123",
            agent_name="pm_agent",
            input_tokens=1000,
            output_tokens=500,
            model="claude-3-opus",
            success=False,
            error="API timeout",
        )

        assert record.success is False
        assert record.error == "API timeout"


class TestModelPricing:
    """Test suite for model pricing data."""

    def test_pricing_exists(self):
        """Test that pricing exists for all models."""
        assert "claude-3-opus" in MODEL_PRICING
        assert "claude-3-sonnet" in MODEL_PRICING
        assert "claude-3-haiku" in MODEL_PRICING
        assert "llama-3.1-70b" in MODEL_PRICING

    def test_pricing_structure(self):
        """Test pricing structure."""
        opus = MODEL_PRICING["claude-3-opus"]
        assert "input" in opus
        assert "output" in opus
        assert "cache_write" in opus
        assert "cache_read" in opus


class TestGlobalAggregator:
    """Test suite for global aggregator functions."""

    def test_get_cost_aggregator(self):
        """Test getting global aggregator."""
        reset_cost_aggregator()
        aggregator1 = get_cost_aggregator()
        assert aggregator1 is not None

        aggregator2 = get_cost_aggregator()
        assert aggregator1 is aggregator2  # Same instance

    def test_reset_cost_aggregator(self):
        """Test resetting global aggregator."""
        reset_cost_aggregator()
        aggregator = get_cost_aggregator()
        assert aggregator is not None
