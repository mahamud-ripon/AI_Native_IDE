from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx


class BashExecutor:
    """Execute commands on the execution VM (Firecracker).

    Provides safe command execution with timeout management,
    output capture, and error handling.
    """

    def __init__(self) -> None:
        self.api_url = os.getenv("API_GATEWAY_URL", "http://localhost:8000")
        self.system_token = os.getenv("SYSTEM_TOKEN", "")
        self.default_timeout = 60

    async def execute(
        self,
        project_id: str,
        command: str,
        timeout: int = 60,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Execute bash command on VM.

        Args:
            project_id: Project identifier
            command: Shell command to execute
            timeout: Maximum execution time in seconds
            cwd: Working directory (relative to project root)
            env: Additional environment variables

        Returns:
            Dict with keys:
            - success: bool
            - stdout: str
            - stderr: str
            - exit_code: int
            - duration: float (seconds)
        """
        async with httpx.AsyncClient() as client:
            try:
                payload: Dict[str, Any] = {
                    "command": command,
                    "timeout": timeout,
                }
                if cwd:
                    payload["cwd"] = cwd
                if env:
                    payload["env"] = env

                response = await client.post(
                    f"{self.api_url}/api/v1/exec/{project_id}/run",
                    json=payload,
                    headers={"Authorization": f"Bearer {self.system_token}"},
                    timeout=timeout + 10,  # Extra buffer for response
                )

                if response.status_code == 200:
                    return response.json()

                return {
                    "success": False,
                    "stdout": "",
                    "stderr": f"HTTP {response.status_code}: {response.text[:200]}",
                    "exit_code": -1,
                    "duration": 0,
                }

            except httpx.TimeoutException:
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": f"Command timed out after {timeout}s",
                    "exit_code": -1,
                    "duration": timeout,
                }
            except Exception as e:
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": f"Execution error: {str(e)}",
                    "exit_code": -1,
                    "duration": 0,
                }

    async def run_tests(
        self,
        project_id: str,
        test_command: str = "npm test",
        timeout: int = 120,
    ) -> Dict[str, Any]:
        """Run tests and return structured result.

        Args:
            project_id: Project identifier
            test_command: Test command to run
            timeout: Maximum execution time

        Returns:
            Dict with test results
        """
        result = await self.execute(project_id, test_command, timeout)

        # Parse test output for common frameworks
        stdout = result.get("stdout", "")
        stderr = result.get("stderr", "")

        # Detect test framework and parse results
        tests_passed = result.get("success", False)
        test_count = 0
        failed_count = 0

        # Jest pattern
        if "Tests:" in stdout:
            import re

            match = re.search(r"Tests:\s+(\d+)", stdout)
            if match:
                test_count = int(match.group(1))
            match = re.search(r"failed\s+(\d+)", stdout)
            if match:
                failed_count = int(match.group(1))
                tests_passed = failed_count == 0

        # Pytest pattern
        elif "passed" in stdout:
            import re

            match = re.search(r"(\d+)\s+passed", stdout)
            if match:
                test_count = int(match.group(1))
            match = re.search(r"(\d+)\s+failed", stdout)
            if match:
                failed_count = int(match.group(1))
                tests_passed = failed_count == 0

        return {
            **result,
            "test_count": test_count,
            "failed_count": failed_count,
            "tests_passed": tests_passed,
        }

    async def install_dependencies(
        self,
        project_id: str,
        package_manager: str = "npm",
        timeout: int = 180,
    ) -> Dict[str, Any]:
        """Install project dependencies.

        Args:
            project_id: Project identifier
            package_manager: Package manager (npm, yarn, pip, poetry)
            timeout: Maximum execution time

        Returns:
            Execution result
        """
        commands = {
            "npm": "npm install",
            "yarn": "yarn install",
            "pip": "pip install -r requirements.txt",
            "poetry": "poetry install",
        }

        command = commands.get(package_manager, f"{package_manager} install")
        return await self.execute(project_id, command, timeout)

    async def build_project(
        self,
        project_id: str,
        build_command: str = "npm run build",
        timeout: int = 120,
    ) -> Dict[str, Any]:
        """Build the project.

        Args:
            project_id: Project identifier
            build_command: Build command to run
            timeout: Maximum execution time

        Returns:
            Execution result
        """
        return await self.execute(project_id, build_command, timeout)

    async def health_check(self, project_id: str) -> bool:
        """Check if the execution VM is healthy.

        Args:
            project_id: Project identifier

        Returns:
            True if VM is responsive
        """
        result = await self.execute(project_id, "echo 'health_check'", timeout=10)
        return result.get("success", False)
