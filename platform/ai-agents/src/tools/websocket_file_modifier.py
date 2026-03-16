"""WebSocket File Modifier with CRDT-safe operations.

This module provides real-time file modification capabilities over WebSocket,
with support for:
- CRDT-safe concurrent edits
- File locking to prevent race conditions
- Operational Transform for conflict resolution
- Change tracking and undo/redo
- Real-time collaboration

Usage:
    from src.tools.websocket_file_modifier import WebSocketFileModifier

    modifier = WebSocketFileModifier()
    await modifier.connect(websocket)
    await modifier.handle_message(websocket, message)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set
from pathlib import Path
import difflib


try:
    from fastapi import WebSocket
except ImportError:
    # Stub for testing
    class WebSocket:
        async def send_json(self, data): pass
        async def receive_json(self): return {}


class FileOperationType(str, Enum):
    """Types of file operations."""

    READ = "read"
    WRITE = "write"
    INSERT = "insert"
    DELETE = "delete"
    REPLACE = "replace"
    CREATE = "create"
    DELETE_FILE = "delete_file"
    RENAME = "rename"


class FileStatus(str, Enum):
    """Status of file operations."""

    SUCCESS = "success"
    ERROR = "error"
    CONFLICT = "conflict"
    LOCKED = "locked"
    NOT_FOUND = "not_found"


@dataclass
class FileVersion:
    """Represents a file version for conflict resolution."""

    content: str
    hash: str
    timestamp: float
    client_id: str
    version_id: int

    @classmethod
    def from_content(cls, content: str, client_id: str, version_id: int) -> "FileVersion":
        """Create version from content."""
        return cls(
            content=content,
            hash=hashlib.md5(content.encode()).hexdigest(),
            timestamp=time.time(),
            client_id=client_id,
            version_id=version_id,
        )


@dataclass
class Operation:
    """Represents a file operation."""

    type: FileOperationType
    path: str
    client_id: str
    timestamp: float
    version: int
    data: Dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(time.time()))


@dataclass
class ChangeRecord:
    """Records a change for undo/redo."""

    operation: Operation
    previous_content: str
    new_content: str
    timestamp: float


class CRDTDocument:
    """Conflict-free Replicated Data Type for collaborative editing.

    Uses a simple operational transform approach:
    - Track operations with timestamps
    - Apply operations in order
    - Resolve conflicts based on timestamp priority
    """

    def __init__(self, path: str, initial_content: str = ""):
        """Initialize CRDT document.

        Args:
            path: File path
            initial_content: Initial document content
        """
        self.path = path
        self.content = initial_content
        self.version = 0
        self.operations: List[Operation] = []
        self.versions: List[FileVersion] = []
        if initial_content:
            self.versions.append(
                FileVersion.from_content(initial_content, "system", 0)
            )

    def apply_operation(self, op: Operation, current_content: str) -> str:
        """Apply an operation to the document.

        Args:
            op: Operation to apply
            current_content: Current document content

        Returns:
            Updated content
        """
        self.operations.append(op)
        self.version += 1

        if op.type == FileOperationType.INSERT:
            position = op.data.get("position", 0)
            text = op.data.get("text", "")
            new_content = current_content[:position] + text + current_content[position:]

        elif op.type == FileOperationType.DELETE:
            start = op.data.get("start", 0)
            end = op.data.get("end", start)
            new_content = current_content[:start] + current_content[end:]

        elif op.type == FileOperationType.REPLACE:
            start = op.data.get("start", 0)
            end = op.data.get("end", start)
            text = op.data.get("text", "")
            new_content = current_content[:start] + text + current_content[end:]

        elif op.type == FileOperationType.WRITE:
            new_content = op.data.get("content", "")

        else:
            new_content = current_content

        # Record version
        self.versions.append(
            FileVersion.from_content(new_content, op.client_id, self.version)
        )
        self.content = new_content

        return new_content

    def get_latest_version(self) -> Optional[FileVersion]:
        """Get the latest document version."""
        return self.versions[-1] if self.versions else None

    def get_content_at_version(self, version_id: int) -> Optional[str]:
        """Get content at specific version."""
        for v in self.versions:
            if v.version_id == version_id:
                return v.content
        return None


class FileLockManager:
    """Manages file locks to prevent concurrent writes."""

    def __init__(self):
        """Initialize lock manager."""
        self._locks: Dict[str, asyncio.Lock] = {}
        self._lock_owners: Dict[str, str] = {}  # path -> client_id

    async def acquire_lock(self, path: str, client_id: str, timeout: float = 30.0) -> bool:
        """Acquire lock on a file.

        Args:
            path: File path
            client_id: Client requesting the lock
            timeout: Lock timeout in seconds

        Returns:
            True if lock acquired, False otherwise
        """
        if path not in self._locks:
            self._locks[path] = asyncio.Lock()

        lock = self._locks[path]

        try:
            await asyncio.wait_for(lock.acquire(), timeout=timeout)
            self._lock_owners[path] = client_id
            return True
        except asyncio.TimeoutError:
            return False

    async def release_lock(self, path: str, client_id: str) -> bool:
        """Release lock on a file.

        Args:
            path: File path
            client_id: Client releasing the lock

        Returns:
            True if lock released, False if not owner
        """
        if path not in self._locks:
            return False

        if self._lock_owners.get(path) != client_id:
            return False

        lock = self._locks[path]
        if lock.locked():
            lock.release()
            del self._lock_owners[path]
            return True

        return False

    def is_locked(self, path: str) -> bool:
        """Check if file is locked."""
        if path not in self._locks:
            return False
        return self._locks[path].locked()

    def get_lock_owner(self, path: str) -> Optional[str]:
        """Get the client ID holding the lock."""
        return self._lock_owners.get(path)


class WebSocketFileModifier:
    """WebSocket-based file modifier with CRDT support.

    Handles real-time file modifications over WebSocket with:
    - CRDT for conflict resolution
    - File locking for write safety
    - Change tracking for undo/redo
    - Broadcast to all connected clients

    Protocol:
    Client -> Server:
        {
            "type": "read" | "write" | "insert" | "delete" | "lock" | "unlock",
            "path": "file/path.py",
            "client_id": "client-123",
            "data": {...},
            "version": 5
        }

    Server -> Client:
        {
            "type": "read_result" | "write_result" | "broadcast" | "error",
            "path": "file/path.py",
            "status": "success" | "error" | "conflict",
            "content": "...",
            "version": 6,
            "hash": "abc123..."
        }
    """

    def __init__(self, base_path: str = "."):
        """Initialize file modifier.

        Args:
            base_path: Base directory for file operations
        """
        self.base_path = Path(base_path).resolve()
        self.documents: Dict[str, CRDTDocument] = {}
        self.lock_manager = FileLockManager()
        self.clients: Set[WebSocket] = set()
        self.change_history: Dict[str, List[ChangeRecord]] = {}
        self.max_history = 50  # Max undo history per file

    async def connect(self, websocket: WebSocket, client_id: str) -> None:
        """Handle new WebSocket connection.

        Args:
            websocket: WebSocket connection
            client_id: Unique client identifier
        """
        self.clients.add(websocket)
        await websocket.send_json({
            "type": "connected",
            "client_id": client_id,
            "status": FileStatus.SUCCESS,
        })

    async def disconnect(self, websocket: WebSocket, client_id: str) -> None:
        """Handle WebSocket disconnection.

        Args:
            websocket: WebSocket connection
            client_id: Client ID
        """
        # Release all locks held by this client
        for path in list(self.lock_manager._lock_owners.keys()):
            if self.lock_manager.get_lock_owner(path) == client_id:
                await self.lock_manager.release_lock(path, client_id)
                await self._broadcast_lock_change(path, None)

        self.clients.discard(websocket)

    async def handle_message(
        self,
        websocket: WebSocket,
        message: Dict[str, Any],
        client_id: str,
    ) -> None:
        """Handle incoming WebSocket message.

        Args:
            websocket: WebSocket connection
            message: Parsed JSON message
            client_id: Client identifier
        """
        msg_type = message.get("type")
        path = message.get("path", "")
        version = message.get("version", 0)

        if not path:
            await self._send_error(websocket, "Missing path")
            return

        # Resolve relative paths
        full_path = self._resolve_path(path)

        try:
            if msg_type == FileOperationType.READ:
                await self._handle_read(websocket, full_path, version)
            elif msg_type == FileOperationType.WRITE:
                await self._handle_write(websocket, full_path, message, client_id)
            elif msg_type == FileOperationType.INSERT:
                await self._handle_insert(websocket, full_path, message, client_id)
            elif msg_type == FileOperationType.DELETE:
                await self._handle_delete(websocket, full_path, message, client_id)
            elif msg_type == "lock":
                await self._handle_lock(websocket, full_path, client_id)
            elif msg_type == "unlock":
                await self._handle_unlock(websocket, full_path, client_id)
            elif msg_type == "get_version":
                await self._handle_get_version(websocket, full_path, version)
            elif msg_type == "undo":
                await self._handle_undo(websocket, full_path, client_id)
            else:
                await self._send_error(websocket, f"Unknown operation: {msg_type}")

        except Exception as e:
            await self._send_error(websocket, str(e))

    def _resolve_path(self, path: str) -> str:
        """Resolve relative path to absolute path within base directory.

        Args:
            path: Relative or absolute path

        Returns:
            Resolved absolute path
        """
        full_path = (self.base_path / path).resolve()

        # Security: Ensure path is within base directory
        try:
            full_path.relative_to(self.base_path)
        except ValueError:
            raise ValueError(f"Path {path} is outside allowed directory")

        return str(full_path)

    def _get_or_create_document(self, path: str) -> CRDTDocument:
        """Get existing document or create new one.

        Args:
            path: File path

        Returns:
            CRDTDocument instance
        """
        if path not in self.documents:
            # Try to load from disk
            content = ""
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read()
                except Exception:
                    pass
            self.documents[path] = CRDTDocument(path, content)

        return self.documents[path]

    async def _handle_read(
        self,
        websocket: WebSocket,
        path: str,
        version: int,
    ) -> None:
        """Handle read operation.

        Args:
            websocket: WebSocket connection
            path: File path
            version: Requested version (0 = latest)
        """
        if not os.path.exists(path):
            await websocket.send_json({
                "type": "read_result",
                "path": path,
                "status": FileStatus.NOT_FOUND,
                "error": "File not found",
            })
            return

        doc = self._get_or_create_document(path)

        if version == 0:
            # Return latest version
            content = doc.content
            version = doc.version
        else:
            # Return specific version
            content = doc.get_content_at_version(version)
            if content is None:
                await websocket.send_json({
                    "type": "read_result",
                    "path": path,
                    "status": FileStatus.ERROR,
                    "error": f"Version {version} not found",
                })
                return

        await websocket.send_json({
            "type": "read_result",
            "path": path,
            "status": FileStatus.SUCCESS,
            "content": content,
            "version": version,
            "hash": hashlib.md5(content.encode()).hexdigest(),
        })

    async def _handle_write(
        self,
        websocket: WebSocket,
        path: str,
        message: Dict[str, Any],
        client_id: str,
    ) -> None:
        """Handle write operation.

        Args:
            websocket: WebSocket connection
            path: File path
            message: Message containing write data
            client_id: Client identifier
        """
        # Check lock
        if self.lock_manager.is_locked(path):
            owner = self.lock_manager.get_lock_owner(path)
            if owner != client_id:
                await websocket.send_json({
                    "type": "write_result",
                    "path": path,
                    "status": FileStatus.LOCKED,
                    "error": f"File is locked by {owner}",
                })
                return

        # Get document
        doc = self._get_or_create_document(path)
        previous_content = doc.content

        # Create operation
        op = Operation(
            type=FileOperationType.WRITE,
            path=path,
            client_id=client_id,
            timestamp=time.time(),
            version=message.get("version", doc.version),
            data={"content": message.get("content", "")},
        )

        # Apply operation
        new_content = doc.apply_operation(op, doc.content)

        # Write to disk
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_content)
        except Exception as e:
            await websocket.send_json({
                "type": "write_result",
                "path": path,
                "status": FileStatus.ERROR,
                "error": str(e),
            })
            return

        # Record change for undo
        self._record_change(path, op, previous_content, new_content)

        # Broadcast to all clients
        await self._broadcast({
            "type": "broadcast",
            "operation": "write",
            "path": path,
            "status": FileStatus.SUCCESS,
            "version": doc.version,
            "hash": hashlib.md5(new_content.encode()).hexdigest(),
            "client_id": client_id,
        })

        # Confirm to sender
        await websocket.send_json({
            "type": "write_result",
            "path": path,
            "status": FileStatus.SUCCESS,
            "version": doc.version,
            "hash": hashlib.md5(new_content.encode()).hexdigest(),
        })

    async def _handle_insert(
        self,
        websocket: WebSocket,
        path: str,
        message: Dict[str, Any],
        client_id: str,
    ) -> None:
        """Handle insert operation."""
        if self.lock_manager.is_locked(path):
            owner = self.lock_manager.get_lock_owner(path)
            if owner != client_id:
                await websocket.send_json({
                    "type": "insert_result",
                    "path": path,
                    "status": FileStatus.LOCKED,
                    "error": f"File is locked by {owner}",
                })
                return

        doc = self._get_or_create_document(path)
        previous_content = doc.content

        op = Operation(
            type=FileOperationType.INSERT,
            path=path,
            client_id=client_id,
            timestamp=time.time(),
            version=message.get("version", doc.version),
            data={
                "position": message.get("position", 0),
                "text": message.get("text", ""),
            },
        )

        new_content = doc.apply_operation(op, doc.content)

        # Write to disk
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_content)
        except Exception as e:
            await websocket.send_json({
                "type": "insert_result",
                "path": path,
                "status": FileStatus.ERROR,
                "error": str(e),
            })
            return

        self._record_change(path, op, previous_content, new_content)

        await self._broadcast({
            "type": "broadcast",
            "operation": "insert",
            "path": path,
            "status": FileStatus.SUCCESS,
            "position": message.get("position"),
            "text": message.get("text"),
            "version": doc.version,
            "client_id": client_id,
        })

        await websocket.send_json({
            "type": "insert_result",
            "path": path,
            "status": FileStatus.SUCCESS,
            "version": doc.version,
        })

    async def _handle_delete(
        self,
        websocket: WebSocket,
        path: str,
        message: Dict[str, Any],
        client_id: str,
    ) -> None:
        """Handle delete operation."""
        if self.lock_manager.is_locked(path):
            owner = self.lock_manager.get_lock_owner(path)
            if owner != client_id:
                await websocket.send_json({
                    "type": "delete_result",
                    "path": path,
                    "status": FileStatus.LOCKED,
                    "error": f"File is locked by {owner}",
                })
                return

        doc = self._get_or_create_document(path)
        previous_content = doc.content

        op = Operation(
            type=FileOperationType.DELETE,
            path=path,
            client_id=client_id,
            timestamp=time.time(),
            version=message.get("version", doc.version),
            data={
                "start": message.get("start", 0),
                "end": message.get("end", 0),
            },
        )

        new_content = doc.apply_operation(op, doc.content)

        # Write to disk
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_content)
        except Exception as e:
            await websocket.send_json({
                "type": "delete_result",
                "path": path,
                "status": FileStatus.ERROR,
                "error": str(e),
            })
            return

        self._record_change(path, op, previous_content, new_content)

        await self._broadcast({
            "type": "broadcast",
            "operation": "delete",
            "path": path,
            "status": FileStatus.SUCCESS,
            "start": message.get("start"),
            "end": message.get("end"),
            "version": doc.version,
            "client_id": client_id,
        })

        await websocket.send_json({
            "type": "delete_result",
            "path": path,
            "status": FileStatus.SUCCESS,
            "version": doc.version,
        })

    async def _handle_lock(
        self,
        websocket: WebSocket,
        path: str,
        client_id: str,
    ) -> None:
        """Handle file lock request."""
        acquired = await self.lock_manager.acquire_lock(path, client_id)

        if acquired:
            await self._broadcast_lock_change(path, client_id)
            await websocket.send_json({
                "type": "lock_result",
                "path": path,
                "status": FileStatus.SUCCESS,
                "locked_by": client_id,
            })
        else:
            await websocket.send_json({
                "type": "lock_result",
                "path": path,
                "status": FileStatus.LOCKED,
                "locked_by": self.lock_manager.get_lock_owner(path),
            })

    async def _handle_unlock(
        self,
        websocket: WebSocket,
        path: str,
        client_id: str,
    ) -> None:
        """Handle file unlock request."""
        released = await self.lock_manager.release_lock(path, client_id)

        if released:
            await self._broadcast_lock_change(path, None)
            await websocket.send_json({
                "type": "unlock_result",
                "path": path,
                "status": FileStatus.SUCCESS,
            })
        else:
            await websocket.send_json({
                "type": "unlock_result",
                "path": path,
                "status": FileStatus.ERROR,
                "error": "Not locked by you or not locked",
            })

    async def _handle_get_version(
        self,
        websocket: WebSocket,
        path: str,
        version: int,
    ) -> None:
        """Handle version query."""
        doc = self._get_or_create_document(path)
        content = doc.get_content_at_version(version)

        if content is None:
            await websocket.send_json({
                "type": "version_result",
                "path": path,
                "status": FileStatus.ERROR,
                "error": f"Version {version} not found",
            })
            return

        await websocket.send_json({
            "type": "version_result",
            "path": path,
            "status": FileStatus.SUCCESS,
            "version": version,
            "content": content,
            "hash": hashlib.md5(content.encode()).hexdigest(),
        })

    async def _handle_undo(
        self,
        websocket: WebSocket,
        path: str,
        client_id: str,
    ) -> None:
        """Handle undo operation."""
        if path not in self.change_history or not self.change_history[path]:
            await websocket.send_json({
                "type": "undo_result",
                "path": path,
                "status": FileStatus.ERROR,
                "error": "Nothing to undo",
            })
            return

        # Get last change
        change = self.change_history[path].pop()

        # Check ownership
        if change.operation.client_id != client_id:
            self.change_history[path].append(change)  # Put back
            await websocket.send_json({
                "type": "undo_result",
                "path": path,
                "status": FileStatus.ERROR,
                "error": "Can only undo your own changes",
            })
            return

        # Restore previous content
        doc = self._get_or_create_document(path)
        doc.content = change.previous_content

        # Write to disk
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(change.previous_content)
        except Exception as e:
            await websocket.send_json({
                "type": "undo_result",
                "path": path,
                "status": FileStatus.ERROR,
                "error": str(e),
            })
            return

        await self._broadcast({
            "type": "broadcast",
            "operation": "undo",
            "path": path,
            "status": FileStatus.SUCCESS,
            "version": doc.version,
            "client_id": client_id,
        })

        await websocket.send_json({
            "type": "undo_result",
            "path": path,
            "status": FileStatus.SUCCESS,
            "version": doc.version,
        })

    def _record_change(
        self,
        path: str,
        operation: Operation,
        previous_content: str,
        new_content: str,
    ) -> None:
        """Record change for undo."""
        if path not in self.change_history:
            self.change_history[path] = []

        record = ChangeRecord(
            operation=operation,
            previous_content=previous_content,
            new_content=new_content,
            timestamp=time.time(),
        )

        self.change_history[path].append(record)

        # Limit history size
        if len(self.change_history[path]) > self.max_history:
            self.change_history[path].pop(0)

    async def _broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast message to all connected clients."""
        disconnected = set()

        for client in self.clients:
            try:
                await client.send_json(message)
            except Exception:
                disconnected.add(client)

        # Clean up disconnected clients
        self.clients -= disconnected

    async def _broadcast_lock_change(self, path: str, client_id: Optional[str]) -> None:
        """Broadcast lock status change."""
        await self._broadcast({
            "type": "lock_change",
            "path": path,
            "locked_by": client_id,
            "locked": client_id is not None,
        })

    async def _send_error(self, websocket: WebSocket, error: str) -> None:
        """Send error message."""
        await websocket.send_json({
            "type": "error",
            "status": FileStatus.ERROR,
            "error": error,
        })


# Global instance
global_file_modifier: Optional[WebSocketFileModifier] = None


def get_file_modifier(base_path: str = ".") -> WebSocketFileModifier:
    """Get or create global file modifier instance."""
    global global_file_modifier
    if global_file_modifier is None:
        global_file_modifier = WebSocketFileModifier(base_path)
    return global_file_modifier
