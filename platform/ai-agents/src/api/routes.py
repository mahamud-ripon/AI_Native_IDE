"""FastAPI routes for AI Agents workflow with SSE streaming."""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..orchestrator.human_in_the_loop import get_human_manager
from ..orchestrator.cost_aggregator import get_cost_aggregator
from ..orchestrator.graph_builder import GraphBuilder
from ..orchestrator.state_schema import AgentState
from ..orchestrator.streaming import EventEmitter, StreamEvent, get_emitter, reset_emitter
from ..orchestrator.parallel_execution import get_parallel_executor, reset_parallel_executor
from ..orchestrator.schema_validation import get_validation_middleware, reset_validation_middleware

from ..tools.websocket_file_modifier import WebSocketFileModifier, get_file_modifier

router = APIRouter(prefix="/api/v1", tags=["agents"])


class WorkflowRequest(BaseModel):
    """Request to start a new workflow."""

    user_prompt: str
    project_id: Optional[str] = None  # Required for file write operations
    stream: bool = True  # Enable SSE streaming by default


class HumanInputRequest(BaseModel):
    """Request to submit human input for paused workflow."""

    workflow_id: str
    response: str  # User's response: "Retry", "Skip Agent", "Modify Requirements", "Abort Workflow"


class WorkflowResponse(BaseModel):
    """Response for non-streaming workflow execution."""

    workflow_id: str
    status: str
    result: Optional[dict] = None
    errors: list[str] = []
    cost_summary: Optional[dict] = None


@router.post("/workflow", response_model=WorkflowResponse)
async def execute_workflow(request: WorkflowRequest):
    """Execute a workflow without streaming.

    For streaming, use the /workflow/stream endpoint.
    """
    if not request.user_prompt:
        raise HTTPException(status_code=400, detail="user_prompt is required")

    # Create emitter for cost tracking
    emitter = EventEmitter()
    builder = GraphBuilder(emitter=emitter)

    # Initialize state
    state = AgentState(user_prompt=request.user_prompt, project_id=request.project_id or "default")

    try:
        # Execute workflow
        graph = builder.compile()
        result = await graph.ainvoke(state)

        # Complete workflow in cost aggregator
        builder.cost_aggregator.complete_workflow(builder.workflow_id, "completed" if not result.get("errors") else "failed")

        return WorkflowResponse(
            workflow_id=builder.workflow_id,
            status="completed" if not result.get("errors") else "failed",
            result=result,
            errors=result.get("errors", []),
            cost_summary=builder.get_cost_summary(),
        )
    except Exception as e:
        builder.cost_aggregator.complete_workflow(builder.workflow_id, "failed")
        return WorkflowResponse(
            workflow_id=builder.workflow_id,
            status="failed",
            errors=[str(e)],
            cost_summary=builder.get_cost_summary(),
        )


@router.post("/workflow/stream")
async def execute_workflow_stream(request: WorkflowRequest):
    """Execute a workflow with SSE streaming.

    Returns a stream of events:
    - workflow_start: Workflow started
    - agent_start: Agent started processing
    - agent_progress: Agent progress update
    - agent_complete: Agent finished
    - agent_error: Agent encountered error
    - workflow_complete: Workflow finished
    - workflow_error: Workflow failed

    SSE Event Format:
    event: <event_type>
    id: <event_id>
    data: <json_payload>
    """
    if not request.user_prompt:
        raise HTTPException(status_code=400, detail="user_prompt is required")

    async def event_generator():
        # Create emitter
        emitter = EventEmitter()
        builder = GraphBuilder(emitter=emitter)

        # Initialize state
        state = AgentState(user_prompt=request.user_prompt, project_id=request.project_id or "default")

        # Emit workflow start
        await emitter.emit_workflow_start(request.user_prompt)

        try:
            # Execute workflow
            graph = builder.compile()

            # Run workflow in background while streaming events
            async def run_workflow():
                try:
                    result = await graph.ainvoke(state)
                    await emitter.emit_workflow_complete(result)
                except Exception as e:
                    await emitter.emit_workflow_error([str(e)])

            # Start workflow task
            workflow_task = asyncio.create_task(run_workflow())

            # Stream events
            async for event in emitter.subscribe():
                yield event.to_sse()

                # Check if workflow is done
                if workflow_task.done():
                    # Wait for task to fully complete (propagates exceptions)
                    try:
                        await workflow_task
                    except Exception:
                        pass
                    break

        except Exception as e:
            await emitter.emit_workflow_error([str(e)])
            async for event in emitter.subscribe():
                yield event.to_sse()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.get("/workflow/{workflow_id}/status")
async def get_workflow_status(workflow_id: str):
    """Get status of a running workflow.

    Note: In production, this would query a database or cache.
    For now, returns a placeholder response.
    """
    return {
        "workflow_id": workflow_id,
        "status": "not_implemented",
        "message": "Workflow status tracking requires persistent storage",
    }


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "ai-agents"}


