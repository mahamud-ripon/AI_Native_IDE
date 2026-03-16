"""List Files Tool - List project files from storage."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx


class ListFilesTool:
    """Tool for listing project files from project-service.
    
    Used by AI agents to understand project structure before generating code.
    """

    def __init__(self) -> None:
        self.api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
        self.system_token = os.getenv("SYSTEM_TOKEN", "")

    async def list_files(self, project_id: str) -> Dict[str, Any]:
        """List all files in a project.

        Args:
            project_id: Project identifier

        Returns:
            Dict with success status and file list or error
        """
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.api_url}/api/v1/projects/{project_id}/tree",
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=30.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    # Extract file paths from tree structure
                    files = self._extract_files(data.get("data", {}))
                    return {
                        "success": True,
                        "files": files,
                        "count": len(files),
                        "tool": "list_files"
                    }
                elif response.status_code == 404:
                    return {
                        "success": False,
                        "error": f"Project not found: {project_id}",
                        "files": [],
                        "tool": "list_files"
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Failed to list files: {response.status_code}",
                        "files": [],
                        "tool": "list_files"
                    }

            except httpx.TimeoutException:
                return {
                    "success": False,
                    "error": "Request timed out",
                    "files": [],
                    "tool": "list_files"
                }
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "files": [],
                    "tool": "list_files"
                }

    def _extract_files(self, tree: Any) -> List[str]:
        """Extract file paths from tree structure.
        
        Args:
            tree: Tree structure from API
            
        Returns:
            List of file paths
        """
        files = []
        
        if not tree:
            return files
        
        # Handle tree structure with children
        if isinstance(tree, dict):
            children = tree.get("children", [])
            for child in children:
                if isinstance(child, dict):
                    path = child.get("name", "")
                    is_dir = child.get("isDirectory", False)
                    
                    if is_dir and children:
                        # Recursively get files from subdirectory
                        subfiles = self._extract_files(child)
                        for subfile in subfiles:
                            files.append(f"{path}/{subfile}")
                    elif not is_dir:
                        files.append(path)
        
        elif isinstance(tree, list):
            for item in tree:
                if isinstance(item, dict):
                    path = item.get("name", "")
                    is_dir = item.get("isDirectory", False)
                    
                    if is_dir:
                        subfiles = self._extract_files(item)
                        for subfile in subfiles:
                            files.append(f"{path}/{subfile}")
                    else:
                        files.append(path)
        
        return files

    async def list_by_extension(self, project_id: str, extension: str) -> Dict[str, Any]:
        """List files filtered by extension.

        Args:
            project_id: Project identifier
            extension: File extension (e.g., ".py", ".js")

        Returns:
            Dict with filtered file list
        """
        result = await self.list_files(project_id)
        
        if result.get("success"):
            ext = extension if extension.startswith(".") else f".{extension}"
            filtered = [f for f in result["files"] if f.endswith(ext)]
            result["files"] = filtered
            result["count"] = len(filtered)
        
        return result


# Singleton instance
list_files_tool = ListFilesTool()
