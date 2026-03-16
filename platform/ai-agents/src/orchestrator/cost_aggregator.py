"""Cost Aggregator for tracking total costs across all agents in a session.

This module provides comprehensive cost tracking:
- Per-agent cost breakdown
- Per-workflow session costs
- Cache savings tracking
- Token usage statistics
- Cost estimation and budgeting

Usage:
    from src.orchestrator.cost_aggregator import CostAggregator, get_cost_aggregator

    aggregator = get_cost_aggregator()

    # Record agent cost
    aggregator.record_cost(
        workflow_id="wf-123",
        agent_name="pm_agent",
        input_tokens=1000,
        output_tokens=500,
        cached_tokens=800,
        model="claude-3-opus",
    )

    # Get session summary
    summary = aggregator.get_session_summary("wf-123")
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pathlib import Path
import os


# Model pricing (per 1M tokens)
MODEL_PRICING = {
    # Anthropic
    "claude-3-opus": {"input": 15.0, "output": 75.0, "cache_write": 18.75, "cache_read": 1.50},
    "claude-3-sonnet": {"input": 3.0, "output": 15.0, "cache_write": 3.75, "cache_read": 0.30},
    "claude-3-haiku": {"input": 0.25, "output": 1.25, "cache_write": 0.30, "cache_read": 0.03},
    "claude-3.5-sonnet": {"input": 3.0, "output": 15.0, "cache_write": 3.75, "cache_read": 0.30},
    # Groq
    "llama-3.1-70b": {"input": 0.59, "output": 0.79, "cache_write": 0.0, "cache_read": 0.0},
    "llama-3.1-8b": {"input": 0.05, "output": 0.08, "cache_write": 0.0, "cache_read": 0.0},
    "mixtral-8x7b": {"input": 0.24, "output": 0.24, "cache_write": 0.0, "cache_read": 0.0},
    # OpenAI
    "gpt-4o": {"input": 5.0, "output": 15.0, "cache_write": 0.0, "cache_read": 0.0},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60, "cache_write": 0.0, "cache_read": 0.0},
}


@dataclass
class AgentCostRecord:
    """Cost record for a single agent execution."""

    agent_name: str
    workflow_id: str
    timestamp: str
    model: str
    input_tokens: int
    output_tokens: int
    cached_tokens: int = 0
    input_cost: float = 0.0
    output_cost: float = 0.0
    cache_savings: float = 0.0
    total_cost: float = 0.0
    success: bool = True
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


@dataclass
class WorkflowCostSummary:
    """Cost summary for a workflow session."""

    workflow_id: str
    started_at: str
    completed_at: Optional[str] = None
    status: str = "in_progress"

    # Token counts
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cached_tokens: int = 0

    # Costs
    total_input_cost: float = 0.0
    total_output_cost: float = 0.0
    total_cache_savings: float = 0.0
    total_cost: float = 0.0

    # Per-agent breakdown
    agent_costs: Dict[str, float] = field(default_factory=dict)
    agent_tokens: Dict[str, Dict[str, int]] = field(default_factory=dict)

    # Model breakdown
    model_costs: Dict[str, float] = field(default_factory=dict)

    # Records
    records: List[AgentCostRecord] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "workflow_id": self.workflow_id,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "status": self.status,
            "tokens": {
                "input": self.total_input_tokens,
                "output": self.total_output_tokens,
                "cached": self.total_cached_tokens,
                "total": self.total_input_tokens + self.total_output_tokens,
            },
            "costs": {
                "input": self.total_input_cost,
                "output": self.total_output_cost,
                "cache_savings": self.total_cache_savings,
                "total": self.total_cost,
                "without_cache": self.total_cost + self.total_cache_savings,
            },
            "breakdown": {
                "by_agent": self.agent_costs,
                "by_model": self.model_costs,
            },
            "agent_tokens": self.agent_tokens,
        }


class CostAggregator:
    """Aggregates and tracks costs across all agents in a session.

    Features:
    - Real-time cost tracking per workflow
    - Per-agent cost breakdown
    - Cache savings calculation
    - Token usage statistics
    - Cost estimation for budgeting
    - Persistent cost history (optional)

    Usage:
        aggregator = CostAggregator()

        # Start a workflow session
        aggregator.start_workflow("wf-123")

        # Record agent costs
        aggregator.record_cost(
            workflow_id="wf-123",
            agent_name="pm_agent",
            input_tokens=1000,
            output_tokens=500,
            cached_tokens=800,
            model="claude-3-opus",
        )

        # Complete workflow
        aggregator.complete_workflow("wf-123")

        # Get summary
        summary = aggregator.get_workflow_summary("wf-123")
    """

    def __init__(self, persist_dir: Optional[str] = None):
        """Initialize cost aggregator.

        Args:
            persist_dir: Optional directory to persist cost history
        """
        self._workflow_summaries: Dict[str, WorkflowCostSummary] = {}
        self._persist_dir = Path(persist_dir) if persist_dir else None

        if self._persist_dir:
            self._persist_dir.mkdir(parents=True, exist_ok=True)

    def start_workflow(self, workflow_id: str) -> WorkflowCostSummary:
        """Start tracking a new workflow session.

        Args:
            workflow_id: Unique workflow identifier

        Returns:
            New workflow cost summary
        """
        summary = WorkflowCostSummary(
            workflow_id=workflow_id,
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        self._workflow_summaries[workflow_id] = summary
        return summary

    def record_cost(
        self,
        workflow_id: str,
        agent_name: str,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int = 0,
        model: str = "claude-3-sonnet",
        success: bool = True,
        error: Optional[str] = None,
    ) -> AgentCostRecord:
        """Record cost for an agent execution.

        Args:
            workflow_id: Workflow identifier
            agent_name: Name of the agent
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            cached_tokens: Number of cached tokens (for cache savings)
            model: Model used for this execution
            success: Whether the execution succeeded
            error: Error message if failed

        Returns:
            The created cost record
        """
        # Get or create workflow summary
        if workflow_id not in self._workflow_summaries:
            self.start_workflow(workflow_id)

        summary = self._workflow_summaries[workflow_id]

        # Calculate costs
        pricing = MODEL_PRICING.get(model, MODEL_PRICING["claude-3-sonnet"])

        input_cost = (input_tokens / 1_000_000) * pricing["input"]
        output_cost = (output_tokens / 1_000_000) * pricing["output"]

        # Cache savings: cached tokens cost 10% of regular input
        if cached_tokens > 0:
            regular_cost = (cached_tokens / 1_000_000) * pricing["input"]
            cache_cost = (cached_tokens / 1_000_000) * pricing.get("cache_read", pricing["input"] * 0.1)
            cache_savings = regular_cost - cache_cost
        else:
            cache_savings = 0.0

        total_cost = input_cost + output_cost

        # Create record
        record = AgentCostRecord(
            agent_name=agent_name,
            workflow_id=workflow_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_tokens=cached_tokens,
            input_cost=input_cost,
            output_cost=output_cost,
            cache_savings=cache_savings,
            total_cost=total_cost,
            success=success,
            error=error,
        )

        # Update summary
        summary.records.append(record)
        summary.total_input_tokens += input_tokens
        summary.total_output_tokens += output_tokens
        summary.total_cached_tokens += cached_tokens
        summary.total_input_cost += input_cost
        summary.total_output_cost += output_cost
        summary.total_cache_savings += cache_savings
        summary.total_cost += total_cost

        # Update agent breakdown
        if agent_name not in summary.agent_costs:
            summary.agent_costs[agent_name] = 0.0
            summary.agent_tokens[agent_name] = {"input": 0, "output": 0, "cached": 0}

        summary.agent_costs[agent_name] += total_cost
        summary.agent_tokens[agent_name]["input"] += input_tokens
        summary.agent_tokens[agent_name]["output"] += output_tokens
        summary.agent_tokens[agent_name]["cached"] += cached_tokens

        # Update model breakdown
        if model not in summary.model_costs:
            summary.model_costs[model] = 0.0
        summary.model_costs[model] += total_cost

        # Persist if configured
        if self._persist_dir:
            self._persist_record(record)

        return record

    def complete_workflow(
        self,
        workflow_id: str,
        status: str = "completed",
    ) -> Optional[WorkflowCostSummary]:
        """Mark workflow as completed.

        Args:
            workflow_id: Workflow identifier
            status: Final status (completed, failed, aborted)

        Returns:
            Completed workflow summary
        """
        if workflow_id not in self._workflow_summaries:
            return None

        summary = self._workflow_summaries[workflow_id]
        summary.completed_at = datetime.now(timezone.utc).isoformat()
        summary.status = status

        # Persist summary if configured
        if self._persist_dir:
            self._persist_summary(summary)

        return summary

    def get_workflow_summary(self, workflow_id: str) -> Optional[WorkflowCostSummary]:
        """Get cost summary for a workflow.

        Args:
            workflow_id: Workflow identifier

        Returns:
            Workflow cost summary or None if not found
        """
        return self._workflow_summaries.get(workflow_id)

    def get_all_workflows(self) -> List[WorkflowCostSummary]:
        """Get all workflow summaries."""
        return list(self._workflow_summaries.values())

    def get_total_costs(self) -> Dict[str, Any]:
        """Get total costs across all workflows.

        Returns:
            Aggregated cost statistics
        """
        total_input_tokens = 0
        total_output_tokens = 0
        total_cached_tokens = 0
        total_cost = 0.0
        total_cache_savings = 0.0
        agent_totals: Dict[str, float] = {}
        model_totals: Dict[str, float] = {}

        for summary in self._workflow_summaries.values():
            total_input_tokens += summary.total_input_tokens
            total_output_tokens += summary.total_output_tokens
            total_cached_tokens += summary.total_cached_tokens
            total_cost += summary.total_cost
            total_cache_savings += summary.total_cache_savings

            for agent, cost in summary.agent_costs.items():
                agent_totals[agent] = agent_totals.get(agent, 0.0) + cost

            for model, cost in summary.model_costs.items():
                model_totals[model] = model_totals.get(model, 0.0) + cost

        return {
            "total_workflows": len(self._workflow_summaries),
            "tokens": {
                "input": total_input_tokens,
                "output": total_output_tokens,
                "cached": total_cached_tokens,
                "total": total_input_tokens + total_output_tokens,
            },
            "costs": {
                "total": total_cost,
                "cache_savings": total_cache_savings,
                "with_cache_savings": total_cost + total_cache_savings,
            },
            "by_agent": agent_totals,
            "by_model": model_totals,
        }

    def estimate_cost(
        self,
        input_tokens: int,
        output_tokens: int,
        model: str = "claude-3-sonnet",
        cache_ratio: float = 0.0,
    ) -> Dict[str, float]:
        """Estimate cost for a planned execution.

        Args:
            input_tokens: Estimated input tokens
            output_tokens: Estimated output tokens
            model: Model to use
            cache_ratio: Ratio of input that will be cached (0.0 to 1.0)

        Returns:
            Cost estimate breakdown
        """
        pricing = MODEL_PRICING.get(model, MODEL_PRICING["claude-3-sonnet"])

        cached_tokens = int(input_tokens * cache_ratio)
        uncached_tokens = input_tokens - cached_tokens

        input_cost = (uncached_tokens / 1_000_000) * pricing["input"]
        output_cost = (output_tokens / 1_000_000) * pricing["output"]

        if cached_tokens > 0:
            cache_cost = (cached_tokens / 1_000_000) * pricing.get("cache_read", pricing["input"] * 0.1)
            cache_savings = (cached_tokens / 1_000_000) * pricing["input"] - cache_cost
        else:
            cache_cost = 0.0
            cache_savings = 0.0

        total_cost = input_cost + output_cost + cache_cost

        return {
            "input_cost": input_cost,
            "output_cost": output_cost,
            "cache_cost": cache_cost,
            "cache_savings": cache_savings,
            "total_cost": total_cost,
            "cost_without_cache": input_cost + output_cost + (cached_tokens / 1_000_000) * pricing["input"],
        }

    def clear_workflow(self, workflow_id: str) -> bool:
        """Clear a workflow from memory.

        Args:
            workflow_id: Workflow identifier

        Returns:
            True if cleared, False if not found
        """
        if workflow_id in self._workflow_summaries:
            del self._workflow_summaries[workflow_id]
            return True
        return False

    def clear_all(self) -> int:
        """Clear all workflows from memory.

        Returns:
            Number of workflows cleared
        """
        count = len(self._workflow_summaries)
        self._workflow_summaries.clear()
        return count

    def _persist_record(self, record: AgentCostRecord) -> None:
        """Persist cost record to disk."""
        if not self._persist_dir:
            return

        file_path = self._persist_dir / f"{record.workflow_id}_records.jsonl"
        with open(file_path, "a") as f:
            f.write(json.dumps(record.to_dict()) + "\n")

    def _persist_summary(self, summary: WorkflowCostSummary) -> None:
        """Persist workflow summary to disk."""
        if not self._persist_dir:
            return

        file_path = self._persist_dir / f"{summary.workflow_id}_summary.json"
        with open(file_path, "w") as f:
            json.dump(summary.to_dict(), f, indent=2)


# Global instance
_global_aggregator: Optional[CostAggregator] = None


def get_cost_aggregator(persist_dir: Optional[str] = None) -> CostAggregator:
    """Get or create global cost aggregator instance.

    Args:
        persist_dir: Optional directory for persistence

    Returns:
        Global CostAggregator instance
    """
    global _global_aggregator
    if _global_aggregator is None:
        _global_aggregator = CostAggregator(persist_dir)
    return _global_aggregator


def reset_cost_aggregator() -> None:
    """Reset global aggregator (for testing)."""
    global _global_aggregator
    _global_aggregator = None
