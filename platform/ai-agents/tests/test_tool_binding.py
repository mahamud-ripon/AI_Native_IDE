"""Tests for Tool Binding functionality."""

import asyncio
import os
import tempfile
from pathlib import Path

import pytest

from src.tools.tool_binding import (
    ToolBinder,
    ToolDefinition,
    ToolOutput,
    ToolStatus,
    ToolCategory,
    FileReadTool,
    FileWriteTool,
    FileDeleteTool,
    FileListTool,
    ShellExecuteTool,
    FileReadInput,
    FileWriteInput,
    FileDeleteInput,
    FileListInput,
    ShellExecuteInput,
    create_default_tool_binder,
    get_tool_binder,
    reset_tool_binder,
)


class TestToolSchemas:
    """Test suite for tool input schemas."""

    def test_file_read_input(self):
        """Test FileReadInput schema."""
        input_data = FileReadInput(path="test.py")
        assert input_data.path == "test.py"
        assert input_data.encoding == "utf-8"
        assert input_data.start_line is None
        assert input_data.end_line is None

    def test_file_read_input_with_lines(self):
        """Test FileReadInput with line range."""
        input_data = FileReadInput(path="test.py", start_line=10, end_line=20)
        assert input_data.start_line == 10
        assert input_data.end_line == 20

    def test_file_read_input_empty_path(self):
        """Test FileReadInput validation for empty path."""
        with pytest.raises(ValueError):
            FileReadInput(path="")

    def test_file_write_input(self):
        """Test FileWriteInput schema."""
        input_data = FileWriteInput(path="test.py", content="print('hello')")
        assert input_data.path == "test.py"
        assert input_data.content == "print('hello')"
        assert input_data.mode == "write"
        assert input_data.create_dirs is True

    def test_file_write_input_invalid_mode(self):
        """Test FileWriteInput validation for invalid mode."""
        with pytest.raises(ValueError):
            FileWriteInput(path="test.py", content="test", mode="invalid")

    def test_file_delete_input(self):
        """Test FileDeleteInput schema."""
        input_data = FileDeleteInput(path="test.py")
        assert input_data.path == "test.py"
        assert input_data.recursive is False

    def test_file_list_input(self):
        """Test FileListInput schema."""
        input_data = FileListInput(directory="src")
        assert input_data.directory == "src"
        assert input_data.pattern is None
        assert input_data.recursive is False

    def test_shell_execute_input(self):
        """Test ShellExecuteInput schema."""
        input_data = ShellExecuteInput(command="ls -la")
        assert input_data.command == "ls -la"
        assert input_data.timeout == 60
        assert input_data.capture_output is True


class TestToolOutput:
    """Test suite for ToolOutput."""

    def test_success_output(self):
        """Test successful output."""
        output = ToolOutput(
            status=ToolStatus.SUCCESS,
            result="file contents",
        )
        assert output.is_success() is True
        assert output.result == "file contents"

    def test_error_output(self):
        """Test error output."""
        output = ToolOutput(
            status=ToolStatus.ERROR,
            error="File not found",
        )
        assert output.is_success() is False
        assert output.error == "File not found"

    def test_to_dict(self):
        """Test conversion to dictionary."""
        output = ToolOutput(
            status=ToolStatus.SUCCESS,
            result="test",
            execution_time_ms=10.5,
        )
        d = output.to_dict()
        assert d["status"] == "success"
        assert d["result"] == "test"
        assert d["execution_time_ms"] == 10.5


