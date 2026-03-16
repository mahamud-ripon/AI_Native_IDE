"""Tool Binding for LangChain integration with deterministic tool calls.

This module provides:
- Tool schema definitions using Pydantic
- bind_tools() for LLM integration
- Tool execution handlers
- Structured tool calling with validation

Usage:
    from src.tools.tool_binding import ToolBinder, FileReadTool, FileWriteTool

    # Create tools
    tools = [FileReadTool(), FileWriteTool()]

    # Bind to LLM
    binder = ToolBinder(tools)
    llm_with_tools = binder.bind_to_llm(llm)

    # Execute tool calls from LLM response
    result = await binder.execute_tool_call("file_read", {"path": "src/main.py"})
"""

from __future__ import annotations

import json
import os
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Type, Union, get_type_hints

from pydantic import BaseModel, Field, field_validator


# ============================================================================
# Tool Schemas
# ============================================================================


class ToolCategory(str, Enum):
    """Categories of tools."""
    FILE = "file"
    CODE = "code"
    SHELL = "shell"
    WEB = "web"
    DATABASE = "database"
    UTILITY = "utility"


class ToolStatus(str, Enum):
    """Status of tool execution."""
    SUCCESS = "success"
    ERROR = "error"
    TIMEOUT = "timeout"
    PERMISSION_DENIED = "permission_denied"


# Base tool input schema
class ToolInput(BaseModel):
    """Base class for tool inputs."""
    pass


# File Operation Tools
class FileReadInput(ToolInput):
    """Input for file read operation."""
    path: str = Field(..., description="Path to the file to read")
    encoding: str = Field(default="utf-8", description="File encoding")
    start_line: Optional[int] = Field(default=None, description="Start line number (1-indexed)")
    end_line: Optional[int] = Field(default=None, description="End line number (1-indexed)")

    @field_validator("path")
    @classmethod
    def validate_path(cls, v: str) -> str:
        if not v:
            raise ValueError("Path cannot be empty")
        return v


class FileWriteInput(ToolInput):
    """Input for file write operation."""
    path: str = Field(..., description="Path to the file to write")
    content: str = Field(..., description="Content to write to the file")
    mode: str = Field(default="write", description="Write mode: 'write', 'append', or 'overwrite'")
    create_dirs: bool = Field(default=True, description="Create parent directories if they don't exist")

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        if v not in ["write", "append", "overwrite"]:
            raise ValueError("Mode must be 'write', 'append', or 'overwrite'")
        return v


class FileDeleteInput(ToolInput):
    """Input for file delete operation."""
    path: str = Field(..., description="Path to the file or directory to delete")
    recursive: bool = Field(default=False, description="Delete recursively for directories")

    @field_validator("path")
    @classmethod
    def validate_path(cls, v: str) -> str:
        if not v:
            raise ValueError("Path cannot be empty")
        return v


class FileListInput(ToolInput):
    """Input for file list operation."""
    directory: str = Field(..., description="Directory path to list")
    pattern: Optional[str] = Field(default=None, description="Glob pattern to filter files")
    recursive: bool = Field(default=False, description="List recursively")


class FileSearchInput(ToolInput):
    """Input for file search operation."""
    directory: str = Field(..., description="Directory to search in")
    query: str = Field(..., description="Search query (regex supported)")
    file_pattern: Optional[str] = Field(default=None, description="File pattern to search (e.g., '*.py')")
    case_sensitive: bool = Field(default=False, description="Case sensitive search")


# Code Operation Tools
class CodeExecuteInput(ToolInput):
    """Input for code execution."""
    code: str = Field(..., description="Code to execute")
    language: str = Field(default="python", description="Programming language")
    timeout: int = Field(default=30, description="Execution timeout in seconds")


class CodeAnalyzeInput(ToolInput):
    """Input for code analysis."""
    code: str = Field(..., description="Code to analyze")
    analysis_type: str = Field(default="syntax", description="Type of analysis: 'syntax', 'security', 'complexity'")


# Shell Operation Tools
class ShellExecuteInput(ToolInput):
    """Input for shell command execution."""
    command: str = Field(..., description="Shell command to execute")
    cwd: Optional[str] = Field(default=None, description="Working directory")
    timeout: int = Field(default=60, description="Execution timeout in seconds")
    env: Optional[Dict[str, str]] = Field(default=None, description="Environment variables")
    capture_output: bool = Field(default=True, description="Capture stdout and stderr")


# ============================================================================
# Tool Output Schema
# ============================================================================


