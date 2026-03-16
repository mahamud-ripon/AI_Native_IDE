# Tools - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `ai-agents/src/tools/`  
> **Tech Stack:** Python, httpx, WebSocket

---

## 1. Executive Summary

The Tools module provides the execution layer for AI agents to interact with the external world - modifying files in the IDE and executing commands in the VM. These tools ensure safe, coordinated file operations.

---

## 2. File Modifier Tool

### 2.1 Purpose

Edits files in the project via WebSocket to avoid CRDT conflicts. The AI must not write directly to the database, as it would overwrite the Yjs CRDT state.

### 2.2 Implementation (src/tools/file_modifier.py)

```python
import httpx
import os

class FileModifier:
    """Modify files via WebSocket to avoid CRDT conflicts"""
    
    def __init__(self):
        self.ws_url = os.getenv("WS_GATEWAY_URL", "ws://localhost:8001")
        self.api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
    
    async def modify_file(self, project_id: str, file_path: str, content: str) -> bool:
        """
        IMPORTANT: Do NOT write directly to DB.
        Must use WebSocket to avoid overwriting CRDT state.
        
        Flow:
        1. Get current file version via WebSocket
        2. Apply diff through Yjs CRDT
        3. Wait for ACK before returning
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/api/v1/projects/{project_id}/files/sync",
                json={
                    "file_path": file_path,
                    "content": content,
                    "source": "ai_agent"
                },
                headers={"Authorization": f"Bearer {os.getenv('SYSTEM_TOKEN')}"},
                timeout=30.0
            )
            
            if response.status_code == 200:
                data = response.json()
                # Wait for WebSocket ACK
                if data.get("acknowledged"):
                    return True
            
            return False
    
    async def create_files(self, project_id: str, files: dict) -> bool:
        """Create multiple files"""
        for path, content in files.items():
            success = await self.modify_file(project_id, path, content)
            if not success:
                return False
        return True
    
    async def read_file(self, project_id: str, file_path: str) -> str:
        """Read file content"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.api_url}/api/v1/projects/{project_id}/files/content",
                params={"path": file_path},
                headers={"Authorization": f"Bearer {os.getenv('SYSTEM_TOKEN')}"}
            )
            
            if response.status_code == 200:
                return response.json().get("content", "")
            return ""
    
    async def delete_file(self, project_id: str, file_path: str) -> bool:
        """Delete a file"""
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{self.api_url}/api/v1/projects/{project_id}/files",
                json={"file_path": file_path},
                headers={"Authorization": f"Bearer {os.getenv('SYSTEM_TOKEN')}"}
            )
            
            return response.status_code == 200
```

---

## 3. Bash Executor Tool

### 3.1 Purpose

Executes shell commands in the Firecracker VM to run builds, tests, and other operations.

### 3.2 Implementation (src/tools/bash_executor.py)

```python
import httpx
import os

class BashExecutor:
    """Execute commands on the execution VM"""
    
    def __init__(self):
        self.api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
    
    async def execute(self, project_id: str, command: str, timeout: int = 60) -> dict:
        """
        Execute bash command on VM
        
        Returns:
        {
            "success": bool,
            "stdout": str,
            "stderr": str,
            "exit_code": int,
            "duration": float
        }
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/api/v1/exec/{project_id}/run",
                json={
                    "command": command,
                    "timeout": timeout
                },
                headers={"Authorization": f"Bearer {os.getenv('SYSTEM_TOKEN')}"},
                timeout=timeout + 10  # Extra buffer for response
            )
            
            if response.status_code == 200:
                return response.json()
            
            return {
                "success": False,
                "stdout": "",
                "stderr": f"HTTP {response.status_code}",
                "exit_code": -1,
                "duration": 0
            }
    
    async def run_tests(self, project_id: str) -> dict:
        """Run test suite"""
        return await self.execute(project_id, "npm test", timeout=120)
    
    async def install_dependencies(self, project_id: str) -> dict:
        """Install npm dependencies"""
        return await self.execute(project_id, "npm install", timeout=180)
    
    async def build_project(self, project_id: str) -> dict:
        """Build the project"""
        return await self.execute(project_id, "npm run build", timeout=120)
    
    async def run_migration(self, project_id: str) -> dict:
        """Run database migrations"""
        return await self.execute(project_id, "npx prisma migrate deploy", timeout=60)
```

---

## 4. Combined Tool Interface

### 4.1 Tool Registry (src/tools/registry.py)

```python
from .file_modifier import FileModifier
from .bash_executor import BashExecutor

class ToolRegistry:
    """Central registry for all tools"""
    
    def __init__(self):
        self.file_modifier = FileModifier()
        self.bash_executor = BashExecutor()
    
    async def execute_tool(self, tool_name: str, **kwargs):
        """Execute a tool by name"""
        tool_map = {
            "file_modifier": self.file_modifier,
            "bash_executor": self.bash_executor,
        }
        
        tool = tool_map.get(tool_name)
        if not tool:
            raise ValueError(f"Unknown tool: {tool_name}")
        
        method = kwargs.pop("method", None)
        if method:
            return await getattr(tool, method)(**kwargs)
        
        return await tool(**kwargs)
```

---

## 5. Error Handling

### 5.1 Retry Logic

```python
import asyncio
from typing import Optional

class ToolRetry:
    """Retry logic for tools"""
    
    MAX_RETRIES = 3
    RETRY_DELAY = 2
    
    @staticmethod
    async def with_retry(coro, max_retries: int = 3):
        last_error = None
        
        for attempt in range(max_retries):
            try:
                return await coro
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    await asyncio.sleep(ToolRetry.RETRY_DELAY * (attempt + 1))
        
        raise last_error
```

---

## 6. Implementation Status

| Component | Status |
|-----------|--------|
| File Modifier | ✅ Complete |
| Bash Executor | ✅ Complete |
| Tool Registry | ✅ Complete |
| Retry Logic | ✅ Complete |

---

## 7. Key Implementation Notes

### 7.1 CRDT Protection
- File modifications MUST go through WebSocket
- Never write directly to database
- Wait for ACK before continuing

### 7.2 Command Execution
- Commands run in isolated VM
- Timeout protection (default 60s)
- Return stdout, stderr, exit code

### 7.3 Safety
- System token for authentication
- Timeout protection
- Error handling with retries
