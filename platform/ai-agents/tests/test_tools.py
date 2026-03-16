"""Unit tests for Tools module."""

import pytest

from src.tools.file_modifier import FileModifier
from src.tools.bash_executor import BashExecutor
from src.tools.registry import ToolRegistry, tool_registry


class TestFileModifier:
    """Tests for FileModifier tool."""

    def test_init_uses_env_vars(self, monkeypatch):
        """Should use environment variables for URLs."""
        monkeypatch.setenv("WS_GATEWAY_URL", "ws://custom:8001")
        monkeypatch.setenv("API_GATEWAY_URL", "http://custom:8000")
        monkeypatch.setenv("SYSTEM_TOKEN", "test-token")

        modifier = FileModifier()

        assert modifier.ws_url == "ws://custom:8001"
        assert modifier.api_url == "http://custom:8000"
        assert modifier.system_token == "test-token"

    def test_init_uses_defaults(self):
        """Should use default URLs if env vars not set."""
        modifier = FileModifier()

        assert modifier.ws_url == "ws://localhost:8001"
        assert modifier.api_url == "http://localhost:8000"

    @pytest.mark.asyncio
    async def test_modify_file_returns_false_on_error(self):
        """Should return False when API call fails."""
        modifier = FileModifier()
        # No mock, will fail to connect
        result = await modifier.modify_file("test-project", "test.py", "content")
        assert result is False

    @pytest.mark.asyncio
    async def test_read_file_returns_none_on_error(self):
        """Should return None when API call fails."""
        modifier = FileModifier()
        result = await modifier.read_file("test-project", "test.py")
        assert result is None

    @pytest.mark.asyncio
    async def test_delete_file_returns_false_on_error(self):
        """Should return False when API call fails."""
        modifier = FileModifier()
        result = await modifier.delete_file("test-project", "test.py")
        assert result is False

    @pytest.mark.asyncio
    async def test_list_files_returns_empty_on_error(self):
        """Should return empty list when API call fails."""
        modifier = FileModifier()
        result = await modifier.list_files("test-project")
        assert result == []

    @pytest.mark.asyncio
    async def test_create_files_returns_results(self):
        """Should return dict of results."""
        modifier = FileModifier()
        files = {"file1.py": "content1", "file2.py": "content2"}
        results = await modifier.create_files("test-project", files)

        assert isinstance(results, dict)
        assert "file1.py" in results


class TestBashExecutor:
    """Tests for BashExecutor tool."""

    def test_init_uses_env_vars(self, monkeypatch):
        """Should use environment variables."""
        monkeypatch.setenv("API_GATEWAY_URL", "http://custom:8000")
        monkeypatch.setenv("SYSTEM_TOKEN", "test-token")

        executor = BashExecutor()

        assert executor.api_url == "http://custom:8000"
        assert executor.system_token == "test-token"
        assert executor.default_timeout == 60

    @pytest.mark.asyncio
    async def test_execute_returns_error_dict_on_failure(self):
        """Should return error dict when API call fails."""
        executor = BashExecutor()
        result = await executor.execute("test-project", "echo test")

        assert result["success"] is False
        assert result["exit_code"] == -1
        assert "stderr" in result

    @pytest.mark.asyncio
    async def test_run_tests_returns_structured_result(self):
        """Should return structured test result."""
        executor = BashExecutor()
        result = await executor.run_tests("test-project", "npm test")

        assert "success" in result
        assert "test_count" in result
        assert "failed_count" in result
        assert "tests_passed" in result

    @pytest.mark.asyncio
    async def test_install_dependencies_uses_correct_command(self):
        """Should use correct install command for package manager."""
        executor = BashExecutor()

        # npm
        result = await executor.install_dependencies("test-project", "npm")
        assert "success" in result

        # pip
        result = await executor.install_dependencies("test-project", "pip")
        assert "success" in result

    @pytest.mark.asyncio
    async def test_build_project_returns_result(self):
        """Should return build result."""
        executor = BashExecutor()
        result = await executor.build_project("test-project")

        assert "success" in result
        assert "exit_code" in result

    @pytest.mark.asyncio
    async def test_health_check_returns_false_on_failure(self):
        """Should return False when health check fails."""
        executor = BashExecutor()
        result = await executor.health_check("test-project")
        assert result is False


class TestToolRegistry:
    """Tests for ToolRegistry."""

    def test_init_creates_tools(self):
        """Should create tool instances."""
        registry = ToolRegistry()

        assert registry.file_modifier is not None
        assert registry.bash_executor is not None

    def test_list_tools_returns_all_tools(self):
        """Should return list of all available tools."""
        registry = ToolRegistry()
        tools = registry.list_tools()

        assert "modify_file" in tools
        assert "create_files" in tools
        assert "read_file" in tools
        assert "execute" in tools
        assert "run_tests" in tools
        assert "install_dependencies" in tools
        assert "build_project" in tools
        assert "health_check" in tools

    def test_get_tool_description_returns_string(self):
        """Should return description for known tools."""
        registry = ToolRegistry()

        desc = registry.get_tool_description("modify_file")
        assert isinstance(desc, str)
        assert len(desc) > 0

    def test_get_tool_description_unknown_tool(self):
        """Should return 'Unknown tool' for unknown tools."""
        registry = ToolRegistry()

        desc = registry.get_tool_description("nonexistent")
        assert desc == "Unknown tool"

    @pytest.mark.asyncio
    async def test_execute_tool_raises_for_unknown_tool(self):
        """Should raise ValueError for unknown tool."""
        registry = ToolRegistry()

        with pytest.raises(ValueError, match="Unknown tool"):
            await registry.execute_tool("nonexistent", "test-project")

    @pytest.mark.asyncio
    async def test_execute_tool_modify_file(self):
        """Should execute modify_file tool."""
        registry = ToolRegistry()

        result = await registry.execute_tool(
            "modify_file",
            "test-project",
            file_path="test.py",
            content="print('hello')",
        )

        assert result["tool"] == "modify_file"
        assert "success" in result

    @pytest.mark.asyncio
    async def test_execute_tool_read_file(self):
        """Should execute read_file tool."""
        registry = ToolRegistry()

        result = await registry.execute_tool(
            "read_file",
            "test-project",
            file_path="test.py",
        )

        assert result["tool"] == "read_file"
        assert "content" in result

    @pytest.mark.asyncio
    async def test_execute_tool_execute(self):
        """Should execute bash command tool."""
        registry = ToolRegistry()

        result = await registry.execute_tool(
            "execute",
            "test-project",
            command="echo test",
            timeout=30,
        )

        assert result["tool"] == "execute"
        assert "success" in result
        assert "exit_code" in result

    @pytest.mark.asyncio
    async def test_execute_tool_run_tests(self):
        """Should execute run_tests tool."""
        registry = ToolRegistry()

        result = await registry.execute_tool(
            "run_tests",
            "test-project",
            test_command="pytest",
        )

        assert result["tool"] == "run_tests"
        assert "tests_passed" in result


class TestGlobalRegistry:
    """Tests for global registry instance."""

    def test_global_registry_exists(self):
        """Global registry should be available."""
        assert tool_registry is not None
        assert isinstance(tool_registry, ToolRegistry)

    def test_global_registry_has_tools(self):
        """Global registry should have tools."""
        tools = tool_registry.list_tools()
        assert len(tools) == 15