class TestFileReadTool:
    """Test suite for FileReadTool."""

    @pytest.fixture
    def temp_file(self):
        """Create a temporary file for testing."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write("line1\nline2\nline3\nline4\nline5\n")
            path = f.name
        yield path
        os.unlink(path)

    def test_tool_properties(self):
        """Test tool properties."""
        tool = FileReadTool()
        assert tool.name == "file_read"
        assert tool.category == ToolCategory.FILE
        assert tool.dangerous is False

    def test_get_schema(self):
        """Test schema generation."""
        tool = FileReadTool()
        schema = tool.get_schema()
        assert schema["name"] == "file_read"
        assert "parameters" in schema

    def test_to_openai_tool(self):
        """Test OpenAI tool format."""
        tool = FileReadTool()
        openai_tool = tool.to_openai_tool()
        assert openai_tool["type"] == "function"
        assert openai_tool["function"]["name"] == "file_read"

    def test_to_anthropic_tool(self):
        """Test Anthropic tool format."""
        tool = FileReadTool()
        anthropic_tool = tool.to_anthropic_tool()
        assert anthropic_tool["name"] == "file_read"
        assert "input_schema" in anthropic_tool

    @pytest.mark.asyncio
    async def test_read_file(self, temp_file):
        """Test reading a file."""
        tool = FileReadTool()
        input_data = FileReadInput(path=temp_file)
        output = await tool.execute(input_data)

        assert output.is_success() is True
        assert "line1" in output.result
        assert output.metadata["size_bytes"] > 0

    @pytest.mark.asyncio
    async def test_read_file_lines(self, temp_file):
        """Test reading specific lines."""
        tool = FileReadTool()
        input_data = FileReadInput(path=temp_file, start_line=2, end_line=4)
        output = await tool.execute(input_data)

        assert output.is_success() is True
        assert "line2" in output.result
        assert "line3" in output.result
        assert "line1" not in output.result

    @pytest.mark.asyncio
    async def test_read_nonexistent_file(self):
        """Test reading nonexistent file."""
        tool = FileReadTool()
        input_data = FileReadInput(path="/nonexistent/file.py")
        output = await tool.execute(input_data)

        assert output.status == ToolStatus.ERROR
        assert "not found" in output.error.lower()

    @pytest.mark.asyncio
    async def test_read_with_base_path(self, temp_file):
        """Test reading with base path sandboxing."""
        base_dir = os.path.dirname(temp_file)
        filename = os.path.basename(temp_file)

        tool = FileReadTool(base_path=base_dir)
        input_data = FileReadInput(path=filename)
        output = await tool.execute(input_data)

        assert output.is_success() is True


class TestFileWriteTool:
    """Test suite for FileWriteTool."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield tmpdir

    def test_tool_properties(self):
        """Test tool properties."""
        tool = FileWriteTool()
        assert tool.name == "file_write"
        assert tool.dangerous is True
        assert tool.requires_confirmation is True

    @pytest.mark.asyncio
    async def test_write_file(self, temp_dir):
        """Test writing a file."""
        tool = FileWriteTool()
        path = os.path.join(temp_dir, "test.py")
        input_data = FileWriteInput(path=path, content="print('hello')")
        output = await tool.execute(input_data)

        assert output.is_success() is True

        # Verify file was written
        with open(path) as f:
            assert f.read() == "print('hello')"

    @pytest.mark.asyncio
    async def test_append_file(self, temp_dir):
        """Test appending to a file."""
        tool = FileWriteTool()
        path = os.path.join(temp_dir, "test.py")

        # Write initial content
        await tool.execute(FileWriteInput(path=path, content="line1\n"))

        # Append more content
        input_data = FileWriteInput(path=path, content="line2\n", mode="append")
        output = await tool.execute(input_data)

        assert output.is_success() is True

        with open(path) as f:
            content = f.read()
            assert "line1" in content
            assert "line2" in content

    @pytest.mark.asyncio
    async def test_create_directories(self, temp_dir):
        """Test creating parent directories."""
        tool = FileWriteTool()
        path = os.path.join(temp_dir, "subdir", "nested", "test.py")
        input_data = FileWriteInput(path=path, content="test", create_dirs=True)
        output = await tool.execute(input_data)

        assert output.is_success() is True
        assert os.path.exists(path)


