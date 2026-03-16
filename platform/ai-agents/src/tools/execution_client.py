"""
Execution Client

HTTP client wrapper for the Execution Control Plane API.
Handles authentication, retries, and error mapping.
"""

import asyncio
import random
from typing import Optional, Dict, Any

import httpx

from .execution_errors import (
    TaskCreationError,
    TaskNotFoundError,
    RateLimitError,
    ServerError,
    AuthenticationError,
)
from .execution_types import CreateTaskRequest, CreateTaskResponse, TaskStatus, ExecutionResult


class ExecutionClient:
    """
    HTTP client for the Execution Control Plane API.
    
    Features:
    - Timeout protection
    - Retry with exponential backoff + jitter
    - Error mapping to typed exceptions
    - Support for Bearer token or Agent key auth
    """
    
    DEFAULT_TIMEOUT = 600.0  # 10 minutes for long-running operations
    MAX_RETRIES = 3
    BASE_BACKOFF_MS = 500
    MAX_BACKOFF_MS = 10000
    
    # HTTP status codes that trigger retry
    RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
    
    def __init__(
        self,
        base_url: str,
        auth_token: Optional[str] = None,
        agent_key: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = MAX_RETRIES,
    ):
        """
        Initialize the execution client.
        
        Args:
            base_url: AI Service base URL (e.g., "http://ai-service:8005")
            auth_token: JWT Bearer token for user auth
            agent_key: API key for machine-to-machine agent auth
            timeout: Default timeout in seconds
            max_retries: Maximum retry attempts
        """
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        
        # Build auth headers
        self.headers = {"Content-Type": "application/json"}
        if auth_token:
            self.headers["Authorization"] = f"Bearer {auth_token}"
        elif agent_key:
            self.headers["X-Agent-Key"] = agent_key
        
        # Timeout config for httpx
        self._timeout_config = httpx.Timeout(
            connect=10.0,
            read=timeout,
            write=30.0,
            pool=10.0,
        )
    
    def _calculate_backoff(self, attempt: int) -> float:
        """Calculate exponential backoff with jitter in seconds."""
        backoff = self.BASE_BACKOFF_MS * (2 ** attempt)
        backoff = min(backoff, self.MAX_BACKOFF_MS)
        # Add jitter: 0 to 500ms
        jitter = random.uniform(0, 500)
        return (backoff + jitter) / 1000.0
    
    def _is_retryable(self, error: Exception) -> bool:
        """Check if an error is retryable."""
        if isinstance(error, (RateLimitError, ServerError)):
            return True
        if isinstance(error, httpx.HTTPStatusError):
            return error.response.status_code in self.RETRYABLE_STATUS_CODES
        if isinstance(error, httpx.RequestError):
            return True  # Network errors are always retryable
        return False
    
    async def _request(
        self,
        method: str,
        path: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Make an HTTP request with retry logic.
        
        Args:
            method: HTTP method
            path: API path (without base URL)
            **kwargs: Additional httpx request options
            
        Returns:
            Parsed JSON response
            
        Raises:
            ExecutionToolError: On failure after retries
        """
        url = f"{self.base_url}{path}"
        headers = {**self.headers, **kwargs.pop("headers", {})}
        
        last_error: Optional[Exception] = None
        
        for attempt in range(self.max_retries + 1):
            async with httpx.AsyncClient(timeout=self._timeout_config) as client:
                try:
                    response = await client.request(
                        method,
                        url,
                        headers=headers,
                        **kwargs
                    )
                    
                    # Handle rate limit
                    if response.status_code == 429:
                        retry_after = response.headers.get("Retry-After")
                        retry_seconds = float(retry_after) if retry_after else self._calculate_backoff(attempt)
                        
                        if attempt < self.max_retries:
                            await asyncio.sleep(retry_seconds)
                            continue
                        
                        raise RateLimitError(retry_seconds)
                    
                    # Handle 404
                    if response.status_code == 404:
                        raise TaskNotFoundError("unknown")
                    
                    # Handle 401/403
                    if response.status_code in (401, 403):
                        raise AuthenticationError(f"HTTP {response.status_code}: {response.text}")
                    
                    # Handle 5xx
                    if response.status_code >= 500:
                        if attempt < self.max_retries:
                            await asyncio.sleep(self._calculate_backoff(attempt))
                            continue
                        raise ServerError(response.status_code, response.text)
                    
                    # Raise for other errors
                    response.raise_for_status()
                    
                    return response.json()
                
                except httpx.HTTPStatusError as e:
                    last_error = e
                    if self._is_retryable(e) and attempt < self.max_retries:
                        await asyncio.sleep(self._calculate_backoff(attempt))
                        continue
                    raise
                
                except httpx.RequestError as e:
                    last_error = e
                    if attempt < self.max_retries:
                        await asyncio.sleep(self._calculate_backoff(attempt))
                        continue
                    raise TaskCreationError(f"Request failed: {str(e)}")
        
        # All retries exhausted
        if last_error:
            raise TaskCreationError(f"Request failed after {self.max_retries} retries: {str(last_error)}")
        
        raise TaskCreationError("Unknown error after retries exhausted")
    
    async def create_task(
        self,
        request: CreateTaskRequest,
        user_id: Optional[str] = None
    ) -> CreateTaskResponse:
        """
        Create a new execution task.
        
        POST /ai/execution/tasks
        """
        payload = request.to_dict()
        if user_id:
            # User ID is typically from auth context, not payload
            pass
        
        data = await self._request("POST", "/ai/execution/tasks", json=payload)
        return CreateTaskResponse.from_dict(data)
    
    async def get_task(self, task_id: str) -> TaskStatus:
        """
        Get task status.
        
        GET /ai/execution/tasks/:taskId
        """
        try:
            data = await self._request("GET", f"/ai/execution/tasks/{task_id}")
            return TaskStatus.from_dict(data)
        except TaskNotFoundError:
            raise TaskNotFoundError(task_id)
    
    async def get_task_result(self, task_id: str) -> ExecutionResult:
        """
        Get task result.
        
        GET /ai/execution/tasks/:taskId/result
        """
        try:
            data = await self._request("GET", f"/ai/execution/tasks/{task_id}/result")
            return ExecutionResult.from_dict(data)
        except TaskNotFoundError:
            raise TaskNotFoundError(task_id)
    
    async def cancel_task(self, task_id: str) -> bool:
        """
        Cancel a task.
        
        POST /ai/execution/tasks/:taskId/cancel
        """
        try:
            data = await self._request("POST", f"/ai/execution/tasks/{task_id}/cancel")
            return data.get("status") == "cancelled"
        except TaskNotFoundError:
            raise TaskNotFoundError(task_id)
    
    async def retry_task(self, task_id: str) -> TaskStatus:
        """
        Retry a failed task.
        
        POST /ai/execution/tasks/:taskId/retry
        """
        try:
            data = await self._request("POST", f"/ai/execution/tasks/{task_id}/retry")
            return TaskStatus.from_dict(data)
        except TaskNotFoundError:
            raise TaskNotFoundError(task_id)
    
    async def get_events(
        self,
        task_id: str,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        Get task events (paginated).
        
        GET /ai/execution/tasks/:taskId/events
        """
        params = {"limit": limit, "offset": offset}
        return await self._request(
            "GET",
            f"/ai/execution/tasks/{task_id}/events",
            params=params
        )
    
    def get_stream_url(self, task_id: str) -> str:
        """Get SSE stream URL for a task."""
        return f"{self.base_url}/ai/execution/tasks/{task_id}/stream"
    
    def get_stream_headers(self) -> Dict[str, str]:
        """Get headers for SSE stream."""
        return {
            "Accept": "text/event-stream",
            **self.headers
        }
