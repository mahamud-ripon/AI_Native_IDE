"""
Code Execution Agent

Bridges the multi-agent workflow to the Execution Control Plane.
Converts agent code outputs into execution tasks and handles results.

Architecture:
    Multi-Agent Workflow
           │
    CodeExecutionAgent
           │
    CodeExecutionTool
           │
    Execution Control Plane
           │
    TaskOrchestrator → CodeAgent → PatchSandbox → WorkspaceFS
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional, Callable, Any, Dict, List
from dataclasses import dataclass, field
from datetime import datetime

# Import execution tool
from ...tools.code_execution_tool import CodeExecutionTool
from ...tools.execution_types import (
    ExecutionStatus,
    TaskPriority,
    ExecutionOptions,
    CreateTaskRequest,
    ExecutionEvent,
    ExecutionResult,
)
from ...tools.execution_errors import (
    TaskFailedError,
    TaskTimeoutError,
    TaskCancelledError,
)

# Import instruction guard
from .instruction_guard import (
    InstructionGuard,
    InstructionValidationError,
    ValidationConfig,
)

logger = logging.getLogger(__name__)


@dataclass
class CodeExecutionConfig:
    """Configuration for code execution agent."""
    ai_service_url: str = "http://localhost:8005"
    default_timeout_seconds: float = 600.0
    max_retries: int = 2
    enable_rollback: bool = True
    enable_sandbox: bool = True
    sandbox_checks: List[str] = field(default_factory=lambda: ["syntax", "typecheck", "lint"])
    max_files_modified: int = 10


@dataclass
class ExecutionTaskResult:
    """Result of an execution task from the agent perspective."""
    success: bool
    task_id: str
    files_modified: List[str]
    patches: List[str]
    error_message: Optional[str] = None
    error_stage: Optional[str] = None
    rollback_performed: bool = False
    metrics: Optional[Dict[str, Any]] = None


class CodeExecutionAgent:
    """
    Agent that bridges multi-agent workflow to Execution Control Plane.
    
    Responsibilities:
    1. Convert agent outputs to executable instructions
    2. Submit tasks to Execution Control Plane
    3. Stream progress back to orchestrator
    4. Handle results and failures
    5. Coordinate retries and rollbacks
    
    Usage:
        agent = CodeExecutionAgent(
            ai_service_url="http://ai-service:8005",
            project_id="proj-123",
            workspace_id="ws-456",
        )
        
        result = await agent.execute_instruction(
            instruction="Implement JWT authentication middleware",
            context={"target_files": ["src/middleware/auth.ts"]},
        )
    """
    
    def __init__(
        self,
        ai_service_url: str,
        project_id: str,
        workspace_id: str,
        auth_token: Optional[str] = None,
        agent_key: Optional[str] = None,
        config: Optional[CodeExecutionConfig] = None,
        validation_config: Optional[ValidationConfig] = None,
    ):
        """
        Initialize code execution agent.
        
        Args:
            ai_service_url: AI Service base URL
            project_id: Project UUID
            workspace_id: Workspace identifier
            auth_token: JWT Bearer token (optional)
            agent_key: API key for machine-to-machine auth (optional)
            config: Execution configuration
            validation_config: Instruction validation configuration
        """
        self.project_id = project_id
        self.workspace_id = workspace_id
        self.config = config or CodeExecutionConfig(ai_service_url=ai_service_url)
        
        # Initialize instruction guard
        self.guard = InstructionGuard(validation_config)
        
        # Initialize execution tool
        self.tool = CodeExecutionTool(
            base_url=ai_service_url,
            auth_token=auth_token,
            agent_key=agent_key,
            timeout=self.config.default_timeout_seconds,
            max_retries=self.config.max_retries,
        )
        
        # Progress callback
        self._progress_callback: Optional[Callable[[ExecutionEvent], None]] = None
    
    def set_progress_callback(
        self,
        callback: Callable[[ExecutionEvent], None]
    ) -> None:
        """Set callback for progress updates."""
        self._progress_callback = callback
    
    def _emit_progress(self, event: ExecutionEvent) -> None:
        """Emit progress event to callback."""
        if self._progress_callback:
            try:
                self._progress_callback(event)
            except Exception as e:
                logger.warning(f"Progress callback error: {e}")
    
    def _build_instruction(
        self,
        base_instruction: str,
        context: Optional[Dict[str, Any]] = None,
        files_to_create: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Build a complete instruction for the coding engine.
        
        Combines base instruction with context and file specifications.
        """
        parts = [base_instruction]
        
        if context:
            parts.append("\n## Context:")
            
            if "target_files" in context:
                parts.append(f"- Target files: {', '.join(context['target_files'])}")
            
            if "constraints" in context:
                parts.append(f"- Constraints: {context['constraints']}")
            
            if "style_guide" in context:
                parts.append(f"- Style: {context['style_guide']}")
            
            if "tech_stack" in context:
                parts.append(f"- Tech stack: {', '.join(context['tech_stack'])}")
        
        if files_to_create:
            parts.append("\n## Files to Create/Modify:")
            for path, description in files_to_create.items():
                parts.append(f"- `{path}`: {description}")
        
        return "\n".join(parts)
    
    def _build_options(
        self,
        timeout_ms: Optional[int] = None,
        enable_rollback: Optional[bool] = None,
        enable_sandbox: Optional[bool] = None,
        dry_run: bool = False,
    ) -> ExecutionOptions:
        """Build execution options."""
        return ExecutionOptions(
            timeout_ms=timeout_ms or int(self.config.default_timeout_seconds * 1000),
            enable_rollback=enable_rollback if enable_rollback is not None else self.config.enable_rollback,
            enable_sandbox=enable_sandbox if enable_sandbox is not None else self.config.enable_sandbox,
            dry_run=dry_run,
            sandbox_checks=self.config.sandbox_checks,
            max_files_modified=self.config.max_files_modified,
        )
    
    async def execute_instruction(
        self,
        instruction: str,
        context: Optional[Dict[str, Any]] = None,
        files_to_create: Optional[Dict[str, str]] = None,
        priority: TaskPriority = TaskPriority.NORMAL,
        timeout_seconds: Optional[float] = None,
        branch: Optional[str] = None,
        conversation_id: Optional[str] = None,
        dry_run: bool = False,
        skip_validation: bool = False,
    ) -> ExecutionTaskResult:
        """
        Execute a coding instruction through the Execution Control Plane.
        
        Args:
            instruction: Natural language coding instruction
            context: Additional context (target files, constraints, etc.)
            files_to_create: Map of file paths to descriptions
            priority: Task priority
            timeout_seconds: Max execution time
            branch: Target git branch
            conversation_id: Link to conversation
            dry_run: If True, don't apply changes
            skip_validation: If True, skip instruction validation (dangerous)
        
        Returns:
            ExecutionTaskResult with success/failure and artifacts
        
        Raises:
            InstructionValidationError: If instruction validation fails
        """
        # Build complete instruction
        full_instruction = self._build_instruction(instruction, context, files_to_create)
        
        # Validate instruction (unless explicitly skipped)
        if not skip_validation:
            try:
                full_instruction = self.guard.validate(full_instruction)
                logger.debug(f"Instruction validated successfully")
            except InstructionValidationError as e:
                logger.error(f"Instruction validation failed: {e.violation}")
                raise
        
        # Build options
        timeout_ms = int(timeout_seconds * 1000) if timeout_seconds else None
        options = self._build_options(
            timeout_ms=timeout_ms,
            dry_run=dry_run,
        )
        
        logger.info(f"Executing instruction: {instruction[:50]}...")
        
        try:
            # Execute with progress streaming
            result = await self.tool.execute_code_task(
                project_id=self.project_id,
                workspace_id=self.workspace_id,
                instruction=full_instruction,
                branch=branch,
                priority=priority,
                options=options,
                conversation_id=conversation_id,
                wait_for_completion=True,
                progress_callback=self._emit_progress,
            )
            
            # Build result
            return ExecutionTaskResult(
                success=result.success,
                task_id=result.task_id,
                files_modified=result.artifacts.get("filesChanged", []) if result.artifacts else [],
                patches=result.artifacts.get("patches", []) if result.artifacts else [],
                metrics={
                    "total_duration_ms": result.metrics.total_duration_ms if result.metrics else None,
                    "files_modified": result.metrics.files_modified if result.metrics else 0,
                },
            )
        
        except TaskFailedError as e:
            logger.error(f"Task failed: {e.error_message}")
            return ExecutionTaskResult(
                success=False,
                task_id=e.task_id,
                files_modified=[],
                patches=[],
                error_message=e.error_message,
                error_stage=e.error_stage,
            )
        
        except TaskTimeoutError as e:
            logger.error(f"Task timed out: {e.task_id}")
            return ExecutionTaskResult(
                success=False,
                task_id=e.task_id,
                files_modified=[],
                patches=[],
                error_message=f"Task timed out after {e.timeout_seconds:.1f}s",
                error_stage="execution",
            )
        
        except TaskCancelledError as e:
            logger.warning(f"Task cancelled: {e.task_id}")
            return ExecutionTaskResult(
                success=False,
                task_id=e.task_id,
                files_modified=[],
                patches=[],
                error_message="Task was cancelled",
                error_stage="execution",
            )
    
    async def execute_from_agent_output(
        self,
        agent_name: str,
        code_output: Dict[str, Any],
        priority: TaskPriority = TaskPriority.NORMAL,
    ) -> ExecutionTaskResult:
        """
        Execute code from agent output (e.g., BackendAgent, FrontendAgent).
        
        This is the main integration point for the multi-agent workflow.
        
        Args:
            agent_name: Name of the agent that generated the code
            code_output: CodeOutput dict with 'files' key
            priority: Task priority
        
        Returns:
            ExecutionTaskResult
        """
        files = code_output.get("files", {})
        
        if not files:
            logger.warning(f"No files in {agent_name} output")
            return ExecutionTaskResult(
                success=False,
                task_id="",
                files_modified=[],
                patches=[],
                error_message="No files to execute",
            )
        
        # Build instruction from files
        instruction = f"""
Apply the following code changes generated by {agent_name}:

Files to create/modify:
{self._format_files_for_instruction(files)}

Requirements:
- Create all necessary directories
- Include all imports and dependencies
- Follow existing code patterns in the project
- Ensure proper error handling
"""
        
        # Build context with file paths
        context = {
            "target_files": list(files.keys()),
            "constraints": "Generated by AI agent, validate before applying",
        }
        
        return await self.execute_instruction(
            instruction=instruction.strip(),
            context=context,
            files_to_create={k: "Generated code" for k in files.keys()},
            priority=priority,
        )
    
    def _format_files_for_instruction(self, files: Dict[str, str]) -> str:
        """Format files dict for instruction."""
        lines = []
        for path, content in files.items():
            lines.append(f"\n### File: {path}\n```\n{content}\n```\n")
        return "\n".join(lines)
    
    async def execute_parallel(
        self,
        instructions: List[str],
        max_concurrent: int = 2,
        progress_callback: Optional[Callable[[str, ExecutionEvent], None]] = None,
    ) -> List[ExecutionTaskResult]:
        """
        Execute multiple instructions in parallel.
        
        Args:
            instructions: List of instructions
            max_concurrent: Maximum concurrent tasks
            progress_callback: Callback with (instruction, event)
        
        Returns:
            List of ExecutionTaskResult
        """
        results = []
        
        async def execute_one(instruction: str) -> ExecutionTaskResult:
            def on_progress(event: ExecutionEvent):
                if progress_callback:
                    progress_callback(instruction, event)
            
            return await self.execute_instruction(
                instruction=instruction,
                priority=TaskPriority.NORMAL,
            )
        
        # Use tool's parallel execution
        requests = [
            CreateTaskRequest(
                project_id=self.project_id,
                workspace_id=self.workspace_id,
                instruction=instruction,
            )
            for instruction in instructions
        ]
        
        try:
            results_list = await self.tool.execute_parallel(
                tasks=requests,
                max_concurrent=max_concurrent,
                progress_callback=progress_callback,
            )
            
            results = [
                ExecutionTaskResult(
                    success=r.success,
                    task_id=r.task_id,
                    files_modified=r.artifacts.get("filesChanged", []) if r.artifacts else [],
                    patches=r.artifacts.get("patches", []) if r.artifacts else [],
                    metrics={"total_duration_ms": r.metrics.total_duration_ms} if r.metrics else None,
                )
                for r in results_list
            ]
        except Exception as e:
            logger.error(f"Parallel execution failed: {e}")
            results = [
                ExecutionTaskResult(
                    success=False,
                    task_id="",
                    files_modified=[],
                    patches=[],
                    error_message=str(e),
                )
                for _ in instructions
            ]
        
        return results
    
    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a running task."""
        return await self.tool.cancel_task(task_id)
    
    async def retry_task(self, task_id: str) -> ExecutionTaskResult:
        """Retry a failed task."""
        status = await self.tool.retry_task(task_id)
        
        # Wait for completion
        result = await self.tool.wait_for_completion(task_id)
        
        return ExecutionTaskResult(
            success=result.success,
            task_id=result.task_id,
            files_modified=result.artifacts.get("filesChanged", []) if result.artifacts else [],
            patches=result.artifacts.get("patches", []) if result.artifacts else [],
            error_message=result.error.message if result.error else None,
            error_stage=result.error.stage if result.error else None,
        )