# WebSocket alternative for real-time streaming (optional)
@router.websocket("/ws/workflow")
async def websocket_workflow(websocket):
    """WebSocket endpoint for workflow execution with real-time updates.

    This is an alternative to SSE for bidirectional communication.
    Supports human-in-the-loop interactions.

    Message format (JSON):
    {
        "type": "start" | "human_input",
        "user_prompt": "...",
        "input": "..."  # for human_input type
    }
    """
    await websocket.accept()

    try:
        # Wait for start message
        data = await websocket.receive_json()

        if data.get("type") != "start":
            await websocket.send_json({"error": "Expected 'start' message"})
            return

        user_prompt = data.get("user_prompt")
        project_id = data.get("project_id", "default")
        if not user_prompt:
            await websocket.send_json({"error": "user_prompt is required"})
            return

        # Create emitter with WebSocket callback
        emitter = EventEmitter()
        builder = GraphBuilder(emitter=emitter)

        # Initialize state
        state = AgentState(user_prompt=user_prompt, project_id=project_id)

        # Emit workflow start
        await emitter.emit_workflow_start(user_prompt)

        # Forward events to WebSocket
        async def forward_events():
            async for event in emitter.subscribe():
                await websocket.send_json({
                    "event_type": event.event_type.value,
                    "agent_name": event.agent_name,
                    "message": event.message,
                    "data": event.data,
                    "timestamp": event.timestamp,
                })

        # Start event forwarding task
        forward_task = asyncio.create_task(forward_events())

        # Execute workflow
        try:
            graph = builder.compile()
            result = await graph.ainvoke(state)
            await emitter.emit_workflow_complete(result)
        except Exception as e:
            await emitter.emit_workflow_error([str(e)])

        # Cancel forwarding after workflow completes
        forward_task.cancel()

    except Exception as e:
        await websocket.send_json({"error": str(e)})
    finally:
        await websocket.close()


# WebSocket endpoint for real-time file editing with CRDT
@router.websocket("/ws/files")
async def websocket_file_modifier(websocket):
    """WebSocket endpoint for real-time file editing.

    Supports CRDT-safe concurrent edits with file locking.

    Message protocol:
    {
        "type": "read" | "write" | "insert" | "delete" | "lock" | "unlock" | "undo",
        "path": "relative/path/to/file.py",
        "client_id": "client-123",
        "version": 5,
        "data": {...}  // operation-specific data
    }

    Responses:
    {
        "type": "read_result" | "write_result" | "broadcast" | "error",
        "path": "...",
        "status": "success" | "error" | "locked" | "conflict",
        "content": "...",  // for read results
        "version": 6,
        "hash": "abc123..."
    }
    """
    modifier = get_file_modifier()

    # Generate client ID
    client_id = f"client-{id(websocket)}"

    await modifier.connect(websocket, client_id)

    try:
        while True:
            # Receive message
            message = await websocket.receive_json()

            # Handle message
            await modifier.handle_message(websocket, message, client_id)

    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "status": "error",
            "error": str(e),
        })
    finally:
        await modifier.disconnect(websocket, client_id)


# Human-in-the-loop endpoints
@router.get("/human-input/pending")
async def get_pending_human_input():
    """Get all pending human input requests.

    Returns list of workflows waiting for human guidance.
    """
    manager = get_human_manager()
    pending = manager.get_all_pending_requests()

    return {
        "pending_requests": [req.to_dict() for req in pending],
        "count": len(pending),
    }


@router.get("/human-input/{workflow_id}")
async def get_workflow_human_input(workflow_id: str):
    """Get human input request for a specific workflow."""
    manager = get_human_manager()
    request = manager.get_pending_for_workflow(workflow_id)

    if request is None:
        raise HTTPException(status_code=404, detail="No pending human input for this workflow")

    return request.to_dict()


@router.post("/human-input/submit")
async def submit_human_input(request: HumanInputRequest):
    """Submit human input to resume a paused workflow.

    This endpoint allows humans to guide the AI when agents fail:
    - "Retry": Retry the failed agent
    - "Skip Agent": Skip to next agent
    - "Modify Requirements": Update requirements and retry
    - "Abort Workflow": Stop the workflow
    """
    manager = get_human_manager()

    # Check if workflow is paused
    if not manager.is_workflow_paused(request.workflow_id):
        raise HTTPException(status_code=400, detail="Workflow is not paused or does not exist")

    # Submit response
    success = await manager.submit_response(request.workflow_id, request.response)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to submit response")

    return {
        "status": "success",
        "workflow_id": request.workflow_id,
        "response": request.response,
        "message": "Response submitted successfully. Workflow will resume.",
    }


@router.post("/human-input/{workflow_id}/cancel")
async def cancel_human_input(workflow_id: str, reason: str = ""):
    """Cancel a pending human input request."""
    manager = get_human_manager()

    success = manager.cancel_request(workflow_id, reason)

    if not success:
        raise HTTPException(status_code=404, detail="Workflow not found or not paused")

    return {
        "status": "cancelled",
        "workflow_id": workflow_id,
        "reason": reason,
    }