@dataclass
class ToolOutput:
    """Output from tool execution."""
    status: ToolStatus
    result: Any = None
    error: Optional[str] = None
    execution_time_ms: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "status": self.status.value,
            "result": self.result,
            "error": self.error,
            "execution_time_ms": self.execution_time_ms,
            "metadata": self.metadata,
        }

    def is_success(self) -> bool:
        """Check if execution was successful."""
        return self.status == ToolStatus.SUCCESS


# ============================================================================
# Tool Definition
# ============================================================================


class ToolDefinition(ABC):
    """Abstract base class for tool definitions."""

    name: str
    description: str
    category: ToolCategory
    input_schema: Type[ToolInput]
    dangerous: bool = False  # Flag for potentially harmful operations
    requires_confirmation: bool = False

    @abstractmethod
    async def execute(self, input_data: ToolInput) -> ToolOutput:
        """Execute the tool with given input."""
        pass

    def get_schema(self) -> Dict[str, Any]:
        """Get JSON schema for the tool."""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.input_schema.model_json_schema(),
            "category": self.category.value,
            "dangerous": self.dangerous,
            "requires_confirmation": self.requires_confirmation,
        }

    def to_openai_tool(self) -> Dict[str, Any]:
        """Convert to OpenAI tool format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema.model_json_schema(),
            },
        }

    def to_anthropic_tool(self) -> Dict[str, Any]:
        """Convert to Anthropic tool format."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema.model_json_schema(),
        }


# ============================================================================
# Built-in Tools
# ============================================================================


class FileReadTool(ToolDefinition):
    """Tool for reading file contents."""

    name = "file_read"
    description = "Read contents of a file. Supports reading specific line ranges."
    category = ToolCategory.FILE
    input_schema = FileReadInput

    def __init__(self, base_path: Optional[str] = None):
        """Initialize with optional base path for sandboxing."""
        self.base_path = Path(base_path) if base_path else None

    def _resolve_path(self, path: str) -> Path:
        """Resolve and validate path."""
        if self.base_path:
            full_path = (self.base_path / path).resolve()
            # Ensure path is within base_path (security)
            if not str(full_path).startswith(str(self.base_path.resolve())):
                raise PermissionError(f"Access denied: path outside base directory")
            return full_path
        return Path(path).resolve()

    async def execute(self, input_data: FileReadInput) -> ToolOutput:
        """Execute file read."""
        import time
        start = time.time()

        try:
            path = self._resolve_path(input_data.path)

            if not path.exists():
                return ToolOutput(
                    status=ToolStatus.ERROR,
                    error=f"File not found: {input_data.path}",
                )

            if not path.is_file():
                return ToolOutput(
                    status=ToolStatus.ERROR,
                    error=f"Not a file: {input_data.path}",
                )

            with open(path, "r", encoding=input_data.encoding) as f:
                if input_data.start_line is not None:
                    # Read specific lines
                    lines = f.readlines()
                    start_idx = input_data.start_line - 1  # Convert to 0-indexed
                    end_idx = input_data.end_line if input_data.end_line else len(lines)
                    content = "".join(lines[start_idx:end_idx])
                else:
                    content = f.read()

            return ToolOutput(
                status=ToolStatus.SUCCESS,
                result=content,
                execution_time_ms=(time.time() - start) * 1000,
                metadata={
                    "path": str(path),
                    "size_bytes": len(content.encode(input_data.encoding)),
                },
            )

        except PermissionError as e:
            return ToolOutput(
                status=ToolStatus.PERMISSION_DENIED,
                error=str(e),
                execution_time_ms=(time.time() - start) * 1000,
            )
        except Exception as e:
            return ToolOutput(
                status=ToolStatus.ERROR,
                error=f"Failed to read file: {e}",
                execution_time_ms=(time.time() - start) * 1000,
            )


