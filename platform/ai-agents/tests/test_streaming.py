"""Tests for SSE Streaming functionality."""

import asyncio
import json
import pytest

from src.orchestrator.streaming import (
    EventEmitter,
    EventType,
    StreamEvent,
    get_emitter,
    reset_emitter,
)


class TestStreamEvent:
    """Test suite for StreamEvent class."""

    def test_event_creation(self):
        """Test basic event creation."""
        event = StreamEvent(
            event_type=EventType.AGENT_START,
            agent_name="pm_agent",
            message="Agent started",
        )
        assert event.event_type == EventType.AGENT_START
        assert event.agent_name == "pm_agent"
        assert event.message == "Agent started"
        assert event.event_id is not None
        assert event.timestamp is not None

    def test_event_to_sse(self):
        """Test SSE format conversion."""
        event = StreamEvent(
            event_type=EventType.AGENT_START,
            agent_name="pm_agent",
            message="Agent started",
        )
        sse = event.to_sse()
        assert "event: agent_start" in sse
        assert "id:" in sse
        assert "data:" in sse
        assert "Agent started" in sse

    def test_event_to_json(self):
        """Test JSON conversion."""
        event = StreamEvent(
            event_type=EventType.AGENT_COMPLETE,
            agent_name="architect_agent",
            data={"cost": 0.05},
        )
        json_str = event.to_json()
        parsed = json.loads(json_str)
        assert parsed["event_type"] == "agent_complete"
        assert parsed["agent_name"] == "architect_agent"
        assert parsed["data"]["cost"] == 0.05

    def test_workflow_start_factory(self):
        """Test workflow_start factory method."""
        event = StreamEvent.workflow_start(
            user_prompt="Build a todo app",
            workflow_id="test-123",
        )
        assert event.event_type == EventType.WORKFLOW_START
        assert event.data["user_prompt"] == "Build a todo app"
        assert event.data["workflow_id"] == "test-123"

    def test_workflow_complete_factory(self):
        """Test workflow_complete factory method."""
        event = StreamEvent.workflow_complete(
            result={"status": "success"},
            total_cost=0.15,
        )
        assert event.event_type == EventType.WORKFLOW_COMPLETE
        assert event.data["total_cost"] == 0.15

    def test_agent_start_factory(self):
        """Test agent_start factory method."""
        event = StreamEvent.agent_start("pm_agent", "Analyzing...")
        assert event.event_type == EventType.AGENT_START
        assert event.agent_name == "pm_agent"
        assert event.message == "Analyzing..."

    def test_agent_progress_factory(self):
        """Test agent_progress factory method."""
        event = StreamEvent.agent_progress("pm_agent", 50, "Processing...")
        assert event.event_type == EventType.AGENT_PROGRESS
        assert event.data["progress"] == 50

    def test_agent_complete_factory(self):
        """Test agent_complete factory method."""
        event = StreamEvent.agent_complete(
            "pm_agent",
            output={"project_name": "Test"},
            cost=0.05,
            cache_stats={"tokens_cached": 1000},
        )
        assert event.event_type == EventType.AGENT_COMPLETE
        assert event.data["cost"] == 0.05
        assert event.data["cache_stats"]["tokens_cached"] == 1000

    def test_agent_error_factory(self):
        """Test agent_error factory method."""
        event = StreamEvent.agent_error("pm_agent", "API timeout")
        assert event.event_type == EventType.AGENT_ERROR
        assert "API timeout" in event.data["error"]

    def test_agent_retry_factory(self):
        """Test agent_retry factory method."""
        event = StreamEvent.agent_retry("pm_agent", 2, 3)
        assert event.event_type == EventType.AGENT_RETRY
        assert event.data["attempt"] == 2
        assert event.data["max_retries"] == 3

    def test_token_factory(self):
        """Test token streaming factory method."""
        event = StreamEvent.token("pm_agent", "Hello")
        assert event.event_type == EventType.TOKEN
        assert event.data["token"] == "Hello"

    def test_cost_update_factory(self):
        """Test cost_update factory method."""
        event = StreamEvent.cost_update(
            total_cost=0.25,
            agent_costs={"pm_agent": 0.10, "architect_agent": 0.15},
        )
        assert event.event_type == EventType.COST_UPDATE
        assert event.data["total_cost"] == 0.25

    def test_cache_hit_factory(self):
        """Test cache_hit factory method."""
        event = StreamEvent.cache_hit("pm_agent", 5000, 0.075)
        assert event.event_type == EventType.CACHE_HIT
        assert event.data["tokens_cached"] == 5000
        assert event.data["savings"] == 0.075

    def test_human_input_required_factory(self):
        """Test human_input_required factory method."""
        event = StreamEvent.human_input_required(
            "pm_agent",
            "What framework do you prefer?",
            options=["React", "Vue", "Svelte"],
        )
        assert event.event_type == EventType.HUMAN_INPUT_REQUIRED
        assert event.data["question"] == "What framework do you prefer?"
        assert "React" in event.data["options"]


