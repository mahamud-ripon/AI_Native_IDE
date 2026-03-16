"""
LLM Gateway Client - Transport layer for ai-service LLM Gateway.

This client handles HTTP communication with the LLM Gateway, including:
- Synchronous completion requests
- SSE streaming for real-time token generation
- Request ID generation for distributed tracing
- Error handling and quota exceeded detection
- Timeout protection and retry with exponential backoff

Architecture:
    Agent → LLMRouter → LLMClient → HTTP → LLM Gateway → Provider
"""

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class LLMTaskType(str, Enum):
    """Task types supported by the LLM Gateway."""
    PLAN = "plan"
    CODEGEN = "codegen"
    QA = "qa"
    SECURITY = "security"
    CHAT = "chat"


class LLMRole(str, Enum):
    """Message roles for LLM conversations."""
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


@dataclass
class LLMMessage:
    """A single message in an LLM conversation."""
    role: LLMRole
    content: str
    name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {"role": self.role.value, "content": self.content}
        if self.name:
            result["name"] = self.name
        return result


@dataclass
class LLMCompletionRequest:
    """Request payload for LLM completion."""
    workflow_id: str
    project_id: str
    agent_name: str
    step_name: str
    task_type: LLMTaskType
    messages: List[LLMMessage]
    
    # Optional fields
    request_id: Optional[str] = None
    complexity: Optional[str] = None  # 'low', 'medium', 'high'
    model_hint: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    user_id: Optional[str] = None
    org_id: Optional[str] = None

    def __post_init__(self):
        # Generate request ID if not provided
        if self.request_id is None:
            self.request_id = f"req_{uuid.uuid4().hex[:16]}"

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "requestId": self.request_id,
            "workflowId": self.workflow_id,
            "projectId": self.project_id,
            "agentName": self.agent_name,
            "stepName": self.step_name,
            "taskType": self.task_type.value,
            "messages": [m.to_dict() for m in self.messages],
        }

        if self.complexity:
            result["complexity"] = self.complexity
        if self.model_hint:
            result["modelHint"] = self.model_hint
        if self.temperature is not None:
            result["temperature"] = self.temperature
        if self.max_tokens is not None:
            result["maxTokens"] = self.max_tokens
        if self.user_id:
            result["userId"] = self.user_id
        if self.org_id:
            result["orgId"] = self.org_id

        return result


@dataclass
class LLMCompletionResponse:
    """Response from LLM completion."""
    request_id: str
    provider: str
    model: str
    output_text: str
    tokens_in: int
    tokens_out: int
    latency_ms: int
    cost_usd: float
    cache_hit: bool

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LLMCompletionResponse":
        return cls(
            request_id=data["requestId"],
            provider=data["provider"],
            model=data["model"],
            output_text=data["outputText"],
            tokens_in=data["tokensIn"],
            tokens_out=data["tokensOut"],
            latency_ms=data["latencyMs"],
            cost_usd=data["costUsd"],
            cache_hit=data["cacheHit"],
        )


@dataclass
class LLMStreamEvent:
    """A single event from SSE streaming."""
    event_type: str  # 'meta', 'chunk', 'done', 'error'
    data: Dict[str, Any]

    @classmethod
    def from_sse(cls, line: str) -> Optional["LLMStreamEvent"]:
        """Parse an SSE line into an event."""
        if not line or not line.startswith("data: "):
            return None

        try:
            payload = json.loads(line[6:])  # Remove "data: " prefix
            return cls(
                event_type=payload.get("type", "unknown"),
                data=payload.get("data", {}),
            )
        except json.JSONDecodeError:
            return None


class LLMClientError(Exception):
    """Base exception for LLM client errors."""
    def __init__(self, message: str, retryable: bool = False):
        self.message = message
        self.retryable = retryable
        super().__init__(message)


class LLMQuotaExceededError(LLMClientError):
    """Raised when user or org quota is exceeded."""
    def __init__(self, message: str, limit: int, current: int):
        self.limit = limit
        self.current = current
        super().__init__(message, retryable=False)