class FileWriteTool(ToolDefinition):
    """Tool for writing to files."""

    name = "file_write"
    description = "Write content to a file. Can create new files or append to existing ones."
    category = ToolCategory.FILE
    input_schema = FileWriteInput
    dangerous = True
    requires_confirmation = True

    def __init__(self, base_path: Optional[str] = None):
        """Initialize with optional base path for sandboxing."""
        self.base_path = Path(base_path) if base_path else None

    def _resolve_path(self, path: str) -> Path:
        """Resolve and validate path."""
        if self.base_path:
            full_path = (self.base_path / path).resolve()
            if not str(full_path).startswith(str(self.base_path.resolve())):
                raise PermissionError(f"Access denied: path outside base directory")
            return full_path
        return Path(path).resolve()

    async def execute(self, input_data: FileWriteInput) -> ToolOutput:
        """Execute file write."""
        import time
        start = time.time()

        try:
            path = self._resolve_path(input_data.path)

            # Create directories if needed
            if input_data.create_dirs:
                path.parent.mkdir(parents=True, exist_ok=True)

            # Determine write mode
            mode = "a" if input_data.mode == "append" else "w"

            with open(path, mode, encoding="utf-8") as f:
                f.write(input_data.content)

            return ToolOutput(
                status=ToolStatus.SUCCESS,
                result=f"Successfully wrote to {input_data.path}",
                execution_time_ms=(time.time() - start) * 1000,
                metadata={
                    "path": str(path),
                    "size_bytes": len(input_data.content.encode("utf-8")),
                    "mode": input_data.mode,
                },
            )

        except PermissionError as e:
            return ToolOutput(
                status=ToolStatus.PERMISSION_DENIED,
                error=str(e),
                execution_time_ms=(time.time() - start) * 1000,
            )
        except Exception as e:
            return ToolOutput(
                status=ToolStatus.ERROR,
                error=f"Failed to write file: {e}",
                execution_time_ms=(time.time() - start) * 1000,
            )


class FileDeleteTool(ToolDefinition):
    """Tool for deleting files or directories."""

    name = "file_delete"
    description = "Delete a file or directory. Use with caution."
    category = ToolCategory.FILE
    input_schema = FileDeleteInput
    dangerous = True
    requires_confirmation = True

    def __init__(self, base_path: Optional[str] = None):
        self.base_path = Path(base_path) if base_path else None

    def _resolve_path(self, path: str) -> Path:
        if self.base_path:
            full_path = (self.base_path / path).resolve()
            if not str(full_path).startswith(str(self.base_path.resolve())):
                raise PermissionError(f"Access denied: path outside base directory")
            return full_path
        return Path(path).resolve()

    async def execute(self, input_data: FileDeleteInput) -> ToolOutput:
        """Execute file delete."""
        import time
        import shutil
        start = time.time()

        try:
            path = self._resolve_path(input_data.path)

            if not path.exists():
                return ToolOutput(
                    status=ToolStatus.ERROR,
                    error=f"Path not found: {input_data.path}",
                )

            if path.is_file():
                path.unlink()
            elif path.is_dir():
                if input_data.recursive:
                    shutil.rmtree(path)
                else:
                    path.rmdir()  # Only works for empty directories

            return ToolOutput(
                status=ToolStatus.SUCCESS,
                result=f"Successfully deleted {input_data.path}",
                execution_time_ms=(time.time() - start) * 1000,
            )

        except PermissionError as e:
            return ToolOutput(
                status=ToolStatus.PERMISSION_DENIED,
                error=str(e),
                execution_time_ms=(time.time() - start) * 1000,
            )
        except Exception as e:
            return ToolOutput(
                status=ToolStatus.ERROR,
                error=f"Failed to delete: {e}",
                execution_time_ms=(time.time() - start) * 1000,
            )


class FileListTool(ToolDefinition):
    """Tool for listing directory contents."""

    name = "file_list"
    description = "List contents of a directory."
    category = ToolCategory.FILE
    input_schema = FileListInput

    def __init__(self, base_path: Optional[str] = None):
        self.base_path = Path(base_path) if base_path else None

    async def execute(self, input_data: FileListInput) -> ToolOutput:
        """Execute directory listing."""
        import time
        import glob as glob_module
        start = time.time()

        try:
            if self.base_path:
                path = (self.base_path / input_data.directory).resolve()
            else:
                path = Path(input_data.directory).resolve()

            if not path.exists():
                return ToolOutput(
                    status=ToolStatus.ERROR,
                    error=f"Directory not found: {input_data.directory}",
                )

            if not path.is_dir():
                return ToolOutput(
                    status=ToolStatus.ERROR,
                    error=f"Not a directory: {input_data.directory}",
                )

            # List files
            if input_data.pattern:
                if input_data.recursive:
                    files = list(path.rglob(input_data.pattern))
                else:
                    files = list(path.glob(input_data.pattern))
            else:
                if input_data.recursive:
                    files = list(path.rglob("*"))
                else:
                    files = list(path.glob("*"))

            result = [
                {
                    "name": f.name,
                    "path": str(f.relative_to(path)),
                    "type": "directory" if f.is_dir() else "file",
                    "size": f.stat().st_size if f.is_file() else None,
                }
                for f in files
            ]

            return ToolOutput(
                status=ToolStatus.SUCCESS,
                result=result,
                execution_time_ms=(time.time() - start) * 1000,
                metadata={"count": len(result)},
            )

        except Exception as e:
            return ToolOutput(
                status=ToolStatus.ERROR,
                error=f"Failed to list directory: {e}",
                execution_time_ms=(time.time() - start) * 1000,
            )


