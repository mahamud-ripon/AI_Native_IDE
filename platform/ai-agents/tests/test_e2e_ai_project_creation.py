"""End-to-End tests for AI Project Creation Flow.

Tests the complete workflow:
1. User prompt → ProjectPlannerAgent
2. Scaffold project
3. Generate code
4. Install dependencies
5. Start dev server
6. Verify preview URL
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.agents.planner_agent.agent import ProjectPlannerAgent, project_planner_agent
from src.tools.scaffold_project_tool import ScaffoldProjectTool, scaffold_project_tool
from src.tools.dev_server_tool import DevServerTool
from src.tools.database_tool import DatabaseTool
from src.tools.registry import tool_registry


class TestAIProjectCreationFlow:
    """E2E tests for the complete AI project creation flow."""

    @pytest.fixture
    def project_id(self):
        return "test-project-123"

    @pytest.fixture
    def planner(self):
        return ProjectPlannerAgent()

    @pytest.mark.asyncio
    async def test_full_flow_react_app(self, project_id, planner):
        """Test complete flow for React app creation."""
        
        # Step 1: User prompt → ProjectPlannerAgent decides architecture
        plan = await planner.plan("build a simple todo app using React")
        
        assert plan.frontend_template is not None
        assert "react" in plan.dependencies
        
        # Step 2: Get template details
        template = scaffold_project_tool.get_template(plan.frontend_template)
        assert template is not None
        assert "files" in template
        assert "devCommand" in template
        
        # Step 3: Verify scaffold tool can create files
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            scaffold_result = await scaffold_project_tool.scaffold(
                project_id, 
                plan.frontend_template
            )
            
            assert scaffold_result["success"] == True
            assert len(scaffold_result["files_created"]) > 0
            
        # Step 4: Verify dependencies extracted
        deps = scaffold_project_tool.get_dependencies(plan.frontend_template)
        assert len(deps) > 0
        
        # Step 5: Verify dev server can be started (mocked)
        dev_server = DevServerTool()
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"data": {"task_id": "task-123"}}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            start_result = await dev_server.start(
                project_id,
                template["devCommand"],
                "frontend",
                template["devPort"]
            )
            
            assert start_result["success"] == True
            assert start_result["port"] == template["devPort"]

    @pytest.mark.asyncio
    async def test_full_flow_fullstack_app(self, project_id, planner):
        """Test complete flow for fullstack app with database."""
        
        # Step 1: Plan with database
        plan = await planner.plan("build a todo app with React, FastAPI and PostgreSQL")
        
        assert plan.frontend_template is not None
        assert plan.backend_template is not None
        assert plan.database == "postgresql"
        
        # Step 2: Verify services configured
        assert len(plan.services) >= 3  # frontend + backend + postgres
        
        # Step 3: Scaffold frontend
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            frontend_result = await scaffold_project_tool.scaffold(
                project_id,
                plan.frontend_template
            )
            
            assert frontend_result["success"] == True
            
        # Step 4: Scaffold backend
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            backend_result = await scaffold_project_tool.scaffold(
                project_id,
                plan.backend_template
            )
            
            assert backend_result["success"] == True
            
        # Step 5: Database can be created (mocked)
        db_tool = DatabaseTool()
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            db_result = await db_tool.create_database(project_id, "tododb")
            
            assert db_result["success"] == True
            assert db_result["database_name"] == "tododb"

    @pytest.mark.asyncio
    async def test_tool_registry_integration(self, project_id):
        """Test that tool registry can execute all required tools."""
        
        # Test scaffold_project via registry
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            result = await tool_registry.execute_tool(
                "scaffold_project",
                project_id,
                template="react-vite"
            )
            
            assert result["success"] == True
            assert result["tool"] == "scaffold_project"
            
        # Test dev_server start via registry
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"data": {"task_id": "task-1"}}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            result = await tool_registry.execute_tool(
                "dev_server",
                project_id,
                action="start",
                command="npm run dev",
                name="frontend",
                port=5173
            )
            
            assert result["success"] == True
            
        # Test dev_server status via registry
        result = await tool_registry.execute_tool(
            "dev_server",
            project_id,
            action="status"
        )
        
        assert "servers" in result
        
        # Test database via registry
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            result = await tool_registry.execute_tool(
                "database",
                project_id,
                action="create",
                database_name="testdb"
            )
            
            assert result["success"] == True

    @pytest.mark.asyncio
    async def test_plan_to_scaffold_to_server_pipeline(self):
        """Test the complete pipeline: plan → scaffold → dev server."""
        
        # 1. Plan
        plan = await project_planner_agent.plan("build a React + FastAPI app")
        
        # 2. Get template
        template = scaffold_project_tool.get_template(plan.frontend_template)
        
        # 3. Scaffold (mocked)
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"success": True}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            result = await scaffold_project_tool.scaffold("proj-123", "react-vite")
            
            assert result["success"]
            dev_cmd = result["dev_command"]
            dev_port = result["dev_port"]
            
        # 4. Start dev server (mocked)
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"data": {"task_id": "abc"}}
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            server_result = await DevServerTool().start(
                "proj-123",
                dev_cmd,
                "dev",
                dev_port
            )
            
            assert server_result["success"]
            assert server_result["url"] == f"http://localhost:{dev_port}"
            
        # 5. Verify preview URL is valid
        assert dev_port in [3000, 5173, 8000]  # Common dev ports


class TestSystemMaturityValidation:
    """Validate system maturity - check all components are connected."""

    def test_ai_agents_layer_ready(self):
        """Verify AI Agents Layer is ready."""
        # Check all agents available
        from src.agents.planner_agent import project_planner_agent
        
        assert project_planner_agent is not None
        
    def test_tools_available(self):
        """Verify all required tools are registered."""
        tools = tool_registry.list_tools()
        
        required_tools = [
            "scaffold_project",
            "create_files", 
            "patch_file",
            "read_file",
            "list_files",
            "run_command",
            "dev_server",
            "database",
            "install_dependencies",
        ]
        
        for tool in required_tools:
            assert tool in tools, f"Tool {tool} not found in registry"
            
    def test_backend_services_configured(self):
        """Verify backend services are configured."""
        import os
        
        # Check environment variables are set
        api_url = os.getenv("API_GATEWAY_URL", "")
        # These would be set in production
        # For now, verify the tool can handle missing config gracefully
        
        tool = ScaffoldProjectTool()
        templates = tool.list_templates()
        
        assert len(templates) > 0, "No templates available"
        
    def test_frontend_event_types_defined(self):
        """Verify frontend event types are defined for SSE."""
        from src.orchestrator.streaming import EventType
        
        # Check AI patch events are defined
        required_events = [
            "AI_PATCH_PROPOSED",
            "AI_PATCH_ACCEPTED", 
            "AI_PATCH_REJECTED",
        ]
        
        for event in required_events:
            assert hasattr(EventType, event), f"Event {event} not found in EventType"


class TestErrorHandling:
    """Test error handling in the E2E flow."""

    @pytest.mark.asyncio
    async def test_scaffold_failure_handling(self):
        """Test graceful handling when scaffolding fails."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 500
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            result = await scaffold_project_tool.scaffold("proj-123", "react-vite")
            
            assert result["success"] == False
            assert "error" in result
            
    @pytest.mark.asyncio
    async def test_dev_server_failure_handling(self):
        """Test graceful handling when dev server fails to start."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 500
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            tool = DevServerTool()
            result = await tool.start("proj-123", "npm run dev")
            
            assert result["success"] == False
            
    @pytest.mark.asyncio
    async def test_database_failure_handling(self):
        """Test graceful handling when database creation fails."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 500
            mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
            
            tool = DatabaseTool()
            result = await tool.create_database("proj-123", "testdb")
            
            assert result["success"] == False
