from __future__ import annotations

from typing import Any, Dict, List, Optional

from .bash_executor import BashExecutor
from .file_modifier import FileModifier


class ToolRegistry:
    """Central registry for all AI agent tools.

    Provides unified interface for:
    - File modification (via WebSocket/CRDT)
    - Command execution (via Firecracker VM)
    """

    def __init__(self) -> None:
        self.file_modifier = FileModifier()
        self.bash_executor = BashExecutor()

    async def execute_tool(
        self,
        tool_name: str,
        project_id: str,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Execute a tool by name.

        Args:
            tool_name: Name of the tool to execute
            project_id: Project identifier
            **kwargs: Tool-specific arguments

        Returns:
            Tool execution result

        Raises:
            ValueError: If tool name is unknown
        """
        if tool_name == "modify_file":
            success = await self.file_modifier.modify_file(
                project_id,
                kwargs.get("file_path", ""),
                kwargs.get("content", ""),
                kwargs.get("source", "ai_agent"),
            )
            return {"success": success, "tool": "modify_file"}

        if tool_name == "create_files":
            results = await self.file_modifier.create_files(
                project_id,
                kwargs.get("files", {}),
                kwargs.get("stop_on_error", True),
            )
            return {"results": results, "tool": "create_files"}

        if tool_name == "read_file":
            content = await self.file_modifier.read_file(
                project_id,
                kwargs.get("file_path", ""),
            )
            return {"content": content, "tool": "read_file"}

        if tool_name == "delete_file":
            success = await self.file_modifier.delete_file(
                project_id,
                kwargs.get("file_path", ""),
            )
            return {"success": success, "tool": "delete_file"}

        if tool_name == "list_files":
            files = await self.file_modifier.list_files(
                project_id,
                kwargs.get("directory", ""),
            )
            return {"files": files, "tool": "list_files"}

        if tool_name == "execute":
            result = await self.bash_executor.execute(
                project_id,
                kwargs.get("command", ""),
                kwargs.get("timeout", 60),
                kwargs.get("cwd"),
                kwargs.get("env"),
            )
            return {**result, "tool": "execute"}

        if tool_name == "run_tests":
            result = await self.bash_executor.run_tests(
                project_id,
                kwargs.get("test_command", "npm test"),
                kwargs.get("timeout", 120),
            )
            return {**result, "tool": "run_tests"}

        if tool_name == "install_dependencies":
            result = await self.bash_executor.install_dependencies(
                project_id,
                kwargs.get("package_manager", "npm"),
                kwargs.get("timeout", 180),
            )
            return {**result, "tool": "install_dependencies"}

        if tool_name == "build_project":
            result = await self.bash_executor.build_project(
                project_id,
                kwargs.get("build_command", "npm run build"),
                kwargs.get("timeout", 120),
            )
            return {**result, "tool": "build_project"}

        if tool_name == "health_check":
            healthy = await self.bash_executor.health_check(project_id)
            return {"healthy": healthy, "tool": "health_check"}

        if tool_name == "run_command":
            result = await self.bash_executor.execute(
                project_id,
                kwargs.get("command", ""),
                kwargs.get("timeout", 60),
                kwargs.get("cwd"),
                kwargs.get("env"),
            )
            return {
                "stdout": result.get("stdout", ""),
                "stderr": result.get("stderr", ""),
                "exit_code": result.get("exit_code", -1),
                "tool": "run_command"
            }

        if tool_name == "scaffold_project":
            from .scaffold_project_tool import scaffold_project_tool
            return await scaffold_project_tool.scaffold(
                project_id,
                kwargs.get("template", ""),
                kwargs.get("project_name")
            )

        if tool_name == "dev_server":
            from .dev_server_tool import dev_server_tool
            action = kwargs.get("action", "start")
            if action == "start":
                return await dev_server_tool.start(
                    project_id,
                    kwargs.get("command", ""),
                    kwargs.get("name", "dev"),
                    kwargs.get("port", 3000),
                    kwargs.get("cwd")
                )
            elif action == "stop":
                return await dev_server_tool.stop(project_id, kwargs.get("name", "dev"))
            elif action == "status":
                return dev_server_tool.get_status(project_id, kwargs.get("name"))
            else:
                return {"success": False, "error": f"Unknown action: {action}"}

        if tool_name == "database":
            from .database_tool import database_tool
            action = kwargs.get("action", "create")
            if action == "create":
                return await database_tool.create_database(
                    project_id,
                    kwargs.get("database_name"),
                    kwargs.get("user", "user"),
                    kwargs.get("password", "pass")
                )
            elif action == "migrate":
                return await database_tool.run_migrations(
                    project_id,
                    kwargs.get("migration_path", "./migrations"),
                    kwargs.get("database_url")
                )
            elif action == "reset":
                return await database_tool.reset_database(
                    project_id,
                    kwargs.get("database_name")
                )
            elif action == "info":
                return await database_tool.get_connection_info(project_id)
            else:
                return {"success": False, "error": f"Unknown action: {action}"}

        raise ValueError(f"Unknown tool: {tool_name}")

    def list_tools(self) -> List[str]:
        """List all available tools."""
        return [
            "modify_file",
            "create_files",
            "patch_file",
            "read_file",
            "delete_file",
            "list_files",
            "execute",
            "run_command",
            "run_tests",
            "install_dependencies",
            "build_project",
            "health_check",
            "scaffold_project",
            "dev_server",
            "database",
        ]

    def get_tool_description(self, tool_name: str) -> str:
        """Get description for a tool."""
        descriptions = {
            "modify_file": "Modify a single file via CRDT-safe sync",
            "create_files": "Create multiple files at once",
            "patch_file": "Apply patch operations to existing files",
            "read_file": "Read content of a file",
            "delete_file": "Delete a file",
            "list_files": "List files in a directory",
            "execute": "Execute a bash command on VM",
            "run_command": "Execute shell command and return stdout/stderr/exit_code",
            "run_tests": "Run tests and parse results",
            "install_dependencies": "Install project dependencies",
            "build_project": "Build the project",
            "health_check": "Check if execution VM is healthy",
            "scaffold_project": "Scaffold project from template (react-vite, fastapi, etc.)",
            "dev_server": "Start/stop development servers",
            "database": "Create/reset PostgreSQL databases",
        }
        return descriptions.get(tool_name, "Unknown tool")


# Global registry instance
tool_registry = ToolRegistry()


def get_registry() -> ToolRegistry:
    """Get the global ToolRegistry instance."""
    return tool_registry
