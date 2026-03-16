"""Integration tests for Full-Stack Development Pipeline."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.tools.scaffold_project_tool import ScaffoldProjectTool, scaffold_project_tool
from src.tools.dev_server_tool import DevServerTool, dev_server_tool
from src.tools.database_tool import DatabaseTool, database_tool
from src.agents.planner_agent.agent import ProjectPlannerAgent, project_planner_agent


class TestScaffoldProjectTool:
    """Tests for ScaffoldProjectTool."""

    @pytest.fixture
    def tool(self):
        return ScaffoldProjectTool()

    def test_list_templates(self, tool):
        """Test listing available templates."""
        templates = tool.list_templates()
        
        assert len(templates) >= 5
        names = [t["name"] for t in templates]
        assert "react-vite" in names
        assert "fastapi" in names
        assert "fullstack-react-fastapi" in names

    def test_get_template(self, tool):
        """Test getting a specific template."""
        template = tool.get_template("react-vite")
        
        assert template is not None
        assert template["name"] == "react-vite"
        assert "files" in template
        assert "dependencies" in template

    def test_get_template_not_found(self, tool):
        """Test getting non-existent template."""
        template = tool.get_template("nonexistent")
        
        assert template is None

    def test_get_dependencies(self, tool):
        """Test getting dependencies for a template."""
        deps = tool.get_dependencies("react-vite")
        
        assert "react" in deps
        assert "react-dom" in deps

    def test_get_dev_command(self, tool):
        """Test getting dev command for a template."""
        cmd = tool.get_dev_command("react-vite")
        
        assert "npm run dev" in cmd

    def test_get_dev_port(self, tool):
        """Test getting dev port for a template."""
        port = tool.get_dev_port("react-vite")
        
        assert port == 5173

    @pytest.mark.asyncio
    async def test_scaffold_success(self, tool):
        """Test successful scaffolding."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            result = await tool.scaffold("project-123", "react-vite")
            
            assert result["success"] == True
            assert result["template"] == "react-vite"
            assert "files_created" in result

    @pytest.mark.asyncio
    async def test_scaffold_template_not_found(self, tool):
        """Test scaffolding with non-existent template."""
        result = await tool.scaffold("project-123", "nonexistent")
        
        assert result["success"] == False
        assert "not found" in result["error"].lower()


class TestDevServerTool:
    """Tests for DevServerTool."""

    @pytest.fixture
    def tool(self):
        return DevServerTool()

    def test_get_status_empty(self, tool):
        """Test getting status when no servers running."""
        result = tool.get_status("project-123")
        
        assert result["success"] == True
        assert result["servers"] == []

    def test_get_status_not_found(self, tool):
        """Test getting status for non-existent server returns empty."""
        # When project has no servers, returns success with empty list
        result = tool.get_status("project-123", "nonexistent")
        
        # Should return success=True since project exists but has no servers
        # The server name filter just returns empty servers list
        assert result["success"] == True
        assert result["servers"] == []


class TestDatabaseTool:
    """Tests for DatabaseTool."""

    @pytest.fixture
    def tool(self):
        return DatabaseTool()

    @pytest.mark.asyncio
    async def test_create_database(self, tool):
        """Test creating a database."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            result = await tool.create_database("project-123", "mydb")
            
            assert result["success"] == True
            assert result["database_name"] == "mydb"

    @pytest.mark.asyncio
    async def test_get_connection_info_not_found(self, tool):
        """Test getting connection info when no database."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 404
            
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            
            result = await tool.get_connection_info("project-123")
            
            assert result["success"] == False


class TestProjectPlannerAgent:
    """Tests for ProjectPlannerAgent."""

    @pytest.fixture
    def agent(self):
        return ProjectPlannerAgent()

    @pytest.mark.asyncio
    async def test_plan_react_fastapi(self, agent):
        """Test planning a React + FastAPI app."""
        plan = await agent.plan("build a todo app with React and FastAPI")
        
        assert plan.frontend_template == "react-vite"
        assert plan.backend_template == "fastapi"
        assert "react" in plan.dependencies

    @pytest.mark.asyncio
    async def test_plan_nextjs(self, agent):
        """Test planning a Next.js app."""
        plan = await agent.plan("build a website with Next.js")
        
        assert plan.frontend_template == "nextjs"
        assert plan.backend_template is None

    @pytest.mark.asyncio
    async def test_plan_fullstack_with_postgres(self, agent):
        """Test planning with PostgreSQL."""
        plan = await agent.plan("build an app with React, Node and PostgreSQL")
        
        assert plan.database == "postgresql"
        assert len(plan.services) >= 2

    @pytest.mark.asyncio
    async def test_plan_default(self, agent):
        """Test default planning when no specific framework."""
        plan = await agent.plan("build a todo app")
        
        # Should default to fullstack
        assert plan.frontend_template is not None or plan.backend_template is not None

    @pytest.mark.asyncio
    async def test_plan_express(self, agent):
        """Test planning with Express."""
        plan = await agent.plan("build an API with Express")
        
        assert plan.backend_template == "node-express"


class TestFullStackPipeline:
    """Integration tests for full pipeline."""

    @pytest.mark.asyncio
    async def test_scaffold_to_dev_server_flow(self):
        """Test flow from scaffolding to starting dev server."""
        # 1. Scaffold project
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            result = await scaffold_project_tool.scaffold("project-123", "react-vite")
            
            assert result["success"] == True
            dev_command = result["dev_command"]
            dev_port = result["dev_port"]
            
            assert "npm run dev" in dev_command
            assert dev_port == 5173

    @pytest.mark.asyncio
    async def test_planner_to_scaffold_flow(self):
        """Test flow from planning to scaffolding."""
        # 1. Plan
        plan = await project_planner_agent.plan("build a React + FastAPI app with PostgreSQL")
        
        assert plan.frontend_template is not None
        assert plan.backend_template is not None
        assert plan.database == "postgresql"
        
        # 2. Get template details
        template = scaffold_project_tool.get_template(plan.frontend_template)
        assert template is not None
        
        deps = template.get("dependencies", [])
        assert "react" in deps


class TestToolRegistry:
    """Tests for tool registry with new Phase-3 tools."""

    def test_list_all_tools(self):
        """Test that all tools are listed."""
        from src.tools.registry import tool_registry
        
        tools = tool_registry.list_tools()
        
        assert "scaffold_project" in tools
        assert "dev_server" in tools
        assert "database" in tools
        assert len(tools) == 15

    def test_tool_descriptions(self):
        """Test tool descriptions."""
        from src.tools.registry import tool_registry
        
        assert "Scaffold project from template" in tool_registry.get_tool_description("scaffold_project")
        assert "Start/stop development servers" in tool_registry.get_tool_description("dev_server")
        assert "Create/reset PostgreSQL databases" in tool_registry.get_tool_description("database")
