"""Tests for Parallel Execution functionality."""

import asyncio
import pytest
from datetime import datetime

from src.orchestrator.parallel_execution import (
    ParallelExecutor,
    Task,
    TaskGroup,
    ExecutionPriority,
    ExecutionStatus,
    ExecutionMetrics,
    ExecutionResult,
    ResourceRequirements,
    ResourcePool,
    DeadlockDetector,
    DeadlockStrategy,
    create_task,
    create_task_group,
    get_parallel_executor,
    reset_parallel_executor,
)


class TestExecutionPriority:
    """Test suite for ExecutionPriority."""

    def test_priority_order(self):
        """Test priority ordering."""
        assert ExecutionPriority.CRITICAL < ExecutionPriority.HIGH
        assert ExecutionPriority.HIGH < ExecutionPriority.NORMAL
        assert ExecutionPriority.NORMAL < ExecutionPriority.LOW
        assert ExecutionPriority.LOW < ExecutionPriority.BACKGROUND


class TestResourceRequirements:
    """Test suite for ResourceRequirements."""

    def test_defaults(self):
        """Test default values."""
        req = ResourceRequirements()
        assert req.cpu == 1.0
        assert req.memory_mb == 100

    def test_can_fit(self):
        """Test resource fitting check."""
        req = ResourceRequirements(cpu=2.0, memory_mb=500)
        pool = ResourcePool(cpu=4.0, memory_mb=1024)
        assert req.can_fit(pool) is True

        pool_small = ResourcePool(cpu=1.0, memory_mb=1024)
        assert req.can_fit(pool_small) is False


class TestResourcePool:
    """Test suite for ResourcePool."""

    def test_allocate(self):
        """Test resource allocation."""
        pool = ResourcePool(cpu=4.0, memory_mb=1024)
        req = ResourceRequirements(cpu=2.0, memory_mb=256)

        success = pool.allocate(req)
        assert success is True
        assert pool.cpu == 2.0
        assert pool.memory_mb == 768

    def test_allocate_insufficient(self):
        """Test allocation with insufficient resources."""
        pool = ResourcePool(cpu=1.0, memory_mb=100)
        req = ResourceRequirements(cpu=2.0, memory_mb=256)

        success = pool.allocate(req)
        assert success is False

    def test_release(self):
        """Test resource release."""
        pool = ResourcePool(cpu=4.0, memory_mb=1024)
        req = ResourceRequirements(cpu=2.0, memory_mb=256)

        pool.allocate(req)
        pool.release(req)

        assert pool.cpu == 4.0
        assert pool.memory_mb == 1024


class TestTask:
    """Test suite for Task."""

    def test_task_creation(self):
        """Test task creation."""
        async def dummy():
            return "result"

        task = Task(
            id="task-1",
            name="Test Task",
            coroutine=dummy,
        )
        assert task.id == "task-1"
        assert task.priority == ExecutionPriority.NORMAL
        assert task.status == ExecutionStatus.PENDING

    def test_task_comparison(self):
        """Test task priority comparison."""
        async def dummy():
            pass

        task_high = Task(id="1", name="High", coroutine=dummy, priority=ExecutionPriority.HIGH)
        task_low = Task(id="2", name="Low", coroutine=dummy, priority=ExecutionPriority.LOW)

        assert task_high < task_low

    def test_task_duration(self):
        """Test task duration calculation."""
        async def dummy():
            pass

        task = Task(
            id="task-1",
            name="Test",
            coroutine=dummy,
            start_time=100.0,
            end_time=105.0,
        )
        assert task.duration() == 5.0


class TestTaskGroup:
    """Test suite for TaskGroup."""

    def test_group_creation(self):
        """Test group creation."""
        async def dummy():
            pass

        group = TaskGroup(
            name="test-group",
            tasks=[
                Task(id="t1", name="Task 1", coroutine=dummy),
                Task(id="t2", name="Task 2", coroutine=dummy),
            ],
        )
        assert group.name == "test-group"
        assert len(group.tasks) == 2

    def test_add_task(self):
        """Test adding tasks."""
        async def dummy():
            pass

        group = TaskGroup(name="test")
        group.add_task(Task(id="t1", name="Task", coroutine=dummy))

        assert len(group.tasks) == 1

    def test_get_ready_tasks(self):
        """Test getting ready tasks."""
        async def dummy():
            pass

        group = TaskGroup(
            name="test",
            tasks=[
                Task(id="t1", name="Task 1", coroutine=dummy),
                Task(id="t2", name="Task 2", coroutine=dummy, dependencies={"t1"}),
            ],
        )

        # Initially only t1 is ready (no dependencies)
        ready = group.get_ready_tasks(set())
        ready_ids = [t.id for t in ready]
        assert "t1" in ready_ids
        # t2 should NOT be ready since t1 is not completed
        assert "t2" not in ready_ids

        # After t1 completes, t2 is ready
        ready = group.get_ready_tasks({"t1"})
        assert len(ready) == 1
        assert ready[0].id == "t2"


