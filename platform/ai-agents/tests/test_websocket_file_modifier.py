"""Tests for WebSocket File Modifier with CRDT support."""

import asyncio
import os
import tempfile
import pytest

from src.tools.websocket_file_modifier import (
    CRDTDocument,
    ChangeRecord,
    FileLockManager,
    FileOperationType,
    FileStatus,
    FileVersion,
    Operation,
    WebSocketFileModifier,
    get_file_modifier,
    global_file_modifier,
)


class MockWebSocket:
    """Mock WebSocket for testing."""

    def __init__(self):
        self.sent_messages = []

    async def send_json(self, data):
        self.sent_messages.append(data)

    async def receive_json(self):
        return {}


class TestCRDTDocument:
    """Test suite for CRDTDocument class."""

    def test_initialization(self):
        """Test document initialization."""
        doc = CRDTDocument("/test/file.py", "initial content")
        assert doc.path == "/test/file.py"
        assert doc.content == "initial content"
        assert doc.version == 0
        assert len(doc.versions) == 1

    def test_apply_insert_operation(self):
        """Test insert operation."""
        doc = CRDTDocument("/test/file.py", "Hello World")

        op = Operation(
            type=FileOperationType.INSERT,
            path="/test/file.py",
            client_id="client-1",
            timestamp=1.0,
            version=0,
            data={"position": 6, "text": "Beautiful "},
        )

        new_content = doc.apply_operation(op, doc.content)
        assert new_content == "Hello Beautiful World"
        assert doc.version == 1

    def test_apply_delete_operation(self):
        """Test delete operation."""
        doc = CRDTDocument("/test/file.py", "Hello World")

        op = Operation(
            type=FileOperationType.DELETE,
            path="/test/file.py",
            client_id="client-1",
            timestamp=1.0,
            version=0,
            data={"start": 5, "end": 11},  # Delete " World"
        )

        new_content = doc.apply_operation(op, doc.content)
        assert new_content == "Hello"
        assert doc.version == 1

    def test_apply_replace_operation(self):
        """Test replace operation."""
        doc = CRDTDocument("/test/file.py", "Hello World")

        op = Operation(
            type=FileOperationType.REPLACE,
            path="/test/file.py",
            client_id="client-1",
            timestamp=1.0,
            version=0,
            data={"start": 6, "end": 11, "text": "Universe"},
        )

        new_content = doc.apply_operation(op, doc.content)
        assert new_content == "Hello Universe"
        assert doc.version == 1

    def test_apply_write_operation(self):
        """Test write operation."""
        doc = CRDTDocument("/test/file.py", "old content")

        op = Operation(
            type=FileOperationType.WRITE,
            path="/test/file.py",
            client_id="client-1",
            timestamp=1.0,
            version=0,
            data={"content": "new content"},
        )

        new_content = doc.apply_operation(op, doc.content)
        assert new_content == "new content"
        assert doc.version == 1

    def test_get_latest_version(self):
        """Test getting latest version."""
        doc = CRDTDocument("/test/file.py", "v0")
        assert doc.get_latest_version().version_id == 0

        op = Operation(
            type=FileOperationType.WRITE,
            path="/test/file.py",
            client_id="client-1",
            timestamp=1.0,
            version=0,
            data={"content": "v1"},
        )
        doc.apply_operation(op, doc.content)

        latest = doc.get_latest_version()
        assert latest.version_id == 1
        assert latest.content == "v1"

    def test_get_content_at_version(self):
        """Test getting content at specific version."""
        doc = CRDTDocument("/test/file.py", "version 0")

        # Apply operations to create versions
        for i in range(1, 3):
            op = Operation(
                type=FileOperationType.WRITE,
                path="/test/file.py",
                client_id=f"client-{i}",
                timestamp=float(i),
                version=i - 1,
                data={"content": f"version {i}"},
            )
            doc.apply_operation(op, doc.content)

        assert doc.get_content_at_version(0) == "version 0"
        assert doc.get_content_at_version(1) == "version 1"
        assert doc.get_content_at_version(2) == "version 2"
        assert doc.get_content_at_version(99) is None