class TestFileDeleteTool:
    """Test suite for FileDeleteTool."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield tmpdir

    def test_tool_properties(self):
        """Test tool properties."""
        tool = FileDeleteTool()
        assert tool.name == "file_delete"
        assert tool.dangerous is True
        assert tool.requires_confirmation is True

    @pytest.mark.asyncio
    async def test_delete_file(self, temp_dir):
        """Test deleting a file."""
        tool = FileDeleteTool()
        path = os.path.join(temp_dir, "test.py")

        # Create file
        with open(path, "w") as f:
            f.write("test")

        input_data = FileDeleteInput(path=path)
        output = await tool.execute(input_data)

        assert output.is_success() is True
        assert not os.path.exists(path)

    @pytest.mark.asyncio
    async def test_delete_nonexistent(self, temp_dir):
        """Test deleting nonexistent file."""
        tool = FileDeleteTool()
        input_data = FileDeleteInput(path=os.path.join(temp_dir, "nonexistent"))
        output = await tool.execute(input_data)

        assert output.status == ToolStatus.ERROR


class TestFileListTool:
    """Test suite for FileListTool."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory with files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create some files
            Path(tmpdir, "file1.py").write_text("print('1')")
            Path(tmpdir, "file2.py").write_text("print('2')")
            Path(tmpdir, "file3.txt").write_text("text")
            Path(tmpdir, "subdir").mkdir()
            Path(tmpdir, "subdir", "nested.py").write_text("nested")
            yield tmpdir

    def test_tool_properties(self):
        """Test tool properties."""
        tool = FileListTool()
        assert tool.name == "file_list"
        assert tool.dangerous is False

    @pytest.mark.asyncio
    async def test_list_directory(self, temp_dir):
        """Test listing directory contents."""
        tool = FileListTool()
        input_data = FileListInput(directory=temp_dir)
        output = await tool.execute(input_data)

        assert output.is_success() is True
        assert len(output.result) >= 3

    @pytest.mark.asyncio
    async def test_list_with_pattern(self, temp_dir):
        """Test listing with pattern filter."""
        tool = FileListTool()
        input_data = FileListInput(directory=temp_dir, pattern="*.py")
        output = await tool.execute(input_data)

        assert output.is_success() is True
        # Should only include .py files in root
        py_files = [f for f in output.result if f["name"].endswith(".py")]
        assert len(py_files) >= 2

    @pytest.mark.asyncio
    async def test_list_recursive(self, temp_dir):
        """Test recursive listing."""
        tool = FileListTool()
        input_data = FileListInput(directory=temp_dir, recursive=True)
        output = await tool.execute(input_data)

        assert output.is_success() is True
        # Should include nested files
        names = [f["name"] for f in output.result]
        assert "nested.py" in names


class TestShellExecuteTool:
    """Test suite for ShellExecuteTool."""

    def test_tool_properties(self):
        """Test tool properties."""
        tool = ShellExecuteTool()
        assert tool.name == "shell_execute"
        assert tool.dangerous is True
        assert tool.requires_confirmation is True

    @pytest.mark.asyncio
    async def test_execute_simple_command(self):
        """Test executing a simple command."""
        tool = ShellExecuteTool()
        input_data = ShellExecuteInput(command="echo hello")
        output = await tool.execute(input_data)

        assert output.is_success() is True
        assert "hello" in output.result["stdout"]

    @pytest.mark.asyncio
    async def test_execute_blocked_command(self):
        """Test that blocked commands are denied."""
        tool = ShellExecuteTool()
        input_data = ShellExecuteInput(command="sudo rm -rf /")
        output = await tool.execute(input_data)

        assert output.status == ToolStatus.PERMISSION_DENIED

    @pytest.mark.asyncio
    async def test_execute_timeout(self):
        """Test command timeout."""
        tool = ShellExecuteTool()
        # Windows: timeout command works differently
        if os.name == "nt":
            input_data = ShellExecuteInput(command="ping -n 10 localhost", timeout=1)
        else:
            input_data = ShellExecuteInput(command="sleep 10", timeout=1)
        output = await tool.execute(input_data)

        assert output.status == ToolStatus.TIMEOUT


