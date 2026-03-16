"""
Code Execution Tool

Public API for AI agents to execute coding tasks through the Execution Control Plane.

Architecture:
    Agent → CodeExecutionTool → HTTP → AI Service → TaskOrchestrator

Usage:
    tool = CodeExecutionTool(base_url="http://ai-service:8005")
    
    # Simple execution (wait for completion)
    result = await tool.execute_code_task(
        project_id="proj-123",
        workspace_id="ws-456",
        instruction="Add JWT authentication middleware"
    )
    
    # Fire-and-continue (parallel execution)
    task_id = await tool.execute_code_task(..., return_task_id=True)
    
    # Stream events in real-time
    async for event in tool.stream_events(task_id):
        print(f"[{event.stage}] {event.message}")
"""

import asyncio
import logging
from typing import Optional, Callable, AsyncGenerator

from .execution_types import (
    ExecutionStatus,
    TaskPriority,
    ExecutionOptions,
    CreateTaskRequest,
    ExecutionEvent,
    TaskStatus,
    ExecutionResult,
)
from .execution_errors import (
    TaskFailedError,
    TaskTimeoutError,
    TaskCancelledError,
    ConcurrencyLimitError,
)
from .execution_client import ExecutionClient
from .execution_stream import ExecutionStream

logger = logging.getLogger(__name__)