class TestDeadlockDetector:
    """Test suite for DeadlockDetector."""

    def test_no_deadlock(self):
        """Test detection with no deadlock."""
        detector = DeadlockDetector()

        async def dummy():
            pass

        tasks = {
            "t1": Task(id="t1", name="T1", coroutine=dummy),
            "t2": Task(id="t2", name="T2", coroutine=dummy, dependencies={"t1"}),
        }

        deadlock = detector.detect_deadlock(tasks, set(), {"t1", "t2"})
        assert deadlock is None

    def test_deadlock_detection(self):
        """Test deadlock detection."""
        detector = DeadlockDetector()

        async def dummy():
            pass

        # Circular dependency: t1 -> t2 -> t1
        tasks = {
            "t1": Task(id="t1", name="T1", coroutine=dummy, dependencies={"t2"}),
            "t2": Task(id="t2", name="T2", coroutine=dummy, dependencies={"t1"}),
        }

        deadlock = detector.detect_deadlock(tasks, set(), {"t1", "t2"})
        assert deadlock is not None
        assert len(deadlock) == 2

    def test_resolve_deadlock_abort(self):
        """Test deadlock resolution with abort strategy."""
        detector = DeadlockDetector(strategy=DeadlockStrategy.ABORT)

        async def dummy():
            pass

        tasks = {
            "t1": Task(id="t1", name="T1", coroutine=dummy),
            "t2": Task(id="t2", name="T2", coroutine=dummy),
        }

        to_abort = detector.resolve_deadlock({"t1", "t2"}, tasks)
        assert len(to_abort) == 2

    def test_resolve_deadlock_priority(self):
        """Test deadlock resolution with priority strategy."""
        detector = DeadlockDetector(strategy=DeadlockStrategy.PRIORITY)

        async def dummy():
            pass

        tasks = {
            "t1": Task(id="t1", name="T1", coroutine=dummy, priority=ExecutionPriority.HIGH),
            "t2": Task(id="t2", name="T2", coroutine=dummy, priority=ExecutionPriority.LOW),
        }

        to_abort = detector.resolve_deadlock({"t1", "t2"}, tasks)
        # Should abort the lower priority task
        assert "t2" in to_abort
        assert "t1" not in to_abort


class TestExecutionMetrics:
    """Test suite for ExecutionMetrics."""

    def test_to_dict(self):
        """Test metrics to dict."""
        metrics = ExecutionMetrics(
            total_tasks=10,
            completed_tasks=8,
            failed_tasks=2,
            total_time=5.5,
            parallelism_peak=3,
        )
        d = metrics.to_dict()
        assert d["total_tasks"] == 10
        assert d["success_rate"] == 0.8
        assert d["parallelism_peak"] == 3