class TestFileLockManager:
    """Test suite for FileLockManager."""

    def test_initialization(self):
        """Test lock manager initialization."""
        manager = FileLockManager()
        assert manager._locks == {}
        assert manager._lock_owners == {}

    def test_acquire_lock(self):
        """Test acquiring a lock."""
        manager = FileLockManager()

        async def run_test():
            acquired = await manager.acquire_lock("/test/file.py", "client-1")
            assert acquired is True
            assert manager.is_locked("/test/file.py") is True
            assert manager.get_lock_owner("/test/file.py") == "client-1"

        asyncio.run(run_test())

    def test_acquire_lock_already_locked(self):
        """Test acquiring a lock that's already locked."""
        manager = FileLockManager()

        async def run_test():
            # First client acquires lock
            acquired1 = await manager.acquire_lock("/test/file.py", "client-1")
            assert acquired1 is True

            # Second client tries to acquire same lock (should timeout)
            acquired2 = await manager.acquire_lock("/test/file.py", "client-2", timeout=0.1)
            assert acquired2 is False

        asyncio.run(run_test())

    def test_release_lock(self):
        """Test releasing a lock."""
        manager = FileLockManager()

        async def run_test():
            # Acquire lock
            await manager.acquire_lock("/test/file.py", "client-1")
            assert manager.is_locked("/test/file.py") is True

            # Release lock
            released = await manager.release_lock("/test/file.py", "client-1")
            assert released is True
            assert manager.is_locked("/test/file.py") is False

        asyncio.run(run_test())

    def test_release_lock_not_owner(self):
        """Test releasing a lock that's not owned."""
        manager = FileLockManager()

        async def run_test():
            await manager.acquire_lock("/test/file.py", "client-1")

            # Try to release with different client
            released = await manager.release_lock("/test/file.py", "client-2")
            assert released is False

        asyncio.run(run_test())