# Cost aggregation endpoints
@router.get("/costs/workflows")
async def get_all_workflow_costs():
    """Get cost summaries for all workflows."""
    aggregator = get_cost_aggregator()
    return {
        "workflows": [summary.to_dict() for summary in aggregator.get_all_workflows()],
        "totals": aggregator.get_total_costs(),
    }


@router.get("/costs/workflows/{workflow_id}")
async def get_workflow_cost(workflow_id: str):
    """Get cost summary for a specific workflow."""
    aggregator = get_cost_aggregator()
    summary = aggregator.get_workflow_summary(workflow_id)

    if summary is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    return summary.to_dict()


@router.get("/costs/totals")
async def get_total_costs():
    """Get total costs across all workflows."""
    aggregator = get_cost_aggregator()
    return aggregator.get_total_costs()


@router.post("/costs/estimate")
async def estimate_cost(
    input_tokens: int,
    output_tokens: int,
    model: str = "claude-3-sonnet",
    cache_ratio: float = 0.0,
):
    """Estimate cost for a planned execution.

    Args:
        input_tokens: Estimated input tokens
        output_tokens: Estimated output tokens
        model: Model to use
        cache_ratio: Ratio of input that will be cached (0.0 to 1.0)
    """
    aggregator = get_cost_aggregator()
    return aggregator.estimate_cost(input_tokens, output_tokens, model, cache_ratio)


@router.delete("/costs/workflows/{workflow_id}")
async def clear_workflow_cost(workflow_id: str):
    """Clear cost data for a workflow."""
    aggregator = get_cost_aggregator()
    success = aggregator.clear_workflow(workflow_id)

    if not success:
        raise HTTPException(status_code=404, detail="Workflow not found")

    return {"status": "cleared", "workflow_id": workflow_id}


# Parallel Execution endpoints
@router.get("/parallel/status")
async def get_parallel_executor_status():
    """Get current parallel executor status and configuration."""
    executor = get_parallel_executor()
    return {
        "max_concurrent": executor.max_concurrent,
        "resources": {
            "cpu": executor.resources.cpu,
            "memory_mb": executor.resources.memory_mb,
        },
        "completed_tasks": len(executor._completed_ids),
        "running_tasks": len(executor._running_tasks),
        "pending_tasks": len(executor._pending_ids),
    }


@router.post("/parallel/reset")
async def reset_parallel_executor_state():
    """Reset parallel executor state."""
    reset_parallel_executor()
    return {"status": "reset", "message": "Parallel executor state cleared"}


@router.get("/parallel/metrics")
async def get_parallel_metrics():
    """Get parallel execution metrics from current session."""
    executor = get_parallel_executor()
    return {
        "metrics": executor._metrics.to_dict() if hasattr(executor, '_metrics') and executor._metrics else {},
        "concurrency_samples": executor._concurrency_samples[-10:] if executor._concurrency_samples else [],
    }


# Schema Validation endpoints
@router.get("/validation/status")
async def get_validation_middleware_status():
    """Get current validation middleware status."""
    middleware = get_validation_middleware()
    return {
        "strict_mode": middleware.strict_mode,
        "registered_schemas": list(middleware._schemas.keys()),
        "validation_history_count": len(middleware._history),
        "agent_stats": middleware.get_agent_validation_stats(),
    }


@router.get("/validation/history")
async def get_validation_history(limit: int = 50):
    """Get validation history."""
    middleware = get_validation_middleware()
    history = middleware._history[-limit:] if middleware._history else []
    return {
        "count": len(history),
        "history": [
            {
                "agent_name": h.agent_name,
                "status": h.status.value,
                "errors_count": len(h.errors),
                "warnings_count": len(h.warnings),
                "timestamp": h.timestamp,
            }
            for h in history
        ],
    }


@router.get("/validation/history/{agent_name}")
async def get_agent_validation_history(agent_name: str, limit: int = 20):
    """Get validation history for a specific agent."""
    middleware = get_validation_middleware()
    history = middleware.get_validation_history(agent_name)

    return {
        "agent_name": agent_name,
        "count": len(history[:limit]),
        "history": [
            {
                "status": h.status.value,
                "errors": [e.to_dict() for e in h.errors],
                "warnings": [w.to_dict() for w in h.warnings],
                "timestamp": h.timestamp,
            }
            for h in history[:limit]
        ],
    }


@router.post("/validation/reset")
async def reset_validation_middleware_state():
    """Reset validation middleware state."""
    reset_validation_middleware()
    return {"status": "reset", "message": "Validation middleware state cleared"}


@router.get("/validation/schemas")
async def get_registered_schemas():
    """Get list of registered validation schemas."""
    middleware = get_validation_middleware()
    return {
        "schemas": list(middleware._schemas.keys()),
        "custom_validators": list(middleware._validators.keys()),
    }
