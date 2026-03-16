"""Parallel Execution Optimizer for LangGraph concurrent handling.

This module provides:
- Concurrent task grouping with priorities
- Resource-aware scheduling
- Deadlock detection and prevention
- Execution metrics and monitoring
- Integration with LangGraph workflows

Usage:
    from src.orchestrator.parallel_execution import (
        ParallelExecutor,
        TaskGroup,
        ExecutionPriority,
    )

    executor = ParallelExecutor(max_concurrent=3)

    # Create task group
    group = TaskGroup(
        name="code_generation",
        tasks=[
            Task("backend", backend_agent.run, priority=ExecutionPriority.HIGH),
            Task("frontend", frontend_agent.run, priority=ExecutionPriority.NORMAL),
            Task("devops", devops_agent.run, priority=ExecutionPriority.LOW),
        ],
    )

    # Execute in parallel with optimization
    results = await executor.execute_group(group)
"""

from __future__ import annotations

import asyncio
import inspect
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum, IntEnum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from collections import defaultdict
import threading


# ============================================================================
# Enums and Constants
# ============================================================================


class ExecutionPriority(IntEnum):
    """Priority levels for task execution."""
    CRITICAL = 0   # Must run immediately
    HIGH = 1       # Run before normal tasks
    NORMAL = 2     # Default priority
    LOW = 3        # Run after normal tasks
    BACKGROUND = 4 # Run when resources available


class ExecutionStatus(str, Enum):
    """Status of task execution."""
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class ResourceType(str, Enum):
    """Types of resources that can be constrained."""
    CPU = "cpu"
    MEMORY = "memory"
    API_RATE = "api_rate"
    FILE_IO = "file_io"
    NETWORK = "network"


class DeadlockStrategy(str, Enum):
    """Strategies for handling deadlocks."""
    ABORT = "abort"           # Abort all tasks in deadlock
    ROLLBACK = "rollback"     # Rollback and retry
    PRIORITY = "priority"     # Let highest priority task proceed
    TIMEOUT = "timeout"       # Wait with timeout


# ============================================================================
# Data Classes
# ============================================================================


@dataclass
class ResourceRequirements:
    """Resource requirements for a task."""
    cpu: float = 1.0          # CPU units (1.0 = one core)
    memory_mb: int = 100      # Memory in MB
    api_rate: int = 1         # API calls per task
    file_io: int = 0          # File I/O operations
    network: int = 0          # Network operations

    def can_fit(self, available: "ResourcePool") -> bool:
        """Check if requirements can be satisfied."""
        return (
            available.cpu >= self.cpu and
            available.memory_mb >= self.memory_mb
        )


@dataclass
class ResourcePool:
    """Available resources for execution."""
    cpu: float = 4.0
    memory_mb: int = 4096
    api_rate_limit: int = 100  # Per minute
    file_io_limit: int = 1000  # Per second
    network_limit: int = 100   # Concurrent connections

    def allocate(self, requirements: ResourceRequirements) -> bool:
        """Try to allocate resources."""
        if not self.can_allocate(requirements):
            return False
        self.cpu -= requirements.cpu
        self.memory_mb -= requirements.memory_mb
        return True

    def can_allocate(self, requirements: ResourceRequirements) -> bool:
        """Check if allocation is possible."""
        return (
            self.cpu >= requirements.cpu and
            self.memory_mb >= requirements.memory_mb
        )

    def release(self, requirements: ResourceRequirements) -> None:
        """Release allocated resources."""
        self.cpu += requirements.cpu
        self.memory_mb += requirements.memory_mb


@dataclass
class Task:
    """A single executable task."""
    id: str
    name: str
    coroutine: Callable
    priority: ExecutionPriority = ExecutionPriority.NORMAL
    dependencies: Set[str] = field(default_factory=set)
    timeout: float = 300.0  # 5 minutes default
    retry_count: int = 0
    max_retries: int = 3
    resources: ResourceRequirements = field(default_factory=ResourceRequirements)
    metadata: Dict[str, Any] = field(default_factory=dict)
    status: ExecutionStatus = ExecutionStatus.PENDING
    result: Any = None
    error: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None

    def __lt__(self, other: "Task") -> bool:
        """Compare tasks by priority for heap."""
        return self.priority < other.priority

    def duration(self) -> float:
        """Get task duration in seconds."""
        if self.start_time and self.end_time:
            return self.end_time - self.start_time
        if self.start_time:
            return time.time() - self.start_time
        return 0.0


