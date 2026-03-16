"""Tools module for AI Agents."""

# Existing tools
from .bash_executor import BashExecutor
from .file_modifier import FileModifier
from .websocket_file_modifier import WebSocketFileModifier
from .registry import ToolRegistry, get_registry
from .tool_binding import ToolBinder, create_default_tool_binder, get_tool_binder

# Code Execution Tool (Phase-6B)
from .code_execution_tool import CodeExecutionTool
from .execution_types import (
    ExecutionStatus,
    TaskPriority,
    ExecutionOptions,
    CreateTaskRequest,
    ExecutionEvent,
    TaskStatus,
    ExecutionResult,
    ExecutionMetrics,
    ExecutionError,
)
from .execution_errors import (
    ExecutionToolError,
    TaskCreationError,
    TaskNotFoundError,
    TaskTimeoutError,
    TaskFailedError,
    TaskCancelledError,
    StreamConnectionError,
    RateLimitError,
    ServerError,
    AuthenticationError,
    ConcurrencyLimitError,
)

__all__ = [
    # Existing
    "BashExecutor",
    "FileModifier",
    "WebSocketFileModifier",
    "ToolRegistry",
    "get_registry",
    "ToolBinder",
    "create_default_tool_binder",
    "get_tool_binder",
    # Code Execution
    "CodeExecutionTool",
    "ExecutionStatus",
    "TaskPriority",
    "ExecutionOptions",
    "CreateTaskRequest",
    "ExecutionEvent",
    "TaskStatus",
    "ExecutionResult",
    "ExecutionMetrics",
    "ExecutionError",
    # Errors
    "ExecutionToolError",
    "TaskCreationError",
    "TaskNotFoundError",
    "TaskTimeoutError",
    "TaskFailedError",
    "TaskCancelledError",
    "StreamConnectionError",
    "RateLimitError",
    "ServerError",
    "AuthenticationError",
    "ConcurrencyLimitError",
]