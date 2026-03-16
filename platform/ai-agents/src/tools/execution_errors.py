"""
Execution Errors

Exception hierarchy for the Code Execution Tool.
"""


class ExecutionToolError(Exception):
    """Base exception for execution tool errors."""

    def __init__(self, message: str, retryable: bool = False):
        self.message = message
        self.retryable = retryable
        super().__init__(message)


class TaskCreationError(ExecutionToolError):
    """Failed to create execution task."""

    def __init__(self, message: str, status_code: int = None):
        self.status_code = status_code
        super().__init__(message, retryable=False)


class TaskNotFoundError(ExecutionToolError):
    """Task not found."""

    def __init__(self, task_id: str):
        self.task_id = task_id
        super().__init__(f"Task not found: {task_id}", retryable=False)


class TaskTimeoutError(ExecutionToolError):
    """Task execution exceeded timeout."""

    def __init__(self, task_id: str, timeout_seconds: float):
        self.task_id = task_id
        self.timeout_seconds = timeout_seconds
        super().__init__(
            f"Task {task_id} timed out after {timeout_seconds:.1f}s",
            retryable=True
        )


class TaskFailedError(ExecutionToolError):
    """Task execution failed."""

    def __init__(
        self,
        task_id: str,
        error_code: str,
        error_message: str,
        error_stage: str,
        recoverable: bool = False
    ):
        self.task_id = task_id
        self.error_code = error_code
        self.error_message = error_message
        self.error_stage = error_stage
        super().__init__(
            f"Task {task_id} failed at {error_stage}: {error_message}",
            retryable=recoverable
        )


class TaskCancelledError(ExecutionToolError):
    """Task was cancelled."""

    def __init__(self, task_id: str):
        self.task_id = task_id
        super().__init__(f"Task {task_id} was cancelled", retryable=False)


class StreamConnectionError(ExecutionToolError):
    """Failed to connect to event stream."""

    def __init__(self, message: str, original_error: Exception = None):
        self.original_error = original_error
        super().__init__(message, retryable=True)


class RateLimitError(ExecutionToolError):
    """Rate limit exceeded."""

    def __init__(self, retry_after: float = None):
        self.retry_after = retry_after
        super().__init__(
            f"Rate limit exceeded{f', retry after {retry_after}s' if retry_after else ''}",
            retryable=True
        )


class ServerError(ExecutionToolError):
    """Server error (5xx)."""

    def __init__(self, status_code: int, message: str = None):
        self.status_code = status_code
        super().__init__(
            message or f"Server error: HTTP {status_code}",
            retryable=True
        )


class AuthenticationError(ExecutionToolError):
    """Authentication failed."""

    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, retryable=False)


class ConcurrencyLimitError(ExecutionToolError):
    """Concurrency limit reached."""

    def __init__(self, max_concurrent: int):
        self.max_concurrent = max_concurrent
        super().__init__(
            f"Concurrency limit reached ({max_concurrent} concurrent tasks)",
            retryable=True
        )
