"""Human-in-the-loop state manager for workflow pause/resume.

This module provides functionality to pause workflow execution when agents
fail (after MAX_RETRIES) and wait for human guidance before resuming.

Usage:
    from src.orchestrator.human_in_the_loop import HumanInTheLoopManager

    # In agent:
    if max_retries_exceeded:
        await human_manager.request_input(
            agent_name="pm_agent",
            question="How should I proceed?",
            options=["Retry", "Skip", "Modify prompt"],
            context={"error": error_message},
        )

    # In API endpoint:
    response = await human_manager.submit_input(workflow_id, user_response)
    workflow.resume()
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Callable


class HumanInputStatus(str, Enum):
    """Status of human input request."""

    PENDING = "pending"  # Waiting for human input
    RESPONDED = "responded"  # Human has responded
    TIMEOUT = "timeout"  # Request timed out
    CANCELLED = "cancelled"  # Request cancelled


class WorkflowPauseReason(str, Enum):
    """Reason for workflow pause."""

    AGENT_FAILED = "agent_failed"  # Agent failed after max retries
    CLARIFICATION_NEEDED = "clarification_needed"  # Need user clarification
    VALIDATION_REQUIRED = "validation_required"  # Need user validation
    CUSTOM = "custom"  # Custom pause reason


@dataclass
class HumanInputRequest:
    """Represents a request for human input."""

    request_id: str
    workflow_id: str
    agent_name: str
    question: str
    options: List[str]
    context: Dict[str, Any]
    status: HumanInputStatus
    created_at: str
    responded_at: Optional[str] = None
    response: Optional[str] = None
    timeout_seconds: int = 300  # 5 minutes default

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "request_id": self.request_id,
            "workflow_id": self.workflow_id,
            "agent_name": self.agent_name,
            "question": self.question,
            "options": self.options,
            "context": self.context,
            "status": self.status.value,
            "created_at": self.created_at,
            "responded_at": self.responded_at,
            "response": self.response,
            "timeout_seconds": self.timeout_seconds,
        }


@dataclass
class PausedWorkflow:
    """Represents a paused workflow waiting for human input."""

    workflow_id: str
    pause_reason: WorkflowPauseReason
    agent_name: str
    current_state: Dict[str, Any]
    request: HumanInputRequest
    resume_event: asyncio.Event = field(default_factory=asyncio.Event)
    resumed_at: Optional[str] = None
    result: Optional[Dict[str, Any]] = None


class HumanInTheLoopManager:
    """Manager for human-in-the-loop functionality.

    Handles:
    - Pausing workflows when agents fail
    - Requesting human input via streaming events
    - Resuming workflows with human guidance
    - Timeout handling for human responses

    Usage:
        manager = HumanInTheLoopManager()

        # Pause workflow and request input
        paused = await manager.pause_for_input(
            workflow_id="wf-123",
            agent_name="pm_agent",
            reason=WorkflowPauseReason.AGENT_FAILED,
            current_state={...},
            question="How should I proceed?",
            options=["Retry", "Skip"],
        )

        # Wait for human response (blocking)
        result = await manager.wait_for_response(workflow_id)

        # Or submit response via API
        await manager.submit_response(workflow_id, "Retry")
    """

    def __init__(self, default_timeout: int = 300):
        """Initialize manager.

        Args:
            default_timeout: Default timeout in seconds for human input
        """
        self.default_timeout = default_timeout
        self._paused_workflows: Dict[str, PausedWorkflow] = {}
        self._input_requests: Dict[str, HumanInputRequest] = {}
        self._on_input_required_callbacks: List[Callable[[HumanInputRequest], None]] = []

    def register_input_required_callback(
        self,
        callback: Callable[[HumanInputRequest], None],
    ) -> None:
        """Register callback for when human input is required.

        Args:
            callback: Function to call when input is required
        """
        self._on_input_required_callbacks.append(callback)

    async def pause_for_input(
        self,
        workflow_id: str,
        agent_name: str,
        reason: WorkflowPauseReason,
        current_state: Dict[str, Any],
        question: str,
        options: List[str] = None,
        context: Dict[str, Any] = None,
        timeout_seconds: int = None,
    ) -> HumanInputRequest:
        """Pause workflow and request human input.

        Args:
            workflow_id: Unique workflow identifier
            agent_name: Name of the agent requesting input
            reason: Why the workflow is paused
            current_state: Current workflow state
            question: Question to ask the human
            options: List of response options
            context: Additional context for the question
            timeout_seconds: Timeout for human response

        Returns:
            The created input request
        """
        request_id = str(uuid.uuid4())

        request = HumanInputRequest(
            request_id=request_id,
            workflow_id=workflow_id,
            agent_name=agent_name,
            question=question,
            options=options or [],
            context=context or {},
            status=HumanInputStatus.PENDING,
            created_at=datetime.now(timezone.utc).isoformat(),
            timeout_seconds=timeout_seconds or self.default_timeout,
        )

        paused = PausedWorkflow(
            workflow_id=workflow_id,
            pause_reason=reason,
            agent_name=agent_name,
            current_state=current_state,
            request=request,
        )

        self._paused_workflows[workflow_id] = paused
        self._input_requests[request_id] = request

        # Notify callbacks
        for callback in self._on_input_required_callbacks:
            try:
                callback(request)
            except Exception:
                pass

        return request

    async def submit_response(
        self,
        workflow_id: str,
        response: str,
        responder_id: str = "human",
    ) -> bool:
        """Submit human response to resume workflow.

        Args:
            workflow_id: Workflow identifier
            response: Human's response
            responder_id: Identifier of the responder

        Returns:
            True if response accepted, False if workflow not found
        """
        if workflow_id not in self._paused_workflows:
            return False

        paused = self._paused_workflows[workflow_id]
        request = paused.request

        # Update request
        request.status = HumanInputStatus.RESPONDED
        request.response = response
        request.responded_at = datetime.now(timezone.utc).isoformat()
        request.context["responder_id"] = responder_id

        # Resume workflow
        paused.result = {
            "response": response,
            "responder_id": responder_id,
            "request_id": request.request_id,
        }
        paused.resumed_at = datetime.now(timezone.utc).isoformat()
        paused.resume_event.set()

        return True

    async def wait_for_response(
        self,
        workflow_id: str,
        timeout_seconds: int = None,
    ) -> Optional[Dict[str, Any]]:
        """Wait for human response with optional timeout.

        Args:
            workflow_id: Workflow identifier
            timeout_seconds: Override timeout

        Returns:
            Result dict with response, or None if timed out
        """
        if workflow_id not in self._paused_workflows:
            return None

        paused = self._paused_workflows[workflow_id]
        request = paused.request

        timeout = timeout_seconds or request.timeout_seconds

        try:
            await asyncio.wait_for(
                paused.resume_event.wait(),
                timeout=timeout,
            )
            return paused.result

        except asyncio.TimeoutError:
            request.status = HumanInputStatus.TIMEOUT
            return None

    def cancel_request(self, workflow_id: str, reason: str = "") -> bool:
        """Cancel pending human input request.

        Args:
            workflow_id: Workflow identifier
            reason: Cancellation reason

        Returns:
            True if cancelled, False if not found
        """
        if workflow_id not in self._paused_workflows:
            return False

        paused = self._paused_workflows[workflow_id]
        paused.request.status = HumanInputStatus.CANCELLED
        paused.request.context["cancellation_reason"] = reason
        paused.resume_event.set()

        return True

    def get_paused_workflow(self, workflow_id: str) -> Optional[PausedWorkflow]:
        """Get paused workflow by ID."""
        return self._paused_workflows.get(workflow_id)

    def get_input_request(self, request_id: str) -> Optional[HumanInputRequest]:
        """Get input request by ID."""
        return self._input_requests.get(request_id)

    def get_all_pending_requests(self) -> List[HumanInputRequest]:
        """Get all pending input requests."""
        return [
            req for req in self._input_requests.values()
            if req.status == HumanInputStatus.PENDING
        ]

    def get_pending_for_workflow(self, workflow_id: str) -> Optional[HumanInputRequest]:
        """Get pending request for a workflow."""
        if workflow_id in self._paused_workflows:
            paused = self._paused_workflows[workflow_id]
            if paused.request.status == HumanInputStatus.PENDING:
                return paused.request
        return None

    def cleanup_workflow(self, workflow_id: str) -> bool:
        """Clean up workflow data after completion.

        Args:
            workflow_id: Workflow identifier

        Returns:
            True if cleaned up, False if not found
        """
        if workflow_id not in self._paused_workflows:
            return False

        paused = self._paused_workflows[workflow_id]
        del self._input_requests[paused.request.request_id]
        del self._paused_workflows[workflow_id]
        return True

    def is_workflow_paused(self, workflow_id: str) -> bool:
        """Check if workflow is currently paused."""
        if workflow_id not in self._paused_workflows:
            return False
        paused = self._paused_workflows[workflow_id]
        return paused.request.status == HumanInputStatus.PENDING

    def get_stats(self) -> Dict[str, Any]:
        """Get manager statistics."""
        pending = len(self.get_all_pending_requests())
        total = len(self._input_requests)
        paused_workflows = len(self._paused_workflows)

        return {
            "pending_requests": pending,
            "total_requests": total,
            "paused_workflows": paused_workflows,
        }


# Global instance
_global_human_manager: Optional[HumanInTheLoopManager] = None


def get_human_manager() -> HumanInTheLoopManager:
    """Get or create global human-in-the-loop manager."""
    global _global_human_manager
    if _global_human_manager is None:
        _global_human_manager = HumanInTheLoopManager()
    return _global_human_manager


def reset_human_manager() -> None:
    """Reset global manager (for testing)."""
    global _global_human_manager
    _global_human_manager = None