@dataclass
class TaskGroup:
    """A group of related tasks."""
    name: str
    tasks: List[Task] = field(default_factory=list)
    parallel_limit: int = 3  # Max concurrent tasks in group
    fail_fast: bool = False  # Stop all on first failure
    timeout: float = 600.0   # Total group timeout
    metadata: Dict[str, Any] = field(default_factory=dict)

    def add_task(self, task: Task) -> None:
        """Add a task to the group."""
        self.tasks.append(task)

    def get_dependencies_graph(self) -> Dict[str, Set[str]]:
        """Get dependency graph for all tasks."""
        return {task.id: task.dependencies.copy() for task in self.tasks}

    def get_ready_tasks(self, completed: Set[str]) -> List[Task]:
        """Get tasks ready to execute (dependencies satisfied).

        Args:
            completed: Set of completed task IDs

        Returns:
            List of tasks ready to execute, sorted by priority
        """
        ready = []
        for task in self.tasks:
            # Skip if already completed or running
            if task.id in completed:
                continue
            if task.status != ExecutionStatus.PENDING:
                continue
            # Check if all dependencies are satisfied
            if task.dependencies.issubset(completed):
                ready.append(task)
        # Sort by priority (lower value = higher priority)
        return sorted(ready, key=lambda t: t.priority.value)


@dataclass
class ExecutionMetrics:
    """Metrics for parallel execution."""
    total_tasks: int = 0
    completed_tasks: int = 0
    failed_tasks: int = 0
    total_time: float = 0.0
    parallelism_avg: float = 0.0
    parallelism_peak: int = 0
    resource_wait_time: float = 0.0
    deadlock_count: int = 0
    retry_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "total_tasks": self.total_tasks,
            "completed_tasks": self.completed_tasks,
            "failed_tasks": self.failed_tasks,
            "success_rate": self.completed_tasks / max(1, self.total_tasks),
            "total_time": round(self.total_time, 3),
            "parallelism_avg": round(self.parallelism_avg, 2),
            "parallelism_peak": self.parallelism_peak,
            "resource_wait_time": round(self.resource_wait_time, 3),
            "deadlock_count": self.deadlock_count,
            "retry_count": self.retry_count,
        }


@dataclass
class ExecutionResult:
    """Result of parallel execution."""
    group_name: str
    status: ExecutionStatus
    results: Dict[str, Any] = field(default_factory=dict)
    errors: Dict[str, str] = field(default_factory=dict)
    metrics: ExecutionMetrics = field(default_factory=ExecutionMetrics)
    start_time: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    end_time: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "group_name": self.group_name,
            "status": self.status.value,
            "results": self.results,
            "errors": self.errors,
            "metrics": self.metrics.to_dict(),
            "start_time": self.start_time,
            "end_time": self.end_time,
        }


# ============================================================================
# Deadlock Detector
# ============================================================================


