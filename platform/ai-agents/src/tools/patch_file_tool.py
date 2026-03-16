"""Patch File Tool - Apply patch operations to existing files.

This tool downloads a file from project-service, applies patch operations,
and uploads the modified content back.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

from ..orchestrator.state_schema import PatchOperation


class PatchFileTool:
    """Tool for applying patch operations to existing files.
    
    Flow:
    1. Download current file content from project-service
    2. Parse and apply patch operations
    3. Upload modified content back to project-service
    4. Emit file.modified event
    """

    def __init__(self) -> None:
        self.api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
        self.system_token = os.getenv("SYSTEM_TOKEN", "")

    async def apply_patch(
        self,
        project_id: str,
        file_path: str,
        operations: List[PatchOperation],
    ) -> Dict[str, Any]:
        """Apply patch operations to an existing file.

        Args:
            project_id: Project identifier
            file_path: Path to file relative to project root
            operations: List of patch operations to apply

        Returns:
            Dict with success status and result
        """
        # Step 1: Download current file content
        current_content = await self._download_file(project_id, file_path)
        
        if current_content is None:
            return {
                "success": False,
                "error": f"File not found: {file_path}",
                "tool": "patch_file"
            }
        
        # Step 2: Apply patch operations
        modified_content = self._apply_operations(current_content, operations)
        
        # Step 3: Upload modified content
        success = await self._upload_file(project_id, file_path, modified_content)
        
        return {
            "success": success,
            "file_path": file_path,
            "operations_applied": len(operations),
            "tool": "patch_file"
        }

    async def _download_file(self, project_id: str, file_path: str) -> Optional[str]:
        """Download file content from project-service."""
        async with httpx.AsyncClient() as client:
            try:
                encoded_path = os.path.basename(file_path)
                response = await client.get(
                    f"{self.api_url}/api/v1/projects/{project_id}/files/content",
                    params={"path": file_path},
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=30.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    return data.get("data", {}).get("content", "")
                return None

            except Exception:
                return None

    async def _upload_file(
        self, project_id: str, file_path: str, content: str
    ) -> bool:
        """Upload modified file to project-service."""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.api_url}/api/v1/projects/{project_id}/files/sync",
                    json={
                        "files": [{"path": file_path, "content": content}]
                    },
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=60.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    results = data.get("data", {}).get("results", [])
                    if results and results[0].get("success"):
                        return True
                return False

            except Exception:
                return False

    def _apply_operations(
        self, content: str, operations: List[PatchOperation]
    ) -> str:
        """Apply patch operations to file content.
        
        Args:
            content: Original file content
            operations: List of patch operations
            
        Returns:
            Modified file content
        """
        lines = content.split('\n')
        
        # Sort operations by startLine in reverse order to avoid line number shifts
        sorted_ops = sorted(operations, key=lambda op: op.startLine, reverse=True)
        
        for op in sorted_ops:
            start = op.startLine - 1  # Convert to 0-based index
            
            if op.action == "replace":
                end = op.endLine if op.endLine is not None else start + 1
                end = min(end, len(lines))  # Clamp to array bounds
                new_content = op.content or ""
                lines[start:end] = [new_content]
                
            elif op.action == "insert":
                new_content = op.content or ""
                lines.insert(start, new_content)
                
            elif op.action == "delete":
                end = op.endLine if op.endLine is not None else start + 1
                end = min(end, len(lines))
                lines[start:end] = []
        
        return '\n'.join(lines)

    async def apply_patches(
        self,
        project_id: str,
        patches: Dict[str, List[PatchOperation]],
    ) -> Dict[str, bool]:
        """Apply multiple patch operations to multiple files.

        Args:
            project_id: Project identifier
            patches: Dict mapping file paths to list of patch operations

        Returns:
            Dict mapping file paths to success status
        """
        results: Dict[str, bool] = {}
        
        for file_path, operations in patches.items():
            result = await self.apply_patch(project_id, file_path, operations)
            results[file_path] = result.get("success", False)
        
        return results


# Singleton instance
patch_file_tool = PatchFileTool()
