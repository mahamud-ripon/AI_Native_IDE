"""Tests for Human-in-the-loop functionality."""

import asyncio
import pytest

from src.orchestrator.human_in_the_loop import (
    HumanInTheLoopManager,
    HumanInputRequest,
    HumanInputStatus,
    WorkflowPauseReason,
    get_human_manager,
    reset_human_manager,
)


class TestHumanInputRequest:
    """Test suite for HumanInputRequest."""

    def test_creation(self):
        """Test request creation."""
        request = HumanInputRequest(
            request_id="req-123",
            workflow_id="wf-456",
            agent_name="pm_agent",
            question="How should I proceed?",
            options=["Retry", "Skip"],
            context={"error": "API timeout"},
            status=HumanInputStatus.PENDING,
            created_at="2024-01-01T00:00:00",
        )

        assert request.request_id == "req-123"
        assert request.workflow_id == "wf-456"
        assert request.agent_name == "pm_agent"
        assert request.question == "How should I proceed?"
        assert request.options == ["Retry", "Skip"]
        assert request.status == HumanInputStatus.PENDING

    def test_to_dict(self):
        """Test conversion to dictionary."""
        request = HumanInputRequest(
            request_id="req-123",
            workflow_id="wf-456",
            agent_name="pm_agent",
            question="How should I proceed?",
            options=["Retry"],
            context={},
            status=HumanInputStatus.PENDING,
            created_at="2024-01-01T00:00:00",
        )

        d = request.to_dict()
        assert d["request_id"] == "req-123"
        assert d["workflow_id"] == "wf-456"
        assert d["status"] == "pending"


