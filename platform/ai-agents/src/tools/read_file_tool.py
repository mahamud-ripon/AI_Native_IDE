"""Read File Tool - Read file content from project storage."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx


class ReadFileTool:
    """Tool for reading file content from project storage (S3 via project-service).
    
    Used by AI agents to understand existing code context before generating patches.
    """

    def __init__(self) -> None:
        self.api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
        self.system_token = os.getenv("SYSTEM_TOKEN", "")

    async def read_file(self, project_id: str, file_path: str) -> Dict[str, Any]:
        """Read file content from project storage.

        Args:
            project_id: Project identifier
            file_path: Path to file relative to project root

        Returns:
            Dict with success status and content or error
        """
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.api_url}/api/v1/projects/{project_id}/files/content",
                    params={"path": file_path},
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=30.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    content = data.get("data", {}).get("content", "")
                    return {
                        "success": True,
                        "content": content,
                        "file_path": file_path,
                        "language": data.get("data", {}).get("language"),
                        "tool": "read_file"
                    }
                elif response.status_code == 404:
                    return {
                        "success": False,
                        "error": f"File not found: {file_path}",
                        "file_path": file_path,
                        "tool": "read_file"
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Failed to read file: {response.status_code}",
                        "file_path": file_path,
                        "tool": "read_file"
                    }

            except httpx.TimeoutException:
                return {
                    "success": False,
                    "error": "Request timed out",
                    "file_path": file_path,
                    "tool": "read_file"
                }
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "file_path": file_path,
                    "tool": "read_file"
                }

    async def read_multiple(self, project_id: str, file_paths: list[str]) -> Dict[str, Any]:
        """Read multiple files at once.

        Args:
            project_id: Project identifier
            file_paths: List of file paths to read

        Returns:
            Dict mapping file paths to their content
        """
        results = {}
        
        for file_path in file_paths:
            result = await self.read_file(project_id, file_path)
            if result.get("success"):
                results[file_path] = result["content"]
            else:
                results[file_path] = None
        
        return results


# Singleton instance
read_file_tool = ReadFileTool()
