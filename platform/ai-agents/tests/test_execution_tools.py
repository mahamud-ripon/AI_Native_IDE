"""Tests for Execution Tools (read_file, list_files, run_command)."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.tools.read_file_tool import ReadFileTool, read_file_tool
from src.tools.list_files_tool import ListFilesTool, list_files_tool


class TestReadFileTool:
    """Tests for ReadFileTool."""

    @pytest.fixture
    def tool(self):
        return ReadFileTool()

    @pytest.mark.asyncio
    async def test_read_file_success(self, tool):
        """Test successful file read."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "data": {
                    "content": "file content here",
                    "language": "python"
                }
            }
            
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            
            result = await tool.read_file("project-123", "src/main.py")
            
            assert result["success"] == True
            assert result["content"] == "file content here"
            assert result["language"] == "python"

    @pytest.mark.asyncio
    async def test_read_file_not_found(self, tool):
        """Test file not found."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 404
            
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            
            result = await tool.read_file("project-123", "nonexistent.py")
            
            assert result["success"] == False
            assert "not found" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_read_file_timeout(self, tool):
        """Test request timeout."""
        with patch('httpx.AsyncClient') as mock_client:
            import httpx
            mock_client.return_value.__aenter__.return_value.get.side_effect = httpx.TimeoutException("timeout")
            
            result = await tool.read_file("project-123", "src/main.py")
            
            assert result["success"] == False
            assert "timed out" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_read_multiple_files(self, tool):
        """Test reading multiple files."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"data": {"content": "content"}}
            
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            
            result = await tool.read_multiple("project-123", ["file1.py", "file2.py"])
            
            assert result["file1.py"] == "content"
            assert result["file2.py"] == "content"


class TestListFilesTool:
    """Tests for ListFilesTool."""

    @pytest.fixture
    def tool(self):
        return ListFilesTool()

    @pytest.mark.asyncio
    async def test_list_files_success(self, tool):
        """Test successful file listing."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "data": {
                    "children": [
                        {"name": "src", "isDirectory": True, "children": [
                            {"name": "main.py", "isDirectory": False}
                        ]},
                        {"name": "package.json", "isDirectory": False}
                    ]
                }
            }
            
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            
            result = await tool.list_files("project-123")
            
            assert result["success"] == True
            assert "src/main.py" in result["files"]
            assert "package.json" in result["files"]
            assert result["count"] >= 2

    @pytest.mark.asyncio
    async def test_list_files_empty_project(self, tool):
        """Test empty project."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"data": {}}
            
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            
            result = await tool.list_files("project-123")
            
            assert result["success"] == True
            assert result["files"] == []

    @pytest.mark.asyncio
    async def test_list_files_not_found(self, tool):
        """Test project not found."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 404
            
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            
            result = await tool.list_files("invalid-project")
            
            assert result["success"] == False
            assert "not found" in result["error"].lower()

    def test_extract_files_nested(self, tool):
        """Test nested file extraction."""
        tree = {
            "children": [
                {"name": "src", "isDirectory": True, "children": [
                    {"name": "utils", "isDirectory": True, "children": [
                        {"name": "helper.py", "isDirectory": False}
                    ]},
                    {"name": "main.py", "isDirectory": False}
                ]},
                {"name": "index.html", "isDirectory": False}
            ]
        }
        
        files = tool._extract_files(tree)
        
        assert "src/utils/helper.py" in files
        assert "src/main.py" in files
        assert "index.html" in files

    @pytest.mark.asyncio
    async def test_list_by_extension(self, tool):
        """Test filtering by extension."""
        with patch.object(tool, 'list_files', new_callable=AsyncMock) as mock_list:
            mock_list.return_value = {
                "success": True,
                "files": ["app.py", "main.py", "index.html", "style.css"]
            }
            
            result = await tool.list_by_extension("project-123", ".py")
            
            assert result["success"] == True
            assert "app.py" in result["files"]
            assert "main.py" in result["files"]
            assert "index.html" not in result["files"]


class TestToolRegistry:
    """Tests for tool registry integration."""

    @pytest.mark.asyncio
    async def test_run_command_tool(self):
        """Test run_command tool in registry."""
        from src.tools.registry import tool_registry
        
        with patch.object(tool_registry.bash_executor, 'execute', new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "stdout": "output",
                "stderr": "",
                "exit_code": 0
            }
            
            result = await tool_registry.execute_tool(
                "run_command",
                "project-123",
                command="npm install"
            )
            
            assert result["stdout"] == "output"
            assert result["exit_code"] == 0
            assert result["tool"] == "run_command"

    def test_list_all_tools(self):
        """Test that all tools are listed."""
        from src.tools.registry import tool_registry
        
        tools = tool_registry.list_tools()
        
        assert "read_file" in tools
        assert "list_files" in tools
        assert "run_command" in tools
        assert "create_files" in tools
        assert "patch_file" in tools

    def test_tool_descriptions(self):
        """Test tool descriptions."""
        from src.tools.registry import tool_registry
        
        assert "Read content of a file" in tool_registry.get_tool_description("read_file")
        assert "List files in a directory" in tool_registry.get_tool_description("list_files")
        assert "Execute shell command" in tool_registry.get_tool_description("run_command")