class TestHumanInTheLoopManager:
    """Test suite for HumanInTheLoopManager."""

    def test_initialization(self):
        """Test manager initialization."""
        manager = HumanInTheLoopManager(default_timeout=60)
        assert manager.default_timeout == 60
        assert manager._paused_workflows == {}
        assert manager._input_requests == {}

    def test_pause_for_input(self):
        """Test pausing workflow for input."""
        manager = HumanInTheLoopManager()

        async def run_test():
            request = await manager.pause_for_input(
                workflow_id="wf-123",
                agent_name="pm_agent",
                reason=WorkflowPauseReason.AGENT_FAILED,
                current_state={"user_prompt": "Build an app"},
                question="PM Agent failed. How should I proceed?",
                options=["Retry", "Skip"],
                context={"error": "API timeout"},
            )

            assert request.workflow_id == "wf-123"
            assert request.agent_name == "pm_agent"
            assert request.status == HumanInputStatus.PENDING
            assert manager.is_workflow_paused("wf-123") is True

        asyncio.run(run_test())

    def test_submit_response(self):
        """Test submitting human response."""
        manager = HumanInTheLoopManager()

        async def run_test():
            # First pause workflow
            await manager.pause_for_input(
                workflow_id="wf-123",
                agent_name="pm_agent",
                reason=WorkflowPauseReason.AGENT_FAILED,
                current_state={},
                question="How should I proceed?",
            )

            # Submit response
            success = await manager.submit_response("wf-123", "Retry")
            assert success is True

            # Check request status
            request = manager.get_pending_for_workflow("wf-123")
            assert request is None  # No longer pending

        asyncio.run(run_test())

    def test_submit_response_not_found(self):
        """Test submitting response for non-existent workflow."""
        manager = HumanInTheLoopManager()

        async def run_test():
            success = await manager.submit_response("nonexistent", "Retry")
            assert success is False

        asyncio.run(run_test())

    def test_wait_for_response(self):
        """Test waiting for human response."""
        manager = HumanInTheLoopManager()

        async def run_test():
            # Pause workflow
            await manager.pause_for_input(
                workflow_id="wf-123",
                agent_name="pm_agent",
                reason=WorkflowPauseReason.AGENT_FAILED,
                current_state={},
                question="How should I proceed?",
            )

            # Submit response after short delay
            async def delayed_submit():
                await asyncio.sleep(0.1)
                await manager.submit_response("wf-123", "Retry")

            asyncio.create_task(delayed_submit())

            # Wait for response
            result = await manager.wait_for_response("wf-123")
            assert result is not None
            assert result["response"] == "Retry"

        asyncio.run(run_test())

    def test_wait_for_response_timeout(self):
        """Test waiting for response with timeout."""
        manager = HumanInTheLoopManager()

        async def run_test():
            # Pause workflow with short timeout
            await manager.pause_for_input(
                workflow_id="wf-123",
                agent_name="pm_agent",
                reason=WorkflowPauseReason.AGENT_FAILED,
                current_state={},
                question="How should I proceed?",
                timeout_seconds=0.1,
            )

            # Wait without submitting response
            result = await manager.wait_for_response("wf-123")
            assert result is None  # Should timeout

        asyncio.run(run_test())

    def test_cancel_request(self):
        """Test cancelling request."""
        manager = HumanInTheLoopManager()

        async def run_test():
            # Pause workflow
            await manager.pause_for_input(
                workflow_id="wf-123",
                agent_name="pm_agent",
                reason=WorkflowPauseReason.AGENT_FAILED,
                current_state={},
                question="How should I proceed?",
            )

            # Cancel request
            success = manager.cancel_request("wf-123", "User cancelled")
            assert success is True

            # Check status
            paused = manager.get_paused_workflow("wf-123")
            assert paused.request.status == HumanInputStatus.CANCELLED

        asyncio.run(run_test())

    def test_get_all_pending_requests(self):
        """Test getting all pending requests."""
        manager = HumanInTheLoopManager()

        async def run_test():
            # Create multiple paused workflows
            for i in range(3):
                await manager.pause_for_input(
                    workflow_id=f"wf-{i}",
                    agent_name="pm_agent",
                    reason=WorkflowPauseReason.AGENT_FAILED,
                    current_state={},
                    question=f"Question {i}",
                )

            # Complete one
            await manager.submit_response("wf-1", "Retry")

            # Get pending
            pending = manager.get_all_pending_requests()
            assert len(pending) == 2

        asyncio.run(run_test())

    def test_get_stats(self):
        """Test getting manager statistics."""
        manager = HumanInTheLoopManager()

        async def run_test():
            stats = manager.get_stats()
            assert stats["pending_requests"] == 0
            assert stats["total_requests"] == 0

            # Create request
            await manager.pause_for_input(
                workflow_id="wf-123",
                agent_name="pm_agent",
                reason=WorkflowPauseReason.AGENT_FAILED,
                current_state={},
                question="How should I proceed?",
            )

            stats = manager.get_stats()
            assert stats["pending_requests"] == 1
            assert stats["total_requests"] == 1
            assert stats["paused_workflows"] == 1

        asyncio.run(run_test())

    def test_cleanup_workflow(self):
        """Test cleaning up workflow."""
        manager = HumanInTheLoopManager()

        async def run_test():
            # Create request
            await manager.pause_for_input(
                workflow_id="wf-123",
                agent_name="pm_agent",
                reason=WorkflowPauseReason.AGENT_FAILED,
                current_state={},
                question="How should I proceed?",
            )

            # Cleanup
            success = manager.cleanup_workflow("wf-123")
            assert success is True
            assert manager.is_workflow_paused("wf-123") is False

            # Cleanup non-existent
            success = manager.cleanup_workflow("nonexistent")
            assert success is False

        asyncio.run(run_test())

    def test_callback_registration(self):
        """Test registering callbacks."""
        manager = HumanInTheLoopManager()

        callback_called = False
        received_request = None

        def callback(request):
            nonlocal callback_called, received_request
            callback_called = True
            received_request = request

        manager.register_input_required_callback(callback)

        async def run_test():
            await manager.pause_for_input(
                workflow_id="wf-123",
                agent_name="pm_agent",
                reason=WorkflowPauseReason.AGENT_FAILED,
                current_state={},
                question="How should I proceed?",
            )

            assert callback_called is True
            assert received_request is not None
            assert received_request.workflow_id == "wf-123"

        asyncio.run(run_test())


class TestGlobalManager:
    """Test suite for global manager functions."""

    def test_get_human_manager(self):
        """Test getting global manager."""
        manager1 = get_human_manager()
        assert manager1 is not None

        manager2 = get_human_manager()
        assert manager1 is manager2  # Same instance

    def test_reset_human_manager(self):
        """Test resetting global manager."""
        reset_human_manager()
        manager = get_human_manager()
        assert manager is not None
