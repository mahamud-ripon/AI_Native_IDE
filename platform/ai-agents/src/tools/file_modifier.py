from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


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

        Tries batch endpoint first for efficiency.  Falls back to individual
        file writes if the batch call fails or returns all-False results so
        that a missing/broken endpoint never silently swallows the files.

        Args:
            project_id: Project identifier
            files: Dict mapping file paths to contents
            stop_on_error: If True, stop on first error in fallback loop

        Returns:
            Dict mapping file paths to success status
        """
        if not files:
            return {}

        # ── 1. Attempt batch endpoint ──────────────────────────────────────
        batch_results = await self._try_batch_sync(project_id, files)

        # If every file came back False the endpoint likely does not exist or
        # returned an error body — fall through to the individual fallback.
        if any(batch_results.values()):
            return batch_results

        logger.warning(
            "[FileModifier] Batch sync returned all-False for project %s — "
            "falling back to individual file writes (%d files)",
            project_id,
            len(files),
        )

        # ── 2. Individual fallback ─────────────────────────────────────────
        individual_results: Dict[str, bool] = {}
        for path, content in files.items():
            ok = await self.modify_file(project_id, path, content)
            individual_results[path] = ok
            if not ok and stop_on_error:
                # Mark remaining files as not attempted
                for remaining in files:
                    if remaining not in individual_results:
                        individual_results[remaining] = False
                break

        return individual_results

    async def _try_batch_sync(
        self,
        project_id: str,
        files: Dict[str, str],
    ) -> Dict[str, bool]:
        """Internal: attempt a single batch POST to the sync endpoint.

        Returns a dict of {path: success}.  All values are False when the
        request itself fails (network error, non-200, unexpected body).
        """
        async with httpx.AsyncClient() as client:
            try:
                files_array = [
                    {"path": path, "content": content}
                    for path, content in files.items()
                ]
                response = await client.post(
                    f"{self.api_url}/api/v1/projects/{project_id}/files/sync",
                    json={"files": files_array},
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=60.0,
                )

                if response.status_code != 200:
                    logger.warning(
                        "[FileModifier] Batch sync HTTP %s for project %s",
                        response.status_code,
                        project_id,
                    )
                    return {path: False for path in files}

                data: Dict[str, Any] = response.json()
                results: Dict[str, bool] = {}

                # Standard envelope: data.results[]
                raw_results = data.get("data", {}).get("results", [])
                if raw_results:
                    for item in raw_results:
                        results[item["path"]] = bool(item.get("success", False))
                else:
                    # Unexpected shape — treat all as failed so fallback kicks in
                    return {path: False for path in files}

                # Fill in any paths the server omitted
                for path in files:
                    results.setdefault(path, False)

                return results

            except httpx.TimeoutException:
                logger.warning("[FileModifier] Batch sync timed out for project %s", project_id)
                return {path: False for path in files}
            except Exception as exc:  # noqa: BLE001
                logger.warning("[FileModifier] Batch sync error for project %s: %s", project_id, exc)
                return {path: False for path in files}

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