class DeadlockDetector:
    """Detects and handles deadlocks in task dependencies.

    Uses cycle detection in dependency graph to identify deadlocks.
    """

    def __init__(self, strategy: DeadlockStrategy = DeadlockStrategy.PRIORITY):
        """Initialize deadlock detector.

        Args:
            strategy: Strategy for handling detected deadlocks
        """
        self.strategy = strategy
        self._detected_deadlocks: List[Set[str]] = []

    def detect_deadlock(
        self,
        tasks: Dict[str, Task],
        running: Set[str],
        pending: Set[str],
    ) -> Optional[Set[str]]:
        """Detect if there's a deadlock in current state.

        Args:
            tasks: All tasks by ID
            running: Currently running task IDs
            pending: Pending task IDs

        Returns:
            Set of deadlocked task IDs or None
        """
        # Build dependency graph
        graph: Dict[str, Set[str]] = defaultdict(set)
        for task_id in pending:
            task = tasks.get(task_id)
            if task:
                for dep_id in task.dependencies:
                    if dep_id in pending or dep_id in running:
                        graph[task_id].add(dep_id)

        # Detect cycles using DFS
        visited: Set[str] = set()
        rec_stack: Set[str] = set()
        cycle: Set[str] = set()

        def dfs(node: str) -> bool:
            visited.add(node)
            rec_stack.add(node)

            for neighbor in graph.get(node, []):
                if neighbor not in visited:
                    if dfs(neighbor):
                        cycle.add(node)
                        return True
                elif neighbor in rec_stack:
                    cycle.add(node)
                    cycle.add(neighbor)
                    return True

            rec_stack.remove(node)
            return False

        for task_id in pending:
            if task_id not in visited:
                if dfs(task_id):
                    self._detected_deadlocks.append(cycle.copy())
                    return cycle

        return None

    def resolve_deadlock(
        self,
        deadlocked: Set[str],
        tasks: Dict[str, Task],
    ) -> List[str]:
        """Resolve deadlock based on strategy.

        Args:
            deadlocked: Set of deadlocked task IDs
            tasks: All tasks by ID

        Returns:
            List of task IDs to abort
        """
        if self.strategy == DeadlockStrategy.ABORT:
            return list(deadlocked)

        elif self.strategy == DeadlockStrategy.PRIORITY:
            # Keep highest priority task, abort others
            deadlocked_tasks = [tasks[tid] for tid in deadlocked if tid in tasks]
            if deadlocked_tasks:
                highest = min(deadlocked_tasks, key=lambda t: t.priority)
                return [tid for tid in deadlocked if tid != highest.id]
            return list(deadlocked)

        elif self.strategy == DeadlockStrategy.ROLLBACK:
            # Mark for retry
            for tid in deadlocked:
                if tid in tasks:
                    tasks[tid].retry_count += 1
            return list(deadlocked)

        return list(deadlocked)

    def get_deadlock_count(self) -> int:
        """Get number of detected deadlocks."""
        return len(self._detected_deadlocks)


# ============================================================================
# Parallel Executor
# ============================================================================