class ShellExecuteTool(ToolDefinition):
    """Tool for executing shell commands."""

    name = "shell_execute"
    description = "Execute a shell command. Use with extreme caution."
    category = ToolCategory.SHELL
    input_schema = ShellExecuteInput
    dangerous = True
    requires_confirmation = True

    # Allowed commands whitelist
    ALLOWED_COMMANDS = {
        "git", "npm", "node", "python", "pip", "pytest", "black", "ruff",
        "cargo", "rustc", "go", "make", "ls", "cat", "echo", "pwd",
    }

    # Blocked commands
    BLOCKED_PATTERNS = {
        "rm -rf /", "sudo", "chmod 777", "mkfs", "dd if=",
        "> /dev/", "curl | bash", "wget | sh",
    }

    async def execute(self, input_data: ShellExecuteInput) -> ToolOutput:
        """Execute shell command."""
        import time
        import asyncio
        start = time.time()

        try:
            # Security checks
            command_lower = input_data.command.lower()

            # Check blocked patterns
            for pattern in self.BLOCKED_PATTERNS:
                if pattern in command_lower:
                    return ToolOutput(
                        status=ToolStatus.PERMISSION_DENIED,
                        error=f"Blocked command pattern detected: {pattern}",
                    )

            # Prepare environment
            env = os.environ.copy()
            if input_data.env:
                env.update(input_data.env)

            # Execute command
            cwd = input_data.cwd or os.getcwd()

            process = await asyncio.create_subprocess_shell(
                input_data.command,
                cwd=cwd,
                env=env,
                stdout=asyncio.subprocess.PIPE if input_data.capture_output else None,
                stderr=asyncio.subprocess.PIPE if input_data.capture_output else None,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=input_data.timeout,
                )
            except asyncio.TimeoutError:
                process.kill()
                return ToolOutput(
                    status=ToolStatus.TIMEOUT,
                    error=f"Command timed out after {input_data.timeout} seconds",
                    execution_time_ms=(time.time() - start) * 1000,
                )

            result = {
                "return_code": process.returncode,
                "stdout": stdout.decode("utf-8") if stdout else "",
                "stderr": stderr.decode("utf-8") if stderr else "",
            }

            return ToolOutput(
                status=ToolStatus.SUCCESS if process.returncode == 0 else ToolStatus.ERROR,
                result=result,
                error=result["stderr"] if process.returncode != 0 else None,
                execution_time_ms=(time.time() - start) * 1000,
            )

        except Exception as e:
            return ToolOutput(
                status=ToolStatus.ERROR,
                error=f"Failed to execute command: {e}",
                execution_time_ms=(time.time() - start) * 1000,
            )


# ============================================================================
# Tool Binder
# ============================================================================


