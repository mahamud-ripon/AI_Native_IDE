"""
Execution Types

Type definitions for the Code Execution Tool.
Matches the TypeScript Execution Control Plane types.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List, Dict, Any
from datetime import datetime


class ExecutionStatus(str, Enum):
    """Task execution status - matches Prisma enum."""
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class TaskPriority(str, Enum):
    """Task priority levels."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class ExecutionEventType(str, Enum):
    """Event types emitted during execution."""
    TASK_CREATED = "task_created"
    TASK_QUEUED = "task_queued"
    TASK_STARTED = "task_started"
    PLAN_GENERATED = "plan_generated"
    PATCH_GENERATED = "patch_generated"
    VALIDATION_STARTED = "validation_started"
    VALIDATION_COMPLETED = "validation_completed"
    PATCH_APPLIED = "patch_applied"
    TASK_COMPLETED = "task_completed"
    TASK_FAILED = "task_failed"
    TASK_CANCELLED = "task_cancelled"
    PROGRESS_UPDATE = "progress_update"


@dataclass
class ExecutionOptions:
    """Options for task execution."""
    timeout_ms: int = 120000
    enable_rollback: bool = True
    enable_sandbox: bool = True
    dry_run: bool = False
    sandbox_checks: Optional[List[str]] = None
    max_files_modified: int = 10

    def __post_init__(self):
        if self.sandbox_checks is None:
            self.sandbox_checks = ["syntax", "typecheck", "lint"]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timeoutMs": self.timeout_ms,
            "enableRollback": self.enable_rollback,
            "enableSandbox": self.enable_sandbox,
            "dryRun": self.dry_run,
            "sandboxChecks": self.sandbox_checks,
            "maxFilesModified": self.max_files_modified,
        }


@dataclass
class CreateTaskRequest:
    """Request to create an execution task."""
    project_id: str
    workspace_id: str
    instruction: str
    branch: Optional[str] = None
    priority: TaskPriority = TaskPriority.NORMAL
    options: Optional[ExecutionOptions] = None
    conversation_id: Optional[str] = None
    workflow_run_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "projectId": self.project_id,
            "workspaceId": self.workspace_id,
            "instruction": self.instruction,
            "priority": self.priority.value,
        }
        if self.branch:
            result["branch"] = self.branch
        if self.options:
            result["options"] = self.options.to_dict()
        if self.conversation_id:
            result["conversationId"] = self.conversation_id
        if self.workflow_run_id:
            result["workflowRunId"] = self.workflow_run_id
        return result


@dataclass
class ExecutionEvent:
    """An event emitted during task execution."""
    task_id: str
    sequence: int
    event_type: str
    stage: str
    message: str
    progress: int  # 0-100
    timestamp: datetime
    payload: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionEvent":
        return cls(
            task_id=data["taskId"],
            sequence=data.get("sequence", 0),
            event_type=data.get("eventType", "unknown"),
            stage=data.get("stage", "unknown"),
            message=data.get("message", ""),
            progress=data.get("progress", 0),
            timestamp=datetime.fromisoformat(data["timestamp"])
            if "timestamp" in data
            else datetime.utcnow(),
            payload=data.get("payload"),
        )

    def is_terminal(self) -> bool:
        """Check if this is a terminal event."""
        return self.event_type in [
            ExecutionEventType.TASK_COMPLETED.value,
            ExecutionEventType.TASK_FAILED.value,
            ExecutionEventType.TASK_CANCELLED.value,
        ]


@dataclass
class TaskStatus:
    """Current status of an execution task."""
    task_id: str
    status: ExecutionStatus
    progress: int
    current_stage: Optional[str]
    stage_message: Optional[str]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TaskStatus":
        return cls(
            task_id=data["id"],
            status=ExecutionStatus(data["status"]),
            progress=data.get("progress", 0),
            current_stage=data.get("currentStage"),
            stage_message=data.get("stageMessage"),
            created_at=datetime.fromisoformat(data["createdAt"])
            if "createdAt" in data
            else datetime.utcnow(),
            started_at=datetime.fromisoformat(data["startedAt"])
            if data.get("startedAt")
            else None,
            completed_at=datetime.fromisoformat(data["completedAt"])
            if data.get("completedAt")
            else None,
        )


@dataclass
class ExecutionMetrics:
    """Metrics from task execution."""
    total_duration_ms: Optional[int] = None
    planning_ms: Optional[int] = None
    execution_ms: Optional[int] = None
    validation_ms: Optional[int] = None
    tokens_used: int = 0
    cost_usd: Optional[float] = None
    patches_applied: int = 0
    files_modified: int = 0

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionMetrics":
        return cls(
            total_duration_ms=data.get("totalDurationMs"),
            planning_ms=data.get("planningMs"),
            execution_ms=data.get("executionMs"),
            validation_ms=data.get("validationMs"),
            tokens_used=data.get("tokensUsed", 0),
            cost_usd=data.get("costUsd"),
            patches_applied=data.get("patchesApplied", 0),
            files_modified=data.get("filesModified", 0),
        )


@dataclass
class ExecutionError:
    """Error details from failed execution."""
    code: str
    message: str
    stage: str
    recoverable: bool = False
    details: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionError":
        return cls(
            code=data.get("code", "UNKNOWN"),
            message=data.get("message", "Unknown error"),
            stage=data.get("stage", "unknown"),
            recoverable=data.get("recoverable", False),
            details=data.get("details"),
        )


@dataclass
class ExecutionResult:
    """Final result of task execution."""
    task_id: str
    success: bool
    status: ExecutionStatus
    summary: Optional[Dict[str, Any]] = None
    artifacts: Optional[Dict[str, Any]] = None
    error: Optional[ExecutionError] = None
    metrics: Optional[ExecutionMetrics] = None
    completed_at: Optional[datetime] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionResult":
        error_data = data.get("error")
        metrics_data = data.get("metrics")

        return cls(
            task_id=data["taskId"],
            success=data.get("success", False),
            status=ExecutionStatus(data["status"]),
            summary=data.get("summary"),
            artifacts=data.get("artifacts"),
            error=ExecutionError.from_dict(error_data) if error_data else None,
            metrics=ExecutionMetrics.from_dict(metrics_data) if metrics_data else None,
            completed_at=datetime.fromisoformat(data["completedAt"])
            if data.get("completedAt")
            else None,
        )


@dataclass
class CreateTaskResponse:
    """Response from task creation."""
    task_id: str
    status: ExecutionStatus
    message: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CreateTaskResponse":
        return cls(
            task_id=data["taskId"],
            status=ExecutionStatus(data["status"]),
            message=data.get("message", "Task created"),
        )