class ParallelExecutor:
    """Optimizes parallel execution of tasks with resource management.

    Features:
    - Priority-based scheduling
    - Resource-aware execution
    - Deadlock detection and prevention
    - Execution metrics and monitoring
    - Configurable concurrency limits

    Usage:
        executor = ParallelExecutor(max_concurrent=5)

        # Execute a task group
        result = await executor.execute_group(task_group)

        # Execute multiple groups
        results = await executor.execute_groups([group1, group2])
    """

    def __init__(
        self,
        max_concurrent: int = 3,
        resources: Optional[ResourcePool] = None,
        deadlock_strategy: DeadlockStrategy = DeadlockStrategy.PRIORITY,
        default_timeout: float = 300.0,
        enable_metrics: bool = True,
    ):
        """Initialize parallel executor.

        Args:
            max_concurrent: Maximum concurrent tasks
            resources: Resource pool constraints
            deadlock_strategy: Strategy for handling deadlocks
            default_timeout: Default task timeout
            enable_metrics: Track execution metrics
        """
        self.max_concurrent = max_concurrent
        self.resources = resources or ResourcePool()
        self.deadlock_detector = DeadlockDetector(deadlock_strategy)
        self.default_timeout = default_timeout
        self.enable_metrics = enable_metrics

        # State tracking
        self._running_tasks: Dict[str, asyncio.Task] = {}
        self._completed_ids: Set[str] = set()
        self._failed_ids: Set[str] = set()
        self._pending_ids: Set[str] = set()
        self._tasks_by_id: Dict[str, Task] = {}

        # Metrics
        self._metrics = ExecutionMetrics()
        self._concurrency_samples: List[int] = []
        self._lock = asyncio.Lock()

    async def execute_task(
        self,
        task: Task,
        semaphore: asyncio.Semaphore,
    ) -> Tuple[str, Any, Optional[str]]:
        """Execute a single task with resource management.

        Args:
            task: Task to execute
            semaphore: Concurrency semaphore

        Returns:
            Tuple of (task_id, result, error)
        """
        async with semaphore:
            # Resources already allocated in execute_group
            task.status = ExecutionStatus.RUNNING

            try:
                # Execute with timeout
                if inspect.iscoroutinefunction(task.coroutine):
                    result = await asyncio.wait_for(
                        task.coroutine(),
                        timeout=task.timeout,
                    )
                else:
                    # Wrap sync function
                    result = await asyncio.wait_for(
                        asyncio.to_thread(task.coroutine),
                        timeout=task.timeout,
                    )

                task.status = ExecutionStatus.COMPLETED
                task.result = result
                task.end_time = time.time()

                return (task.id, result, None)

            except asyncio.TimeoutError:
                task.status = ExecutionStatus.TIMEOUT
                task.error = f"Task timed out after {task.timeout}s"
                task.end_time = time.time()
                return (task.id, None, task.error)

            except asyncio.CancelledError:
                task.status = ExecutionStatus.CANCELLED
                task.error = "Task was cancelled"
                task.end_time = time.time()
                return (task.id, None, task.error)

            except Exception as e:
                task.status = ExecutionStatus.FAILED
                task.error = str(e)
                task.end_time = time.time()

                # Retry if possible
                if task.retry_count < task.max_retries:
                    task.retry_count += 1
                    task.status = ExecutionStatus.PENDING
                    self._metrics.retry_count += 1
                    return (task.id, None, f"Retrying ({task.retry_count}/{task.max_retries})")

                return (task.id, None, task.error)

            finally:
                # Release resources
                self.resources.release(task.resources)

    async def execute_group(self, group: TaskGroup) -> ExecutionResult:
        """Execute a task group with optimization.

        Args:
            group: Task group to execute

        Returns:
            Execution result with metrics
        """
        result = ExecutionResult(
            group_name=group.name,
            status=ExecutionStatus.RUNNING,
        )
        result.metrics.total_tasks = len(group.tasks)

        # Initialize state
        self._tasks_by_id = {task.id: task for task in group.tasks}
        self._pending_ids = {task.id for task in group.tasks}
        self._completed_ids = set()
        self._failed_ids = set()
        self._running_tasks = {}

        semaphore = asyncio.Semaphore(min(group.parallel_limit, self.max_concurrent))
        start_time = time.time()

        try:
            while self._pending_ids or self._running_tasks:
                # Check for deadlock
                deadlocked = self.deadlock_detector.detect_deadlock(
                    self._tasks_by_id,
                    set(self._running_tasks.keys()),
                    self._pending_ids,
                )

                if deadlocked:
                    result.metrics.deadlock_count += 1
                    to_abort = self.deadlock_detector.resolve_deadlock(
                        deadlocked,
                        self._tasks_by_id,
                    )

                    for task_id in to_abort:
                        if task_id in self._running_tasks:
                            self._running_tasks[task_id].cancel()
                        self._pending_ids.discard(task_id)
                        self._failed_ids.add(task_id)

                # Get ready tasks
                ready_tasks = [
                    task for task in group.tasks
                    if task.id in self._pending_ids
                    and task.dependencies.issubset(self._completed_ids)
                    and self.resources.can_allocate(task.resources)  # Check resources before starting
                ]

                # Sort by priority (lower value = higher priority)
                ready_tasks.sort(key=lambda t: t.priority.value)

                # Start ready tasks
                for task in ready_tasks[:group.parallel_limit - len(self._running_tasks)]:
                    # Pre-allocate resources before starting task
                    if not self.resources.allocate(task.resources):
                        continue  # Skip if can't allocate

                    self._pending_ids.discard(task.id)
                    task.status = ExecutionStatus.QUEUED
                    task.start_time = time.time()  # Set start time when queued

                    async_task = asyncio.create_task(
                        self.execute_task(task, semaphore)
                    )
                    self._running_tasks[task.id] = async_task

                # Track concurrency
                current_concurrency = len(self._running_tasks)
                self._concurrency_samples.append(current_concurrency)
                result.metrics.parallelism_peak = max(
                    result.metrics.parallelism_peak,
                    current_concurrency,
                )

                if not self._running_tasks:
                    # No tasks running and none pending - done or stuck
                    break

                # Wait for any task to complete
                done, _ = await asyncio.wait(
                    self._running_tasks.values(),
                    return_when=asyncio.FIRST_COMPLETED,
                    timeout=1.0,
                )

                # Process completed tasks
                for async_task in done:
                    task_id, task_result, error = await async_task

                    self._running_tasks.pop(task_id, None)

                    if error is None:
                        self._completed_ids.add(task_id)
                        result.results[task_id] = task_result
                        result.metrics.completed_tasks += 1
                    else:
                        # Check if task is retrying
                        task = self._tasks_by_id[task_id]
                        if task.status == ExecutionStatus.PENDING:
                            # Retrying - add back to pending
                            self._pending_ids.add(task_id)
                        else:
                            self._failed_ids.add(task_id)
                            result.errors[task_id] = error
                            result.metrics.failed_tasks += 1

                            if group.fail_fast:
                                # Cancel all running tasks
                                for t in self._running_tasks.values():
                                    t.cancel()
                                break

                # Check timeout
                if time.time() - start_time > group.timeout:
                    for async_task in self._running_tasks.values():
                        async_task.cancel()
                    result.status = ExecutionStatus.TIMEOUT
                    break

        except Exception as e:
            result.status = ExecutionStatus.FAILED
            result.errors["executor"] = str(e)

        finally:
            # Calculate final metrics
            result.metrics.total_time = time.time() - start_time
            if self._concurrency_samples:
                result.metrics.parallelism_avg = (
                    sum(self._concurrency_samples) / len(self._concurrency_samples)
                )

            # Determine final status
            if result.metrics.failed_tasks == 0 and result.metrics.completed_tasks == result.metrics.total_tasks:
                result.status = ExecutionStatus.COMPLETED
            elif result.metrics.completed_tasks > 0:
                result.status = ExecutionStatus.COMPLETED  # Partial success
            elif result.metrics.failed_tasks > 0:
                result.status = ExecutionStatus.FAILED
            else:
                result.status = ExecutionStatus.FAILED

            result.end_time = datetime.now(timezone.utc).isoformat()

        return result

    async def execute_groups(
        self,
        groups: List[TaskGroup],
        sequential: bool = False,
    ) -> List[ExecutionResult]:
        """Execute multiple task groups.

        Args:
            groups: List of task groups
            sequential: Run groups sequentially vs concurrently

        Returns:
            List of execution results
        """
        results = []

        if sequential:
            for group in groups:
                result = await self.execute_group(group)
                results.append(result)
        else:
            # Run groups concurrently
            tasks = [self.execute_group(g) for g in groups]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Handle exceptions
            processed = []
            for i, r in enumerate(results):
                if isinstance(r, Exception):
                    processed.append(ExecutionResult(
                        group_name=groups[i].name,
                        status=ExecutionStatus.FAILED,
                        errors={"exception": str(r)},
                    ))
                else:
                    processed.append(r)
            results = processed

        return results

    def get_metrics(self) -> ExecutionMetrics:
        """Get current execution metrics."""
        return self._metrics

    def reset(self) -> None:
        """Reset executor state."""
        self._running_tasks.clear()
        self._completed_ids.clear()
        self._failed_ids.clear()
        self._pending_ids.clear()
        self._tasks_by_id.clear()
        self._metrics = ExecutionMetrics()
        self._concurrency_samples.clear()