class TestEventEmitter:
    """Test suite for EventEmitter class."""

    def test_emitter_initialization(self):
        """Test emitter initialization."""
        emitter = EventEmitter()
        assert emitter.workflow_id is not None
        assert emitter.total_cost == 0.0
        assert len(emitter._agent_costs) == 0

    def test_emit_and_subscribe(self):
        """Test emitting and subscribing to events."""
        emitter = EventEmitter()

        async def run_test():
            events_received = []

            # Subscribe first
            iterator = emitter.subscribe()

            # Emit events
            await emitter.emit(StreamEvent.agent_start("pm_agent"))
            await emitter.emit(StreamEvent.agent_complete("pm_agent", {"test": "data"}))
            await emitter.close()

            # Now consume
            async for event in iterator:
                events_received.append(event)
                if len(events_received) >= 2:
                    break

            assert len(events_received) == 2
            assert events_received[0].event_type == EventType.AGENT_START
            assert events_received[1].event_type == EventType.AGENT_COMPLETE

        asyncio.run(run_test())

    def test_close_emitter(self):
        """Test closing emitter."""
        emitter = EventEmitter()

        async def run_test():
            events = []

            iterator = emitter.subscribe()

            await emitter.emit(StreamEvent.agent_start("pm_agent"))
            await emitter.close()

            async for event in iterator:
                events.append(event)

            assert len(events) == 1

        asyncio.run(run_test())

    def test_cost_tracking(self):
        """Test cost tracking on agent complete events."""
        emitter = EventEmitter()

        async def run_test():
            await emitter.emit(StreamEvent.agent_complete(
                "pm_agent",
                output={},
                cost=0.10,
            ))
            await emitter.emit(StreamEvent.agent_complete(
                "architect_agent",
                output={},
                cost=0.15,
            ))

            assert emitter.total_cost == 0.25
            assert emitter._agent_costs["pm_agent"] == 0.10
            assert emitter._agent_costs["architect_agent"] == 0.15

        asyncio.run(run_test())

    def test_reset_emitter(self):
        """Test resetting emitter."""
        emitter = EventEmitter()

        async def run_test():
            await emitter.emit(StreamEvent.agent_complete(
                "pm_agent",
                output={},
                cost=0.10,
            ))

            assert emitter.total_cost == 0.10

            emitter.reset()

            assert emitter.total_cost == 0.0
            assert len(emitter._agent_costs) == 0

        asyncio.run(run_test())

    def test_convenience_methods(self):
        """Test convenience emit methods."""
        emitter = EventEmitter()

        async def run_test():
            events = []

            iterator = emitter.subscribe()

            await emitter.emit_agent_start("pm_agent", "Starting...")
            await emitter.emit_agent_progress("pm_agent", 50, "Processing...")
            await emitter.emit_agent_complete("pm_agent", {"result": "ok"}, cost=0.05)
            await emitter.emit_cost_update()
            await emitter.emit_cache_hit("pm_agent", 1000, 0.015)
            await emitter.close()

            async for event in iterator:
                events.append(event)

            assert len(events) == 5
            assert events[0].event_type == EventType.AGENT_START
            assert events[1].event_type == EventType.AGENT_PROGRESS
            assert events[2].event_type == EventType.AGENT_COMPLETE
            assert events[3].event_type == EventType.COST_UPDATE
            assert events[4].event_type == EventType.CACHE_HIT

        asyncio.run(run_test())


class TestGlobalEmitter:
    """Test suite for global emitter functions."""

    def test_get_emitter(self):
        """Test getting global emitter."""
        emitter = get_emitter()
        assert emitter is not None
        assert isinstance(emitter, EventEmitter)

    def test_reset_emitter(self):
        """Test resetting global emitter."""
        reset_emitter()
        emitter = get_emitter()
        assert emitter.total_cost == 0.0


class TestEventType:
    """Test suite for EventType enum."""

    def test_event_types_exist(self):
        """Test all event types exist."""
        assert EventType.WORKFLOW_START.value == "workflow_start"
        assert EventType.WORKFLOW_COMPLETE.value == "workflow_complete"
        assert EventType.WORKFLOW_ERROR.value == "workflow_error"
        assert EventType.AGENT_START.value == "agent_start"
        assert EventType.AGENT_PROGRESS.value == "agent_progress"
        assert EventType.AGENT_COMPLETE.value == "agent_complete"
        assert EventType.AGENT_ERROR.value == "agent_error"
        assert EventType.AGENT_RETRY.value == "agent_retry"
        assert EventType.TOKEN.value == "token"
        assert EventType.COST_UPDATE.value == "cost_update"
        assert EventType.CACHE_HIT.value == "cache_hit"
        assert EventType.HUMAN_INPUT_REQUIRED.value == "human_input_required"