class TestWebSocketFileModifier:
    """Test suite for WebSocketFileModifier."""

    def test_initialization(self):
        """Test modifier initialization."""
        with tempfile.TemporaryDirectory() as tmpdir:
            modifier = WebSocketFileModifier(tmpdir)
            # Use resolved paths for comparison
            assert os.path.samefile(modifier.base_path, tmpdir)
            assert modifier.documents == {}
            assert modifier.clients == set()

    def test_connect(self):
        """Test client connection."""
        modifier = WebSocketFileModifier()
        ws = MockWebSocket()

        async def run_test():
            await modifier.connect(ws, "client-1")
            assert ws in modifier.clients
            assert len(ws.sent_messages) == 1
            assert ws.sent_messages[0]["type"] == "connected"

        asyncio.run(run_test())

    def test_disconnect(self):
        """Test client disconnection."""
        modifier = WebSocketFileModifier()
        ws = MockWebSocket()

        async def run_test():
            await modifier.connect(ws, "client-1")
            assert ws in modifier.clients

            # Acquire a lock
            await modifier.lock_manager.acquire_lock("/test/file.py", "client-1")

            await modifier.disconnect(ws, "client-1")
            assert ws not in modifier.clients
            assert not modifier.lock_manager.is_locked("/test/file.py")

        asyncio.run(run_test())

    def test_resolve_path(self):
        """Test path resolution."""
        with tempfile.TemporaryDirectory() as tmpdir:
            modifier = WebSocketFileModifier(tmpdir)

            # Valid relative path - just check path ends correctly
            resolved = modifier._resolve_path("test/file.py")
            resolved_str = str(resolved).replace("\\", "/")
            # Should end with test/file.py
            assert resolved_str.endswith("test/file.py")

            # Path outside base directory should fail
            with pytest.raises(ValueError):
                modifier._resolve_path("../../outside.py")

    def test_get_or_create_document(self):
        """Test document retrieval/creation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            modifier = WebSocketFileModifier(tmpdir)

            # Create a test file
            test_file = os.path.join(tmpdir, "test.py")
            with open(test_file, "w") as f:
                f.write("print('hello')")

            doc = modifier._get_or_create_document(test_file)
            assert doc.content == "print('hello')"
            assert len(doc.versions) == 1

            # Getting same document should return cached
            doc2 = modifier._get_or_create_document(test_file)
            assert doc is doc2

    def test_handle_read(self):
        """Test read operation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            modifier = WebSocketFileModifier(tmpdir)
            ws = MockWebSocket()

            # Create a test file
            test_file = os.path.join(tmpdir, "test.py")
            with open(test_file, "w") as f:
                f.write("test content")

            async def run_test():
                await modifier._handle_read(ws, test_file, 0)

                assert len(ws.sent_messages) == 1
                msg = ws.sent_messages[0]
                assert msg["type"] == "read_result"
                assert msg["status"] == FileStatus.SUCCESS
                assert msg["content"] == "test content"
                assert "hash" in msg

            asyncio.run(run_test())

    def test_handle_read_not_found(self):
        """Test read operation for non-existent file."""
        modifier = WebSocketFileModifier()
        ws = MockWebSocket()

        async def run_test():
            await modifier._handle_read(ws, "/nonexistent.py", 0)

            assert len(ws.sent_messages) == 1
            msg = ws.sent_messages[0]
            assert msg["status"] == FileStatus.NOT_FOUND

        asyncio.run(run_test())

    def test_record_change(self):
        """Test change recording for undo."""
        modifier = WebSocketFileModifier()

        op = Operation(
            type=FileOperationType.WRITE,
            path="/test.py",
            client_id="client-1",
            timestamp=1.0,
            version=0,
            data={"content": "new"},
        )

        modifier._record_change("/test.py", op, "old", "new")

        assert "/test.py" in modifier.change_history
        assert len(modifier.change_history["/test.py"]) == 1
        assert modifier.change_history["/test.py"][0].previous_content == "old"
        assert modifier.change_history["/test.py"][0].new_content == "new"

    def test_change_history_limit(self):
        """Test change history size limit."""
        modifier = WebSocketFileModifier()
        modifier.max_history = 3

        for i in range(5):
            op = Operation(
                type=FileOperationType.WRITE,
                path="/test.py",
                client_id="client-1",
                timestamp=float(i),
                version=i,
                data={"content": f"v{i}"},
            )
            modifier._record_change("/test.py", op, f"v{i}", f"v{i+1}")

        # Should only keep last 3
        assert len(modifier.change_history["/test.py"]) == 3

    def test_handle_lock(self):
        """Test lock operation."""
        modifier = WebSocketFileModifier()
        ws = MockWebSocket()

        async def run_test():
            await modifier._handle_lock(ws, "/test.py", "client-1")

            assert len(ws.sent_messages) == 1
            msg = ws.sent_messages[0]
            assert msg["type"] == "lock_result"
            assert msg["status"] == FileStatus.SUCCESS
            assert modifier.lock_manager.is_locked("/test.py")

        asyncio.run(run_test())

    def test_handle_unlock(self):
        """Test unlock operation."""
        modifier = WebSocketFileModifier()
        ws = MockWebSocket()

        async def run_test():
            # First lock
            await modifier.lock_manager.acquire_lock("/test.py", "client-1")

            # Then unlock
            await modifier._handle_unlock(ws, "/test.py", "client-1")

            assert len(ws.sent_messages) == 1
            msg = ws.sent_messages[0]
            assert msg["type"] == "unlock_result"
            assert msg["status"] == FileStatus.SUCCESS
            assert not modifier.lock_manager.is_locked("/test.py")

        asyncio.run(run_test())

    def test_handle_undo(self):
        """Test undo operation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            modifier = WebSocketFileModifier(tmpdir)
            ws = MockWebSocket()

            # Create a test file
            test_file = os.path.join(tmpdir, "test.py")
            with open(test_file, "w") as f:
                f.write("original")

            # Record a change
            op = Operation(
                type=FileOperationType.WRITE,
                path=test_file,
                client_id="client-1",
                timestamp=1.0,
                version=0,
                data={"content": "modified"},
            )
            modifier._record_change(test_file, op, "original", "modified")

            # Update file content
            with open(test_file, "w") as f:
                f.write("modified")

            async def run_test():
                await modifier._handle_undo(ws, test_file, "client-1")

                # Check file was restored
                with open(test_file) as f:
                    content = f.read()
                assert content == "original"

                # Should get at least undo_result (broadcast may not happen with single client)
                assert len(ws.sent_messages) >= 1
                assert ws.sent_messages[0]["type"] == "undo_result"

            asyncio.run(run_test())

    def test_handle_undo_no_changes(self):
        """Test undo with no changes."""
        modifier = WebSocketFileModifier()
        ws = MockWebSocket()

        async def run_test():
            await modifier._handle_undo(ws, "/test.py", "client-1")

            assert len(ws.sent_messages) == 1
            msg = ws.sent_messages[0]
            assert msg["status"] == FileStatus.ERROR
            assert "Nothing to undo" in msg["error"]

        asyncio.run(run_test())


class TestFileVersion:
    """Test suite for FileVersion."""

    def test_creation(self):
        """Test version creation."""
        version = FileVersion.from_content("test content", "client-1", 5)

        assert version.content == "test content"
        assert version.client_id == "client-1"
        assert version.version_id == 5
        # Just verify hash is a valid MD5 hex string (32 chars)
        assert len(version.hash) == 32
        assert all(c in "0123456789abcdef" for c in version.hash)
        assert version.timestamp > 0


class TestGlobalFileModifier:
    """Test suite for global file modifier."""

    def test_get_file_modifier(self):
        """Test getting global file modifier."""
        modifier1 = get_file_modifier()
        assert modifier1 is not None

        modifier2 = get_file_modifier()
        assert modifier1 is modifier2  # Same instance

    def test_global_modifier_singleton(self):
        """Test that global modifier is a singleton."""
        global global_file_modifier
        global_file_modifier = None  # Reset

        mod1 = get_file_modifier()
        mod2 = get_file_modifier()

        assert mod1 is mod2