class LLMClient:
    """
    HTTP client for the LLM Gateway.
    
    Features:
    - Timeout protection (prevents hanging on stalled providers)
    - Retry with exponential backoff for transient failures
    - Request ID generation for distributed tracing
    
    Usage:
        client = LLMClient("http://ai-service:8005")
        
        # Sync completion
        response = await client.complete(request)
        
        # Streaming
        async for event in client.stream(request):
            if event.event_type == "chunk":
                print(event.data["textDelta"], end="")
    """

    # Retry configuration
    MAX_RETRIES = 2
    INITIAL_BACKOFF_MS = 500  # 0.5 seconds
    MAX_BACKOFF_MS = 5000     # 5 seconds

    # HTTP status codes that trigger retry
    RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

    def __init__(
        self,
        base_url: str,
        timeout: float = 60.0,
        max_retries: int = 2,
        headers: Optional[Dict[str, str]] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.headers = headers or {}
        
        # Create timeout configuration with connect and read timeouts
        self._timeout_config = httpx.Timeout(
            connect=10.0,      # Connection timeout
            read=timeout,       # Read timeout (total for response)
            write=30.0,         # Write timeout for request body
            pool=10.0,          # Pool timeout for acquiring connection
        )

    def _calculate_backoff(self, attempt: int) -> float:
        """Calculate exponential backoff delay in seconds."""
        backoff = self.INITIAL_BACKOFF_MS * (2 ** attempt)
        return min(backoff, self.MAX_BACKOFF_MS) / 1000.0

    def _is_retryable(self, error: Exception) -> bool:
        """Check if an error is retryable."""
        if isinstance(error, LLMClientError):
            return error.retryable
        if isinstance(error, httpx.HTTPStatusError):
            return error.response.status_code in self.RETRYABLE_STATUS_CODES
        if isinstance(error, httpx.RequestError):
            return True  # Network errors are always retryable
        return False

    async def complete(
        self,
        request: LLMCompletionRequest,
        user_id: Optional[str] = None,
        org_id: Optional[str] = None,
    ) -> LLMCompletionResponse:
        """
        Send a synchronous completion request to the LLM Gateway.
        
        Includes retry logic with exponential backoff for transient failures:
        - HTTP 429 (rate limit)
        - HTTP 5xx (server errors)
        - Network errors
        
        Args:
            request: The completion request payload
            user_id: Optional user ID (overrides request.user_id)
            org_id: Optional org ID (overrides request.org_id)
            
        Returns:
            LLMCompletionResponse with the generated text and metadata
            
        Raises:
            LLMQuotaExceededError: When quota is exceeded (HTTP 429 after retries)
            LLMClientError: For other errors after retries exhausted
        """
        payload = request.to_dict()
        
        # Override user/org IDs if provided
        if user_id:
            payload["userId"] = user_id
        if org_id:
            payload["orgId"] = org_id

        headers = {
            "Content-Type": "application/json",
            **self.headers,
        }

        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            async with httpx.AsyncClient(timeout=self._timeout_config) as client:
                try:
                    logger.debug(
                        f"LLM Gateway request attempt {attempt + 1}/{self.max_retries + 1}",
                        extra={"request_id": request.request_id}
                    )
                    
                    response = await client.post(
                        f"{self.base_url}/ai/llm/complete",
                        json=payload,
                        headers=headers,
                    )

                    if response.status_code == 429:
                        # Quota exceeded - check if retryable
                        error_data = response.json()
                        quota_error = LLMQuotaExceededError(
                            message=error_data.get("error", "Quota exceeded"),
                            limit=error_data.get("limit", 0),
                            current=error_data.get("current", 0),
                        )
                        
                        # Retry on 429 if we have attempts left
                        if attempt < self.max_retries:
                            backoff = self._calculate_backoff(attempt)
                            logger.warning(
                                f"Rate limited, retrying in {backoff}s",
                                extra={"request_id": request.request_id}
                            )
                            await asyncio.sleep(backoff)
                            continue
                        
                        raise quota_error

                    response.raise_for_status()
                    
                    result = LLMCompletionResponse.from_dict(response.json())
                    logger.info(
                        f"LLM Gateway request completed",
                        extra={
                            "request_id": result.request_id,
                            "provider": result.provider,
                            "model": result.model,
                            "tokens_in": result.tokens_in,
                            "tokens_out": result.tokens_out,
                            "latency_ms": result.latency_ms,
                            "cost_usd": result.cost_usd,
                            "cache_hit": result.cache_hit,
                        }
                    )
                    return result

                except httpx.HTTPStatusError as e:
                    last_error = LLMClientError(
                        message=f"HTTP {e.response.status_code}: {e.response.text}",
                        retryable=e.response.status_code >= 500,
                    )
                    
                    if self._is_retryable(e) and attempt < self.max_retries:
                        backoff = self._calculate_backoff(attempt)
                        logger.warning(
                            f"HTTP {e.response.status_code}, retrying in {backoff}s",
                            extra={"request_id": request.request_id}
                        )
                        await asyncio.sleep(backoff)
                        continue
                    
                except httpx.RequestError as e:
                    last_error = LLMClientError(
                        message=f"Request failed: {str(e)}",
                        retryable=True,
                    )
                    
                    if attempt < self.max_retries:
                        backoff = self._calculate_backoff(attempt)
                        logger.warning(
                            f"Network error, retrying in {backoff}s: {e}",
                            extra={"request_id": request.request_id}
                        )
                        await asyncio.sleep(backoff)
                        continue

        # All retries exhausted
        if last_error:
            raise last_error
        
        raise LLMClientError("Unknown error after retries exhausted", retryable=False)

    async def stream(
        self,
        request: LLMCompletionRequest,
        user_id: Optional[str] = None,
        org_id: Optional[str] = None,
    ) -> AsyncGenerator[LLMStreamEvent, None]:
        """
        Send a streaming completion request to the LLM Gateway.
        
        Yields SSE events:
        - meta: { provider, model } - stream start
        - chunk: { textDelta } - token chunk
        - done: { tokensIn, tokensOut, latencyMs, costUsd, cacheHit } - completion
        - error: { message, retryable } - error occurred
        
        Args:
            request: The completion request payload
            user_id: Optional user ID (overrides request.user_id)
            org_id: Optional org ID (overrides request.org_id)
            
        Yields:
            LLMStreamEvent objects for each SSE event
        """
        payload = request.to_dict()
        
        if user_id:
            payload["userId"] = user_id
        if org_id:
            payload["orgId"] = org_id

        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            **self.headers,
        }

        async with httpx.AsyncClient(timeout=self._timeout_config) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/ai/llm/stream",
                    json=payload,
                    headers=headers,
                ) as response:
                    if response.status_code == 429:
                        # Need to read the body for error details
                        body = await response.aread()
                        error_data = json.loads(body)
                        raise LLMQuotaExceededError(
                            message=error_data.get("error", "Quota exceeded"),
                            limit=error_data.get("limit", 0),
                            current=error_data.get("current", 0),
                        )

                    response.raise_for_status()

                    async for line in response.aiter_lines():
                        event = LLMStreamEvent.from_sse(line)
                        if event:
                            yield event

            except httpx.HTTPStatusError as e:
                yield LLMStreamEvent(
                    event_type="error",
                    data={
                        "message": f"HTTP {e.response.status_code}",
                        "retryable": e.response.status_code >= 500,
                    },
                )
            except httpx.RequestError as e:
                yield LLMStreamEvent(
                    event_type="error",
                    data={
                        "message": f"Request failed: {str(e)}",
                        "retryable": True,
                    },
                )

    async def stream_text(
        self,
        request: LLMCompletionRequest,
        user_id: Optional[str] = None,
        org_id: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Convenience method that yields only text deltas from streaming.
        
        Usage:
            async for text in client.stream_text(request):
                print(text, end="", flush=True)
        """
        async for event in self.stream(request, user_id, org_id):
            if event.event_type == "chunk":
                yield event.data.get("textDelta", "")
