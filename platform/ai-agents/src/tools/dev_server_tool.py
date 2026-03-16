"""Dev Server Tool - Start/stop development servers."""

from __future__ import annotations

import asyncio
import os
from typing import Any, Dict, Optional

import httpx


class DevServer:
    """Represents a running development server."""
    
    def __init__(
        self,
        project_id: str,
        name: str,
        command: str,
        port: int,
        url: str,
        process: Optional[asyncio.subprocess.Process] = None
    ):
        self.project_id = project_id
        self.name = name
        self.command = command
        self.port = port
        self.url = url
        self.process = process
        self.is_running = process is not None


class DevServerTool:
    """Tool for managing development servers.
    
    Starts and stops dev servers inside runtime containers.
    Logs can be streamed via SSE.
    """

    def __init__(self) -> None:
        self.api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
        self.system_token = os.getenv("SYSTEM_TOKEN", "")
        self._servers: Dict[str, Dict[str, DevServer]] = {}

    async def start(
        self,
        project_id: str,
        command: str,
        name: str = "dev",
        port: int = 3000,
        cwd: Optional[str] = None
    ) -> Dict[str, Any]:
        """Start a development server.
        
        Args:
            project_id: Project identifier
            command: Command to start server (e.g., "npm run dev")
            name: Server name for tracking
            port: Expected port
            cwd: Working directory
            
        Returns:
            Dict with success status and server info
        """
        # Check if server already running
        if project_id in self._servers and name in self._servers[project_id]:
            server = self._servers[project_id][name]
            if server.is_running:
                return {
                    "success": False,
                    "error": f"Server '{name}' already running on port {server.port}",
                    "tool": "dev_server"
                }

        # Start server via execution service
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.api_url}/api/v1/projects/{project_id}/execute",
                    json={
                        "command": command,
                        "cwd": cwd,
                        "timeout": 3600,
                        "stream": True
                    },
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=30.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    
                    # Track server
                    if project_id not in self._servers:
                        self._servers[project_id] = {}
                    
                    server = DevServer(
                        project_id=project_id,
                        name=name,
                        command=command,
                        port=port,
                        url=f"http://localhost:{port}"
                    )
                    self._servers[project_id][name] = server
                    
                    return {
                        "success": True,
                        "name": name,
                        "command": command,
                        "port": port,
                        "url": f"http://localhost:{port}",
                        "task_id": data.get("data", {}).get("task_id"),
                        "tool": "dev_server"
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Failed to start server: {response.status_code}",
                        "tool": "dev_server"
                    }
                    
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "tool": "dev_server"
                }

    async def stop(
        self,
        project_id: str,
        name: str = "dev"
    ) -> Dict[str, Any]:
        """Stop a development server.
        
        Args:
            project_id: Project identifier
            name: Server name to stop
            
        Returns:
            Dict with success status
        """
        if project_id not in self._servers or name not in self._servers[project_id]:
            return {
                "success": False,
                "error": f"Server '{name}' not found",
                "tool": "dev_server"
            }
        
        server = self._servers[project_id][name]
        
        if server.process:
            server.process.terminate()
            try:
                await asyncio.wait_for(server.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                server.process.kill()
        
        server.is_running = False
        
        return {
            "success": True,
            "name": name,
            "tool": "dev_server"
        }

    def get_status(
        self,
        project_id: str,
        name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get status of running servers.
        
        Args:
            project_id: Project identifier
            name: Optional server name filter
            
        Returns:
            Dict with server status
        """
        if project_id not in self._servers:
            return {
                "success": True,
                "servers": [],
                "tool": "dev_server"
            }
        
        if name:
            server = self._servers[project_id].get(name)
            if not server:
                return {
                    "success": False,
                    "error": f"Server '{name}' not found",
                    "tool": "dev_server"
                }
            
            return {
                "success": True,
                "servers": [{
                    "name": server.name,
                    "command": server.command,
                    "port": server.port,
                    "url": server.url,
                    "is_running": server.is_running
                }],
                "tool": "dev_server"
            }
        
        servers = []
        for srv in self._servers[project_id].values():
            servers.append({
                "name": srv.name,
                "command": srv.command,
                "port": srv.port,
                "url": srv.url,
                "is_running": srv.is_running
            })
        
        return {
            "success": True,
            "servers": servers,
            "tool": "dev_server"
        }

    async def stop_all(self, project_id: str) -> Dict[str, Any]:
        """Stop all servers for a project.
        
        Args:
            project_id: Project identifier
            
        Returns:
            Dict with stopped servers
        """
        stopped = []
        
        if project_id in self._servers:
            for name in list(self._servers[project_id].keys()):
                result = await self.stop(project_id, name)
                if result.get("success"):
                    stopped.append(name)
        
        return {
            "success": True,
            "stopped": stopped,
            "tool": "dev_server"
        }


# Singleton instance
dev_server_tool = DevServerTool()