class CodeExecutionTool:
    """
    Tool for AI agents to execute coding tasks through the Execution Control Plane.
    
    Features:
    - Create and execute coding tasks
    - Wait for completion or fire-and-continue
    - Stream events in real-time via SSE
    - Automatic retry with backoff
    - Client-side rate limiting (semaphore)
    - Polling fallback when SSE fails
    """
    
    DEFAULT_TIMEOUT_SECONDS = 600.0  # 10 minutes
    MAX_CONCURRENT_TASKS = 5
    
    def __init__(
        self,
        base_url: str,
        auth_token: Optional[str] = None,
        agent_key: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = 3,
        max_concurrent: int = MAX_CONCURRENT_TASKS,
    ):
        """
        Initialize the code execution tool.
        
        Args:
            base_url: AI Service base URL (e.g., "http://ai-service:8005")
            auth_token: JWT Bearer token for user auth
            agent_key: API key for machine-to-machine agent auth
            timeout: Default timeout for waiting on tasks (seconds)
            max_retries: Maximum retry attempts for transient failures
            max_concurrent: Maximum concurrent execution requests
        """
        self.base_url = base_url
        self.timeout = timeout
        self.max_retries = max_retries
        
        # HTTP client
        self.client = ExecutionClient(
            base_url=base_url,
            auth_token=auth_token,
            agent_key=agent_key,
            timeout=timeout,
            max_retries=max_retries,
        )
        
        # Stream handler
        self.stream = ExecutionStream(self.client, poll_fallback=True)
        
        # Client-side rate limiting
        self._semaphore = asyncio.Semaphore(max_concurrent)
    
    async def execute_code_task(
        self,
        project_id: str,
        workspace_id: str,
        instruction: str,
        branch: Optional[str] = None,
        priority: TaskPriority = TaskPriority.NORMAL,
        options: Optional[ExecutionOptions] = None,
        conversation_id: Optional[str] = None,
        workflow_run_id: Optional[str] = None,
        wait_for_completion: bool = True,
        return_task_id: bool = False,
        timeout_seconds: Optional[float] = None,
        progress_callback: Optional[Callable[[ExecutionEvent], None]] = None,
    ) -> ExecutionResult | str:
        """
        Execute a coding task.
        
        Args:
            project_id: Project UUID
            workspace_id: Workspace identifier
            instruction: Natural language coding instruction
            branch: Target git branch (optional)
            priority: Task priority
            options: Execution options (timeout, rollback, sandbox, etc.)
            conversation_id: Link to AI conversation (optional)
            workflow_run_id: Link to workflow run (optional)
            wait_for_completion: Block until task completes (default True)
            return_task_id: Return task ID instead of result (for parallel execution)
            timeout_seconds: Max wait time (default from constructor)
            progress_callback: Optional callback for progress updates
            
        Returns:
            ExecutionResult if wait_for_completion=True
            str (task_id) if return_task_id=True
            
        Raises:
            TaskFailedError: Task execution failed
            TaskTimeoutError: Task exceeded timeout
            TaskCancelledError: Task was cancelled
            ConcurrencyLimitError: Too many concurrent tasks
        """
        # Acquire semaphore for rate limiting
        async with self._semaphore:
            # Create task
            request = CreateTaskRequest(
                project_id=project_id,
                workspace_id=workspace_id,
                instruction=instruction,
                branch=branch,
                priority=priority,
                options=options,
                conversation_id=conversation_id,
                workflow_run_id=workflow_run_id,
            )
            
            response = await self.client.create_task(request)
            task_id = response.task_id
            
            logger.info(f"Created execution task {task_id}: {instruction[:50]}...")
            
            # Return task ID for fire-and-continue
            if return_task_id:
                return task_id
            
            # Wait for completion if requested
            if wait_for_completion:
                return await self.wait_for_completion(
                    task_id,
                    timeout_seconds=timeout_seconds,
                    progress_callback=progress_callback,
                )
            
            # Return task status
            status = await self.client.get_task(task_id)
            return ExecutionResult(
                task_id=task_id,
                success=False,
                status=status.status,
                completed_at=None,
            )
    
    async def create_task(
        self,
        request: CreateTaskRequest
    ) -> TaskStatus:
        """
        Create a task without waiting for completion.
        
        Args:
            request: Task creation request
            
        Returns:
            TaskStatus with task ID and initial status
        """
        async with self._semaphore:
            response = await self.client.create_task(request)
            status = await self.client.get_task(response.task_id)
            return status
    
    async def get_task_status(
        self,
        task_id: str
    ) -> TaskStatus:
        """
        Get current task status.
        
        Args:
            task_id: Task to check
            
        Returns:
            Current TaskStatus
        """
        return await self.client.get_task(task_id)
    
    async def get_task_result(
        self,
        task_id: str
    ) -> ExecutionResult:
        """
        Get final result of completed task.
        
        Args:
            task_id: Task to get result for
            
        Returns:
            ExecutionResult with success/failure and artifacts
        """
        return await self.client.get_task_result(task_id)
    
    async def stream_events(
        self,
        task_id: str,
        progress_callback: Optional[Callable[[ExecutionEvent], None]] = None,
        last_event_id: Optional[int] = None,
    ) -> AsyncGenerator[ExecutionEvent, None]:
        """
        Stream task events in real-time via SSE.
        
        Falls back to polling if SSE connection fails.
        
        Args:
            task_id: Task to stream events for
            progress_callback: Optional callback for each event
            last_event_id: Resume from this event ID (for reconnect)
            
        Yields:
            ExecutionEvent objects as they occur
        """
        async for event in self.stream.stream(task_id, last_event_id):
            if progress_callback:
                try:
                    progress_callback(event)
                except Exception as e:
                    logger.warning(f"Progress callback error: {e}")
            
            yield event
    
    async def cancel_task(
        self,
        task_id: str
    ) -> bool:
        """
        Cancel a running task.
        
        Args:
            task_id: Task to cancel
            
        Returns:
            True if cancelled successfully
        """
        return await self.client.cancel_task(task_id)
    
    async def retry_task(
        self,
        task_id: str
    ) -> TaskStatus:
        """
        Retry a failed task.
        
        Args:
            task_id: Task to retry
            
        Returns:
            New TaskStatus after re-queueing
        """
        return await self.client.retry_task(task_id)
    
    async def wait_for_completion(
        self,
        task_id: str,
        timeout_seconds: Optional[float] = None,
        progress_callback: Optional[Callable[[ExecutionEvent], None]] = None,
    ) -> ExecutionResult:
        """
        Wait for task to complete, optionally streaming progress.
        
        Args:
            task_id: Task to wait for
            timeout_seconds: Max wait time (default from constructor)
            progress_callback: Optional callback for progress updates
            
        Returns:
            ExecutionResult with success/failure and artifacts
            
        Raises:
            TaskTimeoutError: Task exceeded timeout
            TaskFailedError: Task execution failed
            TaskCancelledError: Task was cancelled
        """
        timeout = timeout_seconds or self.timeout
        last_event_id = None
        
        try:
            async with asyncio.timeout(timeout):
                async for event in self.stream_events(task_id, progress_callback, last_event_id):
                    last_event_id = event.sequence
                    
                    if event.is_terminal():
                        break
        except asyncio.TimeoutError:
            raise TaskTimeoutError(task_id, timeout)
        
        # Get final result
        result = await self.client.get_task_result(task_id)
        
        # Convert to appropriate error
        if result.status == ExecutionStatus.FAILED:
            if result.error:
                raise TaskFailedError(
                    task_id=result.task_id,
                    error_code=result.error.code,
                    error_message=result.error.message,
                    error_stage=result.error.stage,
                    recoverable=result.error.recoverable,
                )
            raise TaskFailedError(
                task_id=result.task_id,
                error_code="UNKNOWN",
                error_message="Unknown error",
                error_stage="unknown",
                recoverable=False,
            )
        
        if result.status == ExecutionStatus.CANCELLED:
            raise TaskCancelledError(task_id)
        
        if result.status == ExecutionStatus.TIMEOUT:
            raise TaskTimeoutError(task_id, timeout)
        
        return result
    
    async def execute_parallel(
        self,
        tasks: list[CreateTaskRequest],
        max_concurrent: int = 2,
        progress_callback: Optional[Callable[[str, ExecutionEvent], None]] = None,
    ) -> list[ExecutionResult]:
        """
        Execute multiple tasks in parallel.
        
        Args:
            tasks: List of task requests
            max_concurrent: Maximum concurrent tasks
            progress_callback: Callback with (task_id, event)
            
        Returns:
            List of ExecutionResult for each task
        """
        semaphore = asyncio.Semaphore(max_concurrent)
        results = {}
        
        async def execute_one(request: CreateTaskRequest) -> None:
            async with semaphore:
                task_id = await self.execute_code_task(
                    project_id=request.project_id,
                    workspace_id=request.workspace_id,
                    instruction=request.instruction,
                    branch=request.branch,
                    priority=request.priority,
                    options=request.options,
                    return_task_id=True,
                )
                
                def on_progress(event: ExecutionEvent):
                    if progress_callback:
                        progress_callback(task_id, event)
                
                result = await self.wait_for_completion(task_id, progress_callback=on_progress)
                results[request.instruction] = result
        
        # Execute all tasks concurrently
        await asyncio.gather(*[execute_one(t) for t in tasks])
        
        # Return results in order
        return [results[t.instruction] for t in tasks]
