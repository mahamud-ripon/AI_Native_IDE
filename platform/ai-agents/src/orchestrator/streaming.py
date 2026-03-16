"""Server-Sent Events (SSE) streaming for real-time agent progress.

This module provides streaming capabilities to send real-time updates
from agents to the frontend during workflow execution.

Usage:
    from src.orchestrator.streaming import EventEmitter, StreamEvent

    emitter = EventEmitter()
    await emitter.emit(StreamEvent.agent_start("pm_agent", "Analyzing requirements..."))
    await emitter.emit(StreamEvent.agent_progress("pm_agent", 50, "Processing features..."))
    await emitter.emit(StreamEvent.agent_complete("pm_agent", result))
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, AsyncIterator, Callable, Dict, List, Optional, Union


class EventType(str, Enum):
    """Types of streaming events."""

    # Workflow lifecycle
    WORKFLOW_START = "workflow_start"
    WORKFLOW_COMPLETE = "workflow_complete"
    WORKFLOW_ERROR = "workflow_error"

    # Agent lifecycle
    AGENT_START = "agent_start"
    AGENT_PROGRESS = "agent_progress"
    AGENT_COMPLETE = "agent_complete"
    AGENT_ERROR = "agent_error"
    AGENT_RETRY = "agent_retry"

    # Token streaming
    TOKEN = "token"
    TOKEN_START = "token_start"
    TOKEN_END = "token_end"

    # Cost tracking
    COST_UPDATE = "cost_update"
    CACHE_HIT = "cache_hit"

    # Human-in-the-loop
    HUMAN_INPUT_REQUIRED = "human_input_required"
    HUMAN_INPUT_RECEIVED = "human_input_received"

    # AI Patch System
    AI_PATCH_PROPOSED = "ai_patch_proposed"
    AI_PATCH_ACCEPTED = "ai_patch_accepted"
    AI_PATCH_REJECTED = "ai_patch_rejected"

    # Schema Validation
    VALIDATION_PASSED = "validation_passed"
    VALIDATION_FAILED = "validation_failed"

    # Parallel Execution
    PARALLEL_START = "parallel_start"
    PARALLEL_PROGRESS = "parallel_progress"
    PARALLEL_COMPLETE = "parallel_complete"
    PARALLEL_ERROR = "parallel_error"
    DEADLOCK_DETECTED = "deadlock_detected"


@dataclass
class StreamEvent:
    """A single streaming event."""

    event_type: EventType
    agent_name: Optional[str] = None
    message: str = ""
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_sse(self) -> str:
        """Convert to SSE format string.

        SSE format:
        event: <event_type>
        id: <event_id>
        data: <json_data>

        Returns:
            SSE formatted string
        """
        payload = {
            "event_type": self.event_type.value,
            "agent_name": self.agent_name,
            "message": self.message,
            "data": self.data,
            "timestamp": self.timestamp,
            "event_id": self.event_id,
        }
        lines = [
            f"event: {self.event_type.value}",
            f"id: {self.event_id}",
            f"data: {json.dumps(payload)}",
            "",  # Empty line to end event
        ]
        return "\n".join(lines)

    def to_json(self) -> str:
        """Convert to JSON string."""
        return json.dumps({
            "event_type": self.event_type.value,
            "agent_name": self.agent_name,
            "message": self.message,
            "data": self.data,
            "timestamp": self.timestamp,
            "event_id": self.event_id,
        })

    # Factory methods for common events
    @classmethod
    def workflow_start(cls, user_prompt: str, workflow_id: str) -> "StreamEvent":
        """Create workflow start event."""
        return cls(
            event_type=EventType.WORKFLOW_START,
            message="Workflow started",
            data={"user_prompt": user_prompt, "workflow_id": workflow_id},
        )

    @classmethod
    def workflow_complete(cls, result: Dict[str, Any], total_cost: float) -> "StreamEvent":
        """Create workflow complete event."""
        return cls(
            event_type=EventType.WORKFLOW_COMPLETE,
            message="Workflow completed successfully",
            data={"result": result, "total_cost": total_cost},
        )

    @classmethod
    def workflow_error(cls, errors: List[str]) -> "StreamEvent":
        """Create workflow error event."""
        return cls(
            event_type=EventType.WORKFLOW_ERROR,
            message="Workflow failed with errors",
            data={"errors": errors},
        )

    @classmethod
    def agent_start(cls, agent_name: str, message: str = "") -> "StreamEvent":
        """Create agent start event."""
        return cls(
            event_type=EventType.AGENT_START,
            agent_name=agent_name,
            message=message or f"{agent_name} started",
            data={},
        )

    @classmethod
    def agent_progress(
        cls,
        agent_name: str,
        progress: int,
        message: str = "",
    ) -> "StreamEvent":
        """Create agent progress event."""
        return cls(
            event_type=EventType.AGENT_PROGRESS,
            agent_name=agent_name,
            message=message,
            data={"progress": min(100, max(0, progress))},
        )

    @classmethod
    def agent_complete(
        cls,
        agent_name: str,
        output: Any,
        cost: float = 0.0,
        cache_stats: Optional[Dict] = None,
    ) -> "StreamEvent":
        """Create agent complete event."""
        return cls(
            event_type=EventType.AGENT_COMPLETE,
            agent_name=agent_name,
            message=f"{agent_name} completed",
            data={
                "output": output.model_dump() if hasattr(output, "model_dump") else output,
                "cost": cost,
                "cache_stats": cache_stats,
            },
        )

    @classmethod
    def agent_error(cls, agent_name: str, error: str) -> "StreamEvent":
        """Create agent error event."""
        return cls(
            event_type=EventType.AGENT_ERROR,
            agent_name=agent_name,
            message=f"{agent_name} failed",
            data={"error": error},
        )

    @classmethod
    def agent_retry(cls, agent_name: str, attempt: int, max_retries: int) -> "StreamEvent":
        """Create agent retry event."""
        return cls(
            event_type=EventType.AGENT_RETRY,
            agent_name=agent_name,
            message=f"{agent_name} retrying ({attempt}/{max_retries})",
            data={"attempt": attempt, "max_retries": max_retries},
        )

    @classmethod
    def token(cls, agent_name: str, token: str) -> "StreamEvent":
        """Create token streaming event."""
        return cls(
            event_type=EventType.TOKEN,
            agent_name=agent_name,
            data={"token": token},
        )

    @classmethod
    def cost_update(cls, total_cost: float, agent_costs: Dict[str, float]) -> "StreamEvent":
        """Create cost update event."""
        return cls(
            event_type=EventType.COST_UPDATE,
            message=f"Total cost: ${total_cost:.4f}",
            data={"total_cost": total_cost, "agent_costs": agent_costs},
        )

    @classmethod
    def cache_hit(cls, agent_name: str, tokens_cached: int, savings: float) -> "StreamEvent":
        """Create cache hit event."""
        return cls(
            event_type=EventType.CACHE_HIT,
            agent_name=agent_name,
            message=f"Cache hit: {tokens_cached} tokens saved",
            data={"tokens_cached": tokens_cached, "savings": savings},
        )

    @classmethod
    def human_input_required(
        cls,
        agent_name: str,
        question: str,
        options: Optional[List[str]] = None,
    ) -> "StreamEvent":
        """Create human input required event."""
        return cls(
            event_type=EventType.HUMAN_INPUT_REQUIRED,
            agent_name=agent_name,
            message="Human input required",
            data={"question": question, "options": options or []},
        )

    @classmethod
    def human_input_received(
        cls,
        agent_name: str,
        response: str,
    ) -> "StreamEvent":
        """Create human input received event."""
        return cls(
            event_type=EventType.HUMAN_INPUT_RECEIVED,
            agent_name=agent_name,
            message="Human input received",
            data={"response": response},
        )

    @classmethod
    def ai_patch_proposed(
        cls,
        agent_name: str,
        patches: Dict[str, Any],
        file_count: int,
    ) -> "StreamEvent":
        """Create AI patch proposed event for IDE preview."""
        return cls(
            event_type=EventType.AI_PATCH_PROPOSED,
            agent_name=agent_name,
            message=f"AI proposed {file_count} patch(es)",
            data={"patches": patches, "file_count": file_count},
        )

    @classmethod
    def ai_patch_accepted(
        cls,
        agent_name: str,
        file_path: str,
    ) -> "StreamEvent":
        """Create AI patch accepted event."""
        return cls(
            event_type=EventType.AI_PATCH_ACCEPTED,
            agent_name=agent_name,
            message=f"Patch accepted for {file_path}",
            data={"file_path": file_path},
        )

    @classmethod
    def ai_patch_rejected(
        cls,
        agent_name: str,
        file_path: str,
    ) -> "StreamEvent":
        """Create AI patch rejected event."""
        return cls(
            event_type=EventType.AI_PATCH_REJECTED,
            agent_name=agent_name,
            message=f"Patch rejected for {file_path}",
            data={"file_path": file_path},
        )

    @classmethod
    def validation_passed(
        cls,
        agent_name: str,
        warnings: Optional[List[Any]] = None,
    ) -> "StreamEvent":
        """Create validation passed event."""
        return cls(
            event_type=EventType.VALIDATION_PASSED,
            agent_name=agent_name,
            message=f"{agent_name} output validated successfully",
            data={"warnings": warnings or []},
        )

    @classmethod
    def validation_failed(
        cls,
        agent_name: str,
        errors: List[Any],
    ) -> "StreamEvent":
        """Create validation failed event."""
        return cls(
            event_type=EventType.VALIDATION_FAILED,
            agent_name=agent_name,
            message=f"{agent_name} output validation failed",
            data={"errors": [e.to_dict() if hasattr(e, "to_dict") else e for e in errors]},
        )

    @classmethod
    def parallel_start(
        cls,
        group_name: str,
        task_count: int,
        parallel_limit: int,
    ) -> "StreamEvent":
        """Create parallel execution start event."""
        return cls(
            event_type=EventType.PARALLEL_START,
            message=f"Starting parallel execution: {group_name}",
            data={
                "group_name": group_name,
                "task_count": task_count,
                "parallel_limit": parallel_limit,
            },
        )

    @classmethod
    def parallel_progress(
        cls,
        group_name: str,
        completed: int,
        total: int,
        running: int,
    ) -> "StreamEvent":
        """Create parallel execution progress event."""
        return cls(
            event_type=EventType.PARALLEL_PROGRESS,
            message=f"Parallel progress: {completed}/{total} completed",
            data={
                "group_name": group_name,
                "completed": completed,
                "total": total,
                "running": running,
            },
        )

    @classmethod
    def parallel_complete(
        cls,
        group_name: str,
        metrics: Dict[str, Any],
    ) -> "StreamEvent":
        """Create parallel execution complete event."""
        return cls(
            event_type=EventType.PARALLEL_COMPLETE,
            message=f"Parallel execution complete: {group_name}",
            data={
                "group_name": group_name,
                "metrics": metrics,
            },
        )

    @classmethod
    def parallel_error(
        cls,
        group_name: str,
        task_id: str,
        error: str,
    ) -> "StreamEvent":
        """Create parallel execution error event."""
        return cls(
            event_type=EventType.PARALLEL_ERROR,
            message=f"Parallel task failed: {task_id}",
            data={
                "group_name": group_name,
                "task_id": task_id,
                "error": error,
            },
        )

    @classmethod
    def deadlock_detected(
        cls,
        deadlocked_tasks: List[str],
        resolution: str,
    ) -> "StreamEvent":
        """Create deadlock detected event."""
        return cls(
            event_type=EventType.DEADLOCK_DETECTED,
            message=f"Deadlock detected: {len(deadlocked_tasks)} tasks affected",
            data={
                "deadlocked_tasks": deadlocked_tasks,
                "resolution": resolution,
            },
        )


class EventEmitter:
    """Event emitter for streaming agent progress.

    Uses asyncio Queue for thread-safe event broadcasting.
    Multiple consumers can subscribe to the same emitter.

    Usage:
        emitter = EventEmitter()

        # In producer (agent)
        await emitter.emit(StreamEvent.agent_start("pm_agent"))
        await emitter.emit(StreamEvent.agent_complete("pm_agent", result))

        # In consumer (FastAPI SSE endpoint)
        async for event in emitter.subscribe():
            yield event.to_sse()
    """

    def __init__(self, max_queue_size: int = 100):
        """Initialize emitter.

        Args:
            max_queue_size: Maximum events to buffer per subscriber
        """
        self._subscribers: List[asyncio.Queue] = []
        self._max_queue_size = max_queue_size
        self._workflow_id: str = str(uuid.uuid4())
        self._total_cost: float = 0.0
        self._agent_costs: Dict[str, float] = {}

    @property
    def workflow_id(self) -> str:
        """Get current workflow ID."""
        return self._workflow_id

    @property
    def total_cost(self) -> float:
        """Get total accumulated cost."""
        return self._total_cost

    def subscribe(self) -> AsyncIterator[StreamEvent]:
        """Subscribe to events.

        Yields:
            StreamEvent objects as they are emitted

        Example:
            async for event in emitter.subscribe():
                yield event.to_sse()
        """
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._max_queue_size)
        self._subscribers.append(queue)

        async def iterator():
            try:
                while True:
                    event = await queue.get()
                    if event is None:  # Sentinel to close stream
                        break
                    yield event
            finally:
                self._subscribers.remove(queue)

        return iterator()

    async def emit(self, event: StreamEvent) -> None:
        """Emit an event to all subscribers.

        Args:
            event: The event to emit
        """
        # Track costs
        if event.event_type == EventType.AGENT_COMPLETE and event.agent_name:
            cost = event.data.get("cost", 0.0)
            if cost:
                self._agent_costs[event.agent_name] = self._agent_costs.get(event.agent_name, 0.0) + cost
                self._total_cost += cost

        # Broadcast to all subscribers
        for queue in self._subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop event if queue is full (subscriber too slow)
                pass

    async def close(self) -> None:
        """Close all subscriber streams."""
        for queue in self._subscribers:
            try:
                queue.put_nowait(None)  # Sentinel
            except asyncio.QueueFull:
                pass

    def reset(self) -> None:
        """Reset emitter for new workflow."""
        self._workflow_id = str(uuid.uuid4())
        self._total_cost = 0.0
        self._agent_costs = {}

    # Convenience methods
    async def emit_workflow_start(self, user_prompt: str) -> None:
        """Emit workflow start event."""
        await self.emit(StreamEvent.workflow_start(user_prompt, self._workflow_id))

    async def emit_workflow_complete(self, result: Dict[str, Any]) -> None:
        """Emit workflow complete event."""
        await self.emit(StreamEvent.workflow_complete(result, self._total_cost))
        await self.close()

    async def emit_workflow_error(self, errors: List[str]) -> None:
        """Emit workflow error event."""
        await self.emit(StreamEvent.workflow_error(errors))
        await self.close()

    async def emit_agent_start(self, agent_name: str, message: str = "") -> None:
        """Emit agent start event."""
        await self.emit(StreamEvent.agent_start(agent_name, message))

    async def emit_agent_progress(
        self,
        agent_name: str,
        progress: int,
        message: str = "",
    ) -> None:
        """Emit agent progress event."""
        await self.emit(StreamEvent.agent_progress(agent_name, progress, message))

    async def emit_agent_complete(
        self,
        agent_name: str,
        output: Any,
        cost: float = 0.0,
        cache_stats: Optional[Dict] = None,
    ) -> None:
        """Emit agent complete event."""
        await self.emit(StreamEvent.agent_complete(agent_name, output, cost, cache_stats))

    async def emit_agent_error(self, agent_name: str, error: str) -> None:
        """Emit agent error event."""
        await self.emit(StreamEvent.agent_error(agent_name, error))

    async def emit_agent_retry(
        self,
        agent_name: str,
        attempt: int,
        max_retries: int,
    ) -> None:
        """Emit agent retry event."""
        await self.emit(StreamEvent.agent_retry(agent_name, attempt, max_retries))

    async def emit_token(self, agent_name: str, token: str) -> None:
        """Emit token streaming event."""
        await self.emit(StreamEvent.token(agent_name, token))

    async def emit_cost_update(self) -> None:
        """Emit cost update event."""
        await self.emit(StreamEvent.cost_update(self._total_cost, self._agent_costs))

    async def emit_cache_hit(
        self,
        agent_name: str,
        tokens_cached: int,
        savings: float,
    ) -> None:
        """Emit cache hit event."""
        await self.emit(StreamEvent.cache_hit(agent_name, tokens_cached, savings))

    async def emit_human_input_required(
        self,
        agent_name: str,
        question: str,
        options: Optional[List[str]] = None,
    ) -> None:
        """Emit human input required event."""
        await self.emit(StreamEvent.human_input_required(agent_name, question, options))

    async def emit_human_input_received(
        self,
        agent_name: str,
        response: str,
    ) -> None:
        """Emit human input received event."""
        await self.emit(StreamEvent.human_input_received(agent_name, response))


# Global emitter instance for simple use cases
_global_emitter: Optional[EventEmitter] = None


def get_emitter() -> EventEmitter:
    """Get or create global emitter instance."""
    global _global_emitter
    if _global_emitter is None:
        _global_emitter = EventEmitter()
    return _global_emitter


def reset_emitter() -> None:
    """Reset global emitter."""
    global _global_emitter
    if _global_emitter:
        _global_emitter.reset()
    else:
        _global_emitter = EventEmitter()