class TestToolBinder:
    """Test suite for ToolBinder."""

    def test_initialization(self):
        """Test binder initialization."""
        binder = ToolBinder()
        assert binder.list_tools() == []

    def test_register_tool(self):
        """Test registering a tool."""
        binder = ToolBinder()
        binder.register(FileReadTool())

        assert "file_read" in binder.list_tools()

    def test_unregister_tool(self):
        """Test unregistering a tool."""
        binder = ToolBinder()
        binder.register(FileReadTool())

        success = binder.unregister("file_read")
        assert success is True
        assert "file_read" not in binder.list_tools()

    def test_unregister_nonexistent(self):
        """Test unregistering nonexistent tool."""
        binder = ToolBinder()
        success = binder.unregister("nonexistent")
        assert success is False

    def test_get_tool(self):
        """Test getting a tool by name."""
        binder = ToolBinder()
        binder.register(FileReadTool())

        tool = binder.get_tool("file_read")
        assert tool is not None
        assert tool.name == "file_read"

    def test_get_schemas(self):
        """Test getting all tool schemas."""
        binder = ToolBinder()
        binder.register(FileReadTool())
        binder.register(FileListTool())

        schemas = binder.get_schemas()
        assert len(schemas) == 2

    def test_get_openai_tools(self):
        """Test getting OpenAI format tools."""
        binder = ToolBinder()
        binder.register(FileReadTool())

        tools = binder.get_openai_tools()
        assert len(tools) == 1
        assert tools[0]["type"] == "function"

    def test_get_anthropic_tools(self):
        """Test getting Anthropic format tools."""
        binder = ToolBinder()
        binder.register(FileReadTool())

        tools = binder.get_anthropic_tools()
        assert len(tools) == 1
        assert "input_schema" in tools[0]

    def test_bind_to_llm_openai(self):
        """Test binding to LLM (OpenAI style)."""
        binder = ToolBinder()
        binder.register(FileReadTool())

        # Mock LLM with bind_tools method
        class MockLLM:
            def bind_tools(self, tools):
                self._bound_tools = tools
                return self

        llm = MockLLM()
        bound_llm = binder.bind_to_llm(llm, "openai")

        assert bound_llm is llm
        assert hasattr(bound_llm, "_bound_tools")

    @pytest.mark.asyncio
    async def test_execute_tool_call(self):
        """Test executing a tool call."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write("test content")
            path = f.name

        try:
            binder = ToolBinder()
            binder.register(FileReadTool())

            output = await binder.execute_tool_call(
                "file_read",
                {"path": path},
            )

            assert output.is_success() is True
            assert "test content" in output.result
        finally:
            os.unlink(path)

    @pytest.mark.asyncio
    async def test_execute_nonexistent_tool(self):
        """Test executing nonexistent tool."""
        binder = ToolBinder()
        output = await binder.execute_tool_call("nonexistent", {})

        assert output.status == ToolStatus.ERROR
        assert "not found" in output.error.lower()

    @pytest.mark.asyncio
    async def test_execute_invalid_input(self):
        """Test executing with invalid input."""
        binder = ToolBinder()
        binder.register(FileReadTool())

        output = await binder.execute_tool_call(
            "file_read",
            {"path": ""},  # Empty path should fail validation
        )

        assert output.status == ToolStatus.ERROR

    @pytest.mark.asyncio
    async def test_execution_history(self):
        """Test execution history tracking."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write("test")
            path = f.name

        try:
            binder = ToolBinder()
            binder.register(FileReadTool())

            await binder.execute_tool_call("file_read", {"path": path})

            history = binder.get_execution_history()
            assert len(history) == 1
            assert history[0]["tool"] == "file_read"
        finally:
            os.unlink(path)

    def test_clear_history(self):
        """Test clearing execution history."""
        binder = ToolBinder()
        binder._execution_history.append({"test": "entry"})

        binder.clear_history()
        assert len(binder.get_execution_history()) == 0


class TestDefaultToolBinder:
    """Test suite for default tool binder creation."""

    def test_create_default_binder_safe(self):
        """Test creating default binder with safe tools only."""
        binder = create_default_tool_binder(include_dangerous=False)

        tools = binder.list_tools()
        assert "file_read" in tools
        assert "file_list" in tools
        assert "file_write" not in tools
        assert "file_delete" not in tools

    def test_create_default_binder_with_dangerous(self):
        """Test creating default binder with dangerous tools."""
        binder = create_default_tool_binder(include_dangerous=True)

        tools = binder.list_tools()
        assert "file_read" in tools
        assert "file_write" in tools
        assert "file_delete" in tools
        assert "shell_execute" in tools

    def test_create_default_binder_with_base_path(self):
        """Test creating default binder with base path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            binder = create_default_tool_binder(base_path=tmpdir)

            # Tools should have base path set
            tool = binder.get_tool("file_read")
            assert tool.base_path is not None


class TestGlobalToolBinder:
    """Test suite for global tool binder functions."""

    def test_get_tool_binder(self):
        """Test getting global tool binder."""
        reset_tool_binder()
        binder1 = get_tool_binder()
        assert binder1 is not None

        binder2 = get_tool_binder()
        assert binder1 is binder2  # Same instance

    def test_reset_tool_binder(self):
        """Test resetting global tool binder."""
        reset_tool_binder()
        binder = get_tool_binder()
        assert binder is not None