# ============================================================================
# Helper Functions
# ============================================================================


def create_task(
    id: str,
    name: str,
    coroutine: Callable,
    priority: ExecutionPriority = ExecutionPriority.NORMAL,
    dependencies: Optional[Set[str]] = None,
    **kwargs,
) -> Task:
    """Create a task with defaults.

    Args:
        id: Unique task ID
        name: Task name
        coroutine: Async function to execute
        priority: Execution priority
        dependencies: Set of task IDs this task depends on
        **kwargs: Additional Task arguments

    Returns:
        Configured Task instance
    """
    return Task(
        id=id,
        name=name,
        coroutine=coroutine,
        priority=priority,
        dependencies=dependencies or set(),
        **kwargs,
    )


def create_task_group(
    name: str,
    tasks: List[Task],
    parallel_limit: int = 3,
    **kwargs,
) -> TaskGroup:
    """Create a task group with defaults.

    Args:
        name: Group name
        tasks: List of tasks
        parallel_limit: Maximum concurrent tasks
        **kwargs: Additional TaskGroup arguments

    Returns:
        Configured TaskGroup instance
    """
    return TaskGroup(
        name=name,
        tasks=tasks,
        parallel_limit=parallel_limit,
        **kwargs,
    )


# ============================================================================
# Global Instance
# ============================================================================


_global_executor: Optional[ParallelExecutor] = None


def get_parallel_executor() -> ParallelExecutor:
    """Get or create global parallel executor instance."""
    global _global_executor
    if _global_executor is None:
        _global_executor = ParallelExecutor()
    return _global_executor


def reset_parallel_executor() -> None:
    """Reset global executor (for testing)."""
    global _global_executor
    _global_executor = None