class ToolBinder:
    """Binds tools to LLM for deterministic tool calls.

    Features:
    - Tool registration and management
    - LLM binding (OpenAI, Anthropic, LangChain formats)
    - Tool execution with validation
    - Permission handling for dangerous tools
    - Execution history tracking

    Usage:
        binder = ToolBinder()
        binder.register(FileReadTool())
        binder.register(FileWriteTool())

        # Bind to LLM
        llm_with_tools = binder.bind_to_llm(llm)

        # Execute tool call
        result = await binder.execute_tool_call("file_read", {"path": "main.py"})
    """

    def __init__(self, tools: Optional[List[ToolDefinition]] = None):
        """Initialize tool binder.

        Args:
            tools: Optional list of tools to register
        """
        self._tools: Dict[str, ToolDefinition] = {}
        self._execution_history: List[Dict[str, Any]] = []
        self._require_confirmation_callback: Optional[Callable] = None

        if tools:
            for tool in tools:
                self.register(tool)

    def register(self, tool: ToolDefinition) -> None:
        """Register a tool.

        Args:
            tool: Tool definition to register
        """
        self._tools[tool.name] = tool

    def unregister(self, name: str) -> bool:
        """Unregister a tool.

        Args:
            name: Name of tool to unregister

        Returns:
            True if tool was unregistered, False if not found
        """
        if name in self._tools:
            del self._tools[name]
            return True
        return False

    def get_tool(self, name: str) -> Optional[ToolDefinition]:
        """Get a tool by name."""
        return self._tools.get(name)

    def list_tools(self) -> List[str]:
        """List all registered tool names."""
        return list(self._tools.keys())

    def get_all_tools(self) -> List[ToolDefinition]:
        """Get all registered tools."""
        return list(self._tools.values())

    def get_schemas(self) -> List[Dict[str, Any]]:
        """Get schemas for all tools."""
        return [tool.get_schema() for tool in self._tools.values()]

    def get_openai_tools(self) -> List[Dict[str, Any]]:
        """Get tools in OpenAI format."""
        return [tool.to_openai_tool() for tool in self._tools.values()]

    def get_anthropic_tools(self) -> List[Dict[str, Any]]:
        """Get tools in Anthropic format."""
        return [tool.to_anthropic_tool() for tool in self._tools.values()]

    def bind_to_llm(self, llm: Any, provider: str = "openai") -> Any:
        """Bind tools to an LLM.

        Args:
            llm: LangChain LLM instance
            provider: Provider type ('openai', 'anthropic', 'langchain')

        Returns:
            LLM with tools bound
        """
        if provider == "openai" or provider == "langchain":
            # LangChain style binding
            if hasattr(llm, "bind_tools"):
                return llm.bind_tools(self.get_openai_tools())
            elif hasattr(llm, "bind"):
                return llm.bind(tools=self.get_openai_tools())
            else:
                # Fallback: attach tools to llm
                llm._bound_tools = self.get_openai_tools()
                return llm

        elif provider == "anthropic":
            if hasattr(llm, "bind_tools"):
                return llm.bind_tools(self.get_anthropic_tools())
            else:
                llm._bound_tools = self.get_anthropic_tools()
                return llm

        return llm

    def set_confirmation_callback(self, callback: Callable) -> None:
        """Set callback for confirmation of dangerous tools.

        Args:
            callback: Async function that takes (tool_name, input_data) and returns bool
        """
        self._require_confirmation_callback = callback

    async def execute_tool_call(
        self,
        name: str,
        arguments: Dict[str, Any],
        skip_confirmation: bool = False,
    ) -> ToolOutput:
        """Execute a tool call.

        Args:
            name: Name of the tool to execute
            arguments: Arguments for the tool
            skip_confirmation: Skip confirmation for dangerous tools

        Returns:
            Tool execution output
        """
        import time
        start_time = time.time()

        # Get tool
        tool = self.get_tool(name)
        if tool is None:
            return ToolOutput(
                status=ToolStatus.ERROR,
                error=f"Tool not found: {name}",
            )

        # Validate input
        try:
            input_data = tool.input_schema(**arguments)
        except Exception as e:
            return ToolOutput(
                status=ToolStatus.ERROR,
                error=f"Invalid input: {e}",
            )

        # Check if confirmation required
        if tool.requires_confirmation and not skip_confirmation:
            if self._require_confirmation_callback:
                confirmed = await self._require_confirmation_callback(name, arguments)
                if not confirmed:
                    return ToolOutput(
                        status=ToolStatus.PERMISSION_DENIED,
                        error="Tool execution denied by user",
                    )

        # Execute tool
        output = await tool.execute(input_data)

        # Record execution
        self._execution_history.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "tool": name,
            "arguments": arguments,
            "status": output.status.value,
            "execution_time_ms": output.execution_time_ms,
        })

        return output

    def get_execution_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get tool execution history.

        Args:
            limit: Maximum number of records to return

        Returns:
            List of execution records
        """
        return self._execution_history[-limit:]

    def clear_history(self) -> None:
        """Clear execution history."""
        self._execution_history.clear()


# ============================================================================
# Default Tool Binder
# ============================================================================


def create_default_tool_binder(
    base_path: Optional[str] = None,
    include_dangerous: bool = False,
) -> ToolBinder:
    """Create a tool binder with default tools.

    Args:
        base_path: Base path for file operations (sandbox)
        include_dangerous: Include dangerous tools (write, delete, shell)

    Returns:
        Configured ToolBinder instance
    """
    binder = ToolBinder()

    # Safe tools
    binder.register(FileReadTool(base_path))
    binder.register(FileListTool(base_path))

    # Dangerous tools (optional)
    if include_dangerous:
        binder.register(FileWriteTool(base_path))
        binder.register(FileDeleteTool(base_path))
        binder.register(ShellExecuteTool())

    return binder


# Global tool binder instance
_global_binder: Optional[ToolBinder] = None


def get_tool_binder() -> ToolBinder:
    """Get or create global tool binder instance."""
    global _global_binder
    if _global_binder is None:
        _global_binder = create_default_tool_binder(include_dangerous=True)
    return _global_binder


def reset_tool_binder() -> None:
    """Reset global tool binder (for testing)."""
    global _global_binder
    _global_binder = None