class TestParallelExecutor:
    """Test suite for ParallelExecutor."""

    def test_initialization(self):
        """Test executor initialization."""
        executor = ParallelExecutor(max_concurrent=5)
        assert executor.max_concurrent == 5

    @pytest.mark.asyncio
    async def test_execute_single_task(self):
        """Test executing a single task."""
        async def task_func():
            await asyncio.sleep(0.1)
            return "result"

        executor = ParallelExecutor()
        group = TaskGroup(
            name="test",
            tasks=[Task(id="t1", name="Task 1", coroutine=task_func)],
        )

        result = await executor.execute_group(group)

        assert result.status == ExecutionStatus.COMPLETED
        assert "t1" in result.results
        assert result.results["t1"] == "result"

    @pytest.mark.asyncio
    async def test_execute_parallel_tasks(self):
        """Test executing parallel tasks."""
        results = []

        async def task_func(name):
            await asyncio.sleep(0.1)
            results.append(name)
            return name

        executor = ParallelExecutor(max_concurrent=3)
        group = TaskGroup(
            name="test",
            tasks=[
                Task(id="t1", name="Task 1", coroutine=lambda: task_func("A")),
                Task(id="t2", name="Task 2", coroutine=lambda: task_func("B")),
                Task(id="t3", name="Task 3", coroutine=lambda: task_func("C")),
            ],
            parallel_limit=3,
        )

        start = asyncio.get_event_loop().time()
        result = await executor.execute_group(group)
        elapsed = asyncio.get_event_loop().time() - start

        assert result.status == ExecutionStatus.COMPLETED
        assert len(result.results) == 3
        # Should run in parallel, so total time ~ 0.1s, not 0.3s
        assert elapsed < 0.5

    @pytest.mark.asyncio
    async def test_execute_with_dependencies(self):
        """Test executing tasks with dependencies."""
        order = []

        async def task_a():
            order.append("A")
            return "A"

        async def task_b():
            order.append("B")
            return "B"

        async def task_c():
            order.append("C")
            return "C"

        executor = ParallelExecutor()
        group = TaskGroup(
            name="test",
            tasks=[
                Task(id="a", name="A", coroutine=task_a),
                Task(id="b", name="B", coroutine=task_b, dependencies={"a"}),
                Task(id="c", name="C", coroutine=task_c, dependencies={"b"}),
            ],
        )

        result = await executor.execute_group(group)

        assert result.status == ExecutionStatus.COMPLETED
        assert order == ["A", "B", "C"]

    @pytest.mark.asyncio
    async def test_execute_with_failure(self):
        """Test executing with task failure."""
        async def success_task():
            return "success"

        async def fail_task():
            raise ValueError("Task failed")

        executor = ParallelExecutor()
        group = TaskGroup(
            name="test",
            tasks=[
                Task(id="t1", name="Success", coroutine=success_task),
                Task(id="t2", name="Fail", coroutine=fail_task),
            ],
        )

        result = await executor.execute_group(group)

        assert "t1" in result.results
        assert "t2" in result.errors

    @pytest.mark.asyncio
    async def test_execute_with_timeout(self):
        """Test executing with timeout."""
        async def slow_task():
            await asyncio.sleep(10)
            return "result"

        executor = ParallelExecutor()
        group = TaskGroup(
            name="test",
            tasks=[
                Task(id="t1", name="Slow", coroutine=slow_task, timeout=0.2),
            ],
        )

        result = await executor.execute_group(group)

        # Task timed out, so it should be in errors
        assert "t1" in result.errors
        assert result.metrics.failed_tasks == 1

    @pytest.mark.asyncio
    async def test_execute_with_priority(self):
        """Test priority-based execution."""
        order = []

        # Create actual async coroutines (not lambdas returning coroutines)
        async def task_low():
            await asyncio.sleep(0.01)
            order.append("low")
            return "low"

        async def task_high():
            await asyncio.sleep(0.01)
            order.append("high")
            return "high"

        async def task_normal():
            await asyncio.sleep(0.01)
            order.append("normal")
            return "normal"

        executor = ParallelExecutor(max_concurrent=1)  # Force sequential
        group = TaskGroup(
            name="test",
            tasks=[
                Task(id="low", name="Low", coroutine=task_low, priority=ExecutionPriority.LOW),
                Task(id="high", name="High", coroutine=task_high, priority=ExecutionPriority.HIGH),
                Task(id="normal", name="Normal", coroutine=task_normal, priority=ExecutionPriority.NORMAL),
            ],
        )

        result = await executor.execute_group(group)

        # High should execute first, then normal, then low
        assert order == ["high", "normal", "low"]

    @pytest.mark.asyncio
    async def test_execute_groups(self):
        """Test executing multiple groups."""
        async def task_func():
            return "result"

        executor = ParallelExecutor()
        groups = [
            TaskGroup(
                name="group1",
                tasks=[Task(id="g1-t1", name="Task", coroutine=task_func)],
            ),
            TaskGroup(
                name="group2",
                tasks=[Task(id="g2-t1", name="Task", coroutine=task_func)],
            ),
        ]

        results = await executor.execute_groups(groups)

        assert len(results) == 2
        assert all(r.status == ExecutionStatus.COMPLETED for r in results)

    @pytest.mark.asyncio
    async def test_resource_constraints(self):
        """Test resource constraints."""
        async def task_func():
            await asyncio.sleep(0.1)
            return "result"

        # Limited resources - only 1 CPU unit available
        pool = ResourcePool(cpu=1.0, memory_mb=256)
        executor = ParallelExecutor(
            max_concurrent=3,
            resources=pool,
        )

        group = TaskGroup(
            name="test",
            tasks=[
                Task(
                    id=f"t{i}",
                    name=f"Task {i}",
                    coroutine=task_func,
                    resources=ResourceRequirements(cpu=1.0, memory_mb=100),
                )
                for i in range(3)
            ],
            parallel_limit=3,
        )

        result = await executor.execute_group(group)

        # Only 1 task can run at once due to CPU constraint
        assert result.status == ExecutionStatus.COMPLETED
        assert result.metrics.parallelism_peak == 1

    def test_reset(self):
        """Test executor reset."""
        executor = ParallelExecutor()
        executor._completed_ids.add("test")
        executor.reset()

        assert len(executor._completed_ids) == 0


class TestHelperFunctions:
    """Test suite for helper functions."""

    def test_create_task(self):
        """Test create_task helper."""
        async def dummy():
            pass

        task = create_task(
            id="test",
            name="Test",
            coroutine=dummy,
            priority=ExecutionPriority.HIGH,
        )

        assert task.id == "test"
        assert task.priority == ExecutionPriority.HIGH

    def test_create_task_group(self):
        """Test create_task_group helper."""
        async def dummy():
            pass

        group = create_task_group(
            name="test",
            tasks=[create_task("t1", "T1", dummy)],
            parallel_limit=5,
        )

        assert group.name == "test"
        assert group.parallel_limit == 5


class TestGlobalExecutor:
    """Test suite for global executor functions."""

    def test_get_parallel_executor(self):
        """Test getting global executor."""
        reset_parallel_executor()
        executor1 = get_parallel_executor()
        assert executor1 is not None

        executor2 = get_parallel_executor()
        assert executor1 is executor2

    def test_reset_parallel_executor(self):
        """Test resetting global executor."""
        reset_parallel_executor()
        executor = get_parallel_executor()
        assert executor is not None
