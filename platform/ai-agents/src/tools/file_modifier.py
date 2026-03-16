from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx


class FileModifier:
    """Modify files via WebSocket to avoid CRDT conflicts.

    IMPORTANT: Do NOT write directly to DB.
    Must use WebSocket/API to avoid overwriting Yjs CRDT state.
    """

    def __init__(self) -> None:
        self.ws_url = os.getenv("WS_GATEWAY_URL", "ws://localhost:8001")
        self.api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
        self.system_token = os.getenv("SYSTEM_TOKEN", "")

    async def modify_file(
        self,
        project_id: str,
        file_path: str,
        content: str,
        source: str = "ai_agent",
    ) -> bool:
        """Modify a single file via API sync endpoint.

        Flow:
        1. Send content to API gateway
        2. API applies diff through Yjs CRDT
        3. Wait for ACK before returning

        Args:
            project_id: Project identifier
            file_path: Path to file relative to project root
            content: New file content
            source: Source identifier for audit

        Returns:
            True if modification was acknowledged
        """
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.api_url}/api/v1/projects/{project_id}/files/sync",
                    json={
                        "file_path": file_path,
                        "content": content,
                        "source": source,
                    },
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return False

                data: Dict[str, Any] = response.json()
                return bool(data.get("acknowledged", True))

            except httpx.TimeoutException:
                return False
            except Exception:
                return False

    async def create_files(
        self,
        project_id: str,
        files: Dict[str, str],
        stop_on_error: bool = True,
    ) -> Dict[str, bool]:
        """Create multiple files using batch sync API.

        Args:
            project_id: Project identifier
            files: Dict mapping file paths to contents
            stop_on_error: If True, stop on first error

        Returns:
            Dict mapping file paths to success status
        """
        # Use batch API for efficiency
        async with httpx.AsyncClient() as client:
            try:
                files_array = [{"path": path, "content": content} for path, content in files.items()]
                response = await client.post(
                    f"{self.api_url}/api/v1/projects/{project_id}/files/sync",
                    json={"files": files_array},
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=60.0,
                )

                if response.status_code != 200:
                    return {path: False for path in files.keys()}

                data: Dict[str, Any] = response.json()
                results: Dict[str, bool] = {}
                
                if data.get("data", {}).get("results"):
                    for result in data["data"]["results"]:
                        results[result["path"]] = result["success"]
                
                return results

            except httpx.TimeoutException:
                return {path: False for path in files.keys()}
            except Exception:
                return {path: False for path in files.keys()}

    async def read_file(self, project_id: str, file_path: str) -> Optional[str]:
        """Read file content.

        Args:
            project_id: Project identifier
            file_path: Path to file relative to project root

        Returns:
            File content or None if not found
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
                    data: Dict[str, Any] = response.json()
                    return data.get("content", "")
                return None

            except Exception:
                return None

    async def delete_file(self, project_id: str, file_path: str) -> bool:
        """Delete a file.

        Args:
            project_id: Project identifier
            file_path: Path to file relative to project root

        Returns:
            True if deletion was successful
        """
        async with httpx.AsyncClient() as client:
            try:
                response = await client.delete(
                    f"{self.api_url}/api/v1/projects/{project_id}/files",
                    json={"file_path": file_path},
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=30.0,
                )
                return response.status_code == 200

            except Exception:
                return False

    async def list_files(
        self,
        project_id: str,
        directory: str = "",
    ) -> List[str]:
        """List files in a directory.

        Args:
            project_id: Project identifier
            directory: Directory path relative to project root

        Returns:
            List of file paths
        """
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.api_url}/api/v1/projects/{project_id}/files/list",
                    params={"directory": directory},
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=30.0,
                )

                if response.status_code == 200:
                    data: Dict[str, Any] = response.json()
                    return data.get("files", [])
                return []

            except Exception:
                return []
