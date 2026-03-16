"""Integration tests for AI Patch Workflow."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

from src.orchestrator.state_schema import AgentState, CodeResult, PatchOperation
from src.orchestrator.streaming import EventEmitter, StreamEvent, EventType
from src.tools.patch_file_tool import PatchFileTool, patch_file_tool


class TestPatchFileTool:
    """Tests for PatchFileTool."""

    @pytest.fixture
    def patch_tool(self):
        """Create a PatchFileTool instance."""
        return PatchFileTool()

    def test_apply_operations_replace(self):
        """Test replace operation."""
        content = "line 1\nline 2\nline 3\nline 4\nline 5"
        operations = [
            PatchOperation(
                action="replace",
                startLine=2,
                endLine=3,
                content="replaced content"
            )
        ]
        
        tool = PatchFileTool()
        result = tool._apply_operations(content, operations)
        
        expected = "line 1\nreplaced content\nline 4\nline 5"
        assert result == expected

    def test_apply_operations_insert(self):
        """Test insert operation."""
        content = "line 1\nline 2\nline 3"
        operations = [
            PatchOperation(
                action="insert",
                startLine=2,
                content="inserted line"
            )
        ]
        
        tool = PatchFileTool()
        result = tool._apply_operations(content, operations)
        
        expected = "line 1\ninserted line\nline 2\nline 3"
        assert result == expected

    def test_apply_operations_delete(self):
        """Test delete operation."""
        content = "line 1\nline 2\nline 3\nline 4\nline 5"
        operations = [
            PatchOperation(
                action="delete",
                startLine=2,
                endLine=4
            )
        ]
        
        tool = PatchFileTool()
        result = tool._apply_operations(content, operations)
        
        expected = "line 1\nline 5"
        assert result == expected

    def test_apply_operations_multiple(self):
        """Test multiple operations in sequence."""
        content = "line 1\nline 2\nline 3\nline 4\nline 5"
        operations = [
            PatchOperation(action="replace", startLine=2, endLine=2, content="new line 2"),
            PatchOperation(action="insert", startLine=4, content="new line 4"),
        ]
        
        tool = PatchFileTool()
        result = tool._apply_operations(content, operations)
        
        # Operations are applied in reverse order
        expected = "line 1\nnew line 2\nline 3\nnew line 4\nline 4\nline 5"
        assert result == expected


class TestCodeResultSchema:
    """Tests for CodeResult schema with hybrid output."""

    def test_create_files_only(self):
        """Test CodeResult with only create_files."""
        result = CodeResult(
            create_files={
                "src/main.py": "print('hello')",
                "src/utils.py": "def helper(): pass"
            },
            dependencies=["pytest"]
        )
        
        assert len(result.create_files) == 2
        assert result.create_files["src/main.py"] == "print('hello')"
        assert len(result.patch_files) == 0

    def test_patch_files_only(self):
        """Test CodeResult with only patch_files."""
        result = CodeResult(
            patch_files={
                "src/main.py": [
                    PatchOperation(
                        action="replace",
                        startLine=1,
                        endLine=1,
                        content="import sys"
                    )
                ]
            }
        )
        
        assert len(result.create_files) == 0
        assert len(result.patch_files) == 1

    def test_hybrid_output(self):
        """Test CodeResult with both create_files and patch_files."""
        result = CodeResult(
            create_files={"src/new.ts": "export const x = 1;"},
            patch_files={
                "src/existing.ts": [
                    PatchOperation(action="insert", startLine=10, content="const y = 2;")
                ]
            },
            dependencies=["typescript"]
        )
        
        assert len(result.create_files) == 1
        assert len(result.patch_files) == 1
        assert result.dependencies == ["typescript"]

    def test_backward_compatibility(self):
        """Test CodeOutput alias works."""
        from src.orchestrator.state_schema import CodeOutput
        
        # CodeOutput should be same as CodeResult
        output = CodeOutput(create_files={"test.py": "pass"})
        assert isinstance(output, CodeResult)


class TestPatchStreamingEvents:
    """Tests for patch-related streaming events."""

    def test_ai_patch_proposed_event(self):
        """Test AI_PATCH_PROPOSED event creation."""
        patches = {
            "src/app.py": [
                {"action": "replace", "startLine": 5, "endLine": 10, "content": "new content"}
            ]
        }
        
        event = StreamEvent.ai_patch_proposed(
            agent_name="code_execution_agent",
            patches=patches,
            file_count=1
        )
        
        assert event.event_type == EventType.AI_PATCH_PROPOSED
        assert event.agent_name == "code_execution_agent"
        assert event.data["file_count"] == 1
        assert "patches" in event.data

    def test_ai_patch_accepted_event(self):
        """Test AI_PATCH_ACCEPTED event creation."""
        event = StreamEvent.ai_patch_accepted(
            agent_name="code_execution_agent",
            file_path="src/app.py"
        )
        
        assert event.event_type == EventType.AI_PATCH_ACCEPTED
        assert event.data["file_path"] == "src/app.py"

    def test_ai_patch_rejected_event(self):
        """Test AI_PATCH_REJECTED event creation."""
        event = StreamEvent.ai_patch_rejected(
            agent_name="code_execution_agent",
            file_path="src/app.py"
        )
        
        assert event.event_type == EventType.AI_PATCH_REJECTED
        assert event.data["file_path"] == "src/app.py"


class TestPatchWorkflowIntegration:
    """Integration tests for the full patch workflow."""

    @pytest.mark.asyncio
    async def test_patch_file_tool_apply_patches(self):
        """Test applying multiple patches to multiple files."""
        tool = PatchFileTool()
        
        patches = {
            "file1.txt": [
                PatchOperation(action="replace", startLine=1, endLine=1, content="new content")
            ],
            "file2.txt": [
                PatchOperation(action="insert", startLine=1, content="first line")
            ]
        }
        
        # Mock the HTTP client
        with patch('httpx.AsyncClient') as mock_client:
            # Setup mock responses for download
            mock_response_download = MagicMock()
            mock_response_download.status_code = 200
            mock_response_download.json.return_value = {
                "data": {"content": "original content"}
            }
            
            # Setup mock responses for upload
            mock_response_upload = MagicMock()
            mock_response_upload.status_code = 200
            mock_response_upload.json.return_value = {
                "data": {"results": [{"success": True}]}
            }
            
            mock_client.return_value.__aenter__.return_value.get.side_effect = [
                mock_response_download,  # file1
                mock_response_download,  # file2
            ]
            mock_client.return_value.__aenter__.return_value.post.side_effect = [
                mock_response_upload,  # file1
                mock_response_upload,  # file2
            ]
            
            results = await tool.apply_patches("project-123", patches)
            
            assert results["file1.txt"] == True
            assert results["file2.txt"] == True

    @pytest.mark.asyncio
    async def test_patch_file_tool_file_not_found(self):
        """Test patch when file doesn't exist."""
        tool = PatchFileTool()
        
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 404
            
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            
            result = await tool.apply_patch(
                "project-123",
                "nonexistent.txt",
                [PatchOperation(action="replace", startLine=1, content="test")]
            )
            
            assert result["success"] == False
            assert "not found" in result["error"].lower()
