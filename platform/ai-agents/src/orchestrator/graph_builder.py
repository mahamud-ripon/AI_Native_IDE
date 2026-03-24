from __future__ import annotations

from typing import Any, Dict, List, Optional

from langgraph.graph import END, StateGraph

from .human_in_the_loop import (
    HumanInTheLoopManager,
    WorkflowPauseReason,
    get_human_manager,
)
from .cost_aggregator import CostAggregator, get_cost_aggregator
from .schema_validation import (
    ValidationMiddleware,
    ValidationResult,
    ValidationStatus,
    get_validation_middleware,
)
from .parallel_execution import (
    ParallelExecutor,
    Task,
    TaskGroup,
    ExecutionPriority,
    ExecutionStatus as ParallelExecutionStatus,
    ExecutionResult,
    get_parallel_executor,
)
from .security import JailbreakClassifier
from .state_schema import AgentState
from .streaming import EventEmitter, EventType, StreamEvent
from ..agents.architect_agent import ArchitectAgent
from ..agents.backend_agent import BackendAgent
from ..agents.devops_agent import DevOpsAgent
from ..agents.frontend_agent import FrontendAgent
from ..agents.pm_agent import PMAgent
from ..agents.qa_agent import QAAgent
from ..agents.security_agent import SecurityAgent
from ..tools.registry import ToolRegistry


class GraphBuilder:
    """Builds the LangGraph DAG for multi-agent orchestration.

    Execution Flow:
    1. Precheck (jailbreak defense)
    2. PM Agent -> Architect Agent (sequential)
    3. Backend + Frontend + DevOps (parallel)
    4. QA Agent (gatekeeper)
    5. Security Agent (final scan)
    6. Feedback loop: QA can retry up to max_iterations

    Streaming Support:
    - Optional EventEmitter for real-time progress updates
    - Events: agent_start, agent_progress, agent_complete, agent_error

    Human-in-the-loop Support:
    - When MAX_RETRIES exceeded, workflow pauses for human guidance
    - Human can choose: retry, skip, modify requirements, or abort
    """

    MAX_ITERATIONS = 3  # Hard-coded limit to prevent infinite token burn
    ENABLE_HUMAN_IN_THE_LOOP = True  # Feature flag
    ENABLE_SCHEMA_VALIDATION = True  # Feature flag for validation
    ENABLE_PARALLEL_EXECUTION = True  # Feature flag for optimized parallel execution

    def __init__(
        self,
        emitter: Optional[EventEmitter] = None,
        human_manager: Optional[HumanInTheLoopManager] = None,
        cost_aggregator: Optional[CostAggregator] = None,
        validation_middleware: Optional[ValidationMiddleware] = None,
        parallel_executor: Optional[ParallelExecutor] = None,
        workflow_id: Optional[str] = None,
    ) -> None:
        """Initialize GraphBuilder.

        Args:
            emitter: Optional EventEmitter for streaming progress updates
            human_manager: Optional HumanInTheLoopManager for pause/resume
            cost_aggregator: Optional CostAggregator for cost tracking
            validation_middleware: Optional ValidationMiddleware for output validation
            parallel_executor: Optional ParallelExecutor for optimized concurrent execution
            workflow_id: Optional workflow identifier for human-in-the-loop
        """
        self.pm = PMAgent()
        self.architect = ArchitectAgent()
        self.backend = BackendAgent()
        self.frontend = FrontendAgent()
        self.devops = DevOpsAgent()
        self.qa = QAAgent()
        self.security = SecurityAgent()
        self.tool_registry = ToolRegistry()
        self.jailbreak = JailbreakClassifier()
        self.emitter = emitter
        self.human_manager = human_manager or get_human_manager()
        self.cost_aggregator = cost_aggregator or get_cost_aggregator()
        self.validation = validation_middleware or get_validation_middleware()
        self.parallel_executor = parallel_executor or get_parallel_executor()
        self.workflow_id = workflow_id or f"wf-{id(self)}"

        # Start cost tracking for this workflow
        self.cost_aggregator.start_workflow(self.workflow_id)

    async def _emit(self, event: StreamEvent) -> None:
        """Emit event if emitter is configured."""
        if self.emitter:
            await self.emitter.emit(event)

    async def _emit_token(self, agent_name: str, token: str) -> None:
        """Emit individual token for real-time streaming display."""
        if self.emitter:
            await self.emitter.emit(StreamEvent.token(agent_name, token))

    async def _run_parallel_phase(self, state: AgentState) -> dict:
        """Run Backend, Frontend, and DevOps agents in parallel.

        Uses ParallelExecutor for optimized concurrent execution with:
        - Priority-based scheduling
        - Resource constraints
        - Deadlock detection
        - Execution metrics

        Args:
            state: Current workflow state

        Returns:
            Combined results from all parallel agents
        """
        if not self.ENABLE_PARALLEL_EXECUTION:
            # Fallback to sequential execution
            backend_result = await self._run_backend(state)
            frontend_result = await self._run_frontend(state)
            devops_result = await self._run_devops(state)
            return {
                **backend_result,
                **frontend_result,
                **devops_result,
            }

        # Emit parallel start event
        await self._emit(StreamEvent.parallel_start(
            group_name="code_generation",
            task_count=3,
            parallel_limit=3,
        ))

        # Create task group for parallel execution
        async def run_backend():
            return await self.backend.run(state)

        async def run_frontend():
            return await self.frontend.run(state)

        async def run_devops():
            return await self.devops.run(state)

        group = TaskGroup(
            name="code_generation",
            tasks=[
                Task(
                    id="backend",
                    name="Backend Agent",
                    coroutine=run_backend,
                    priority=ExecutionPriority.HIGH,  # Backend is critical
                    timeout=300.0,
                ),
                Task(
                    id="frontend",
                    name="Frontend Agent",
                    coroutine=run_frontend,
                    priority=ExecutionPriority.NORMAL,
                    timeout=300.0,
                ),
                Task(
                    id="devops",
                    name="DevOps Agent",
                    coroutine=run_devops,
                    priority=ExecutionPriority.LOW,  # DevOps can wait
                    timeout=300.0,
                ),
            ],
            parallel_limit=3,
            fail_fast=False,
        )

        # Execute parallel group
        result = await self.parallel_executor.execute_group(group)

        # Emit completion event
        await self._emit(StreamEvent.parallel_complete(
            group_name="code_generation",
            metrics=result.metrics.to_dict(),
        ))

        # Process results
        combined = {}
        for task_id, task_result in result.results.items():
            if task_id == "backend":
                combined["backend_output"] = task_result.get("backend_output")
                combined["cost_sofar"] = combined.get("cost_sofar", 0) + task_result.get("cost_sofar", 0)
                # Record cost
                cache_stats = task_result.get("cache_stats")
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="backend_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-5-sonnet-20241022",
                    success=True,
                )
                await self._emit(StreamEvent.agent_complete(
                    "backend_agent",
                    task_result.get("backend_output"),
                    0.0,
                    cache_stats,
                ))
            elif task_id == "frontend":
                combined["frontend_output"] = task_result.get("frontend_output")
                combined["cost_sofar"] = combined.get("cost_sofar", 0) + task_result.get("cost_sofar", 0)
                cache_stats = task_result.get("cache_stats")
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="frontend_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-5-sonnet-20241022",
                    success=True,
                )
                await self._emit(StreamEvent.agent_complete(
                    "frontend_agent",
                    task_result.get("frontend_output"),
                    0.0,
                    cache_stats,
                ))
            elif task_id == "devops":
                combined["devops_output"] = task_result.get("devops_output")
                combined["cost_sofar"] = combined.get("cost_sofar", 0) + task_result.get("cost_sofar", 0)
                cache_stats = task_result.get("cache_stats")
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="devops_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-5-sonnet-20241022",
                    success=True,
                )
                await self._emit(StreamEvent.agent_complete(
                    "devops_agent",
                    task_result.get("devops_output"),
                    0.0,
                    cache_stats,
                ))

        # Process errors
        for task_id, error in result.errors.items():
            combined.setdefault("errors", []).append(f"{task_id} failed: {error}")
            await self._emit(StreamEvent.parallel_error(
                group_name="code_generation",
                task_id=task_id,
                error=error,
            ))

        return combined

    async def _validate_output(
        self,
        agent_name: str,
        output: Any,
    ) -> ValidationResult:
        """Validate agent output against schema.

        Args:
            agent_name: Name of the agent
            output: Output data to validate

        Returns:
            ValidationResult with status and errors
        """
        if not self.ENABLE_SCHEMA_VALIDATION:
            return ValidationResult(
                agent_name=agent_name,
                status=ValidationStatus.SKIPPED,
            )

        result = await self.validation.validate(agent_name, output)

        # Emit validation event
        if result.is_valid:
            await self._emit(StreamEvent.validation_passed(
                agent_name=agent_name,
                warnings=result.warnings,
            ))
        else:
            await self._emit(StreamEvent.validation_failed(
                agent_name=agent_name,
                errors=result.errors,
            ))

        return result

    async def _check_human_input_required(
        self,
        agent_name: str,
        error: str,
        state: AgentState,
    ) -> dict:
        """Check if human input is required and wait for response.

        Args:
            agent_name: Name of the failed agent
            error: Error message
            state: Current workflow state

        Returns:
            Result dict with human guidance
        """
        if not self.ENABLE_HUMAN_IN_THE_LOOP:
            return {"errors": [f"{agent_name} failed: {error}"]}

        # Emit human input required event
        await self._emit(StreamEvent.human_input_required(
            agent_name=agent_name,
            question=f"{agent_name} failed after {self.MAX_ITERATIONS} attempts. How should I proceed?",
            options=["Retry", "Skip Agent", "Modify Requirements", "Abort Workflow"],
        ))

        # Pause workflow and request human input
        request = await self.human_manager.pause_for_input(
            workflow_id=self.workflow_id,
            agent_name=agent_name,
            reason=WorkflowPauseReason.AGENT_FAILED,
            current_state=state.model_dump(),
            question=f"{agent_name} failed with error: {error}",
            options=["Retry", "Skip Agent", "Modify Requirements", "Abort Workflow"],
            context={"error": error, "agent": agent_name},
        )

        # Wait for human response
        result = await self.human_manager.wait_for_response(self.workflow_id)

        if result is None:
            # Timeout - default to abort
            await self._emit(StreamEvent.agent_error(agent_name, "Human input timeout - aborting"))
            return {"errors": [f"{agent_name} failed and human input timed out"], "abort": True}

        response = result.get("response", "Abort Workflow")

        # Emit human input received
        await self._emit(StreamEvent.human_input_received(
            agent_name=agent_name,
            response=response,
        ))

        # Process human response
        if response == "Retry":
            return {"retry": True, "agent": agent_name}
        elif response == "Skip Agent":
            return {"skip": True, "agent": agent_name}
        elif response == "Modify Requirements":
            return {
                "modify": True,
                "agent": agent_name,
                "message": "Please provide updated requirements",
            }
        else:  # Abort Workflow
            return {"errors": [f"{agent_name} failed - workflow aborted by human"], "abort": True}

    def _precheck(self, state: AgentState):
        """Pre-graph jailbreak classifier. Aborts on unsafe prompts."""
        try:
            self.jailbreak.abort_if_unsafe(state.user_prompt)
        except Exception as e:
            return {"errors": [str(e)]}
        return {}

    async def _run_pm(self, state: AgentState) -> dict:
        """Run PM Agent with streaming events and validation."""
        await self._emit(StreamEvent.agent_start("pm_agent", "Analyzing requirements..."))
        await self._emit(StreamEvent.agent_progress("pm_agent", 10, "Processing user prompt..."))

        try:
            # Use streaming mode if emitter is available
            if self.emitter:
                # Token callback for streaming
                async def on_token(token: str):
                    await self._emit_token("pm_agent", token)
                
                # Get streaming generator - yields (token, metadata) tuples
                stream_gen = self.pm.run_stream(state, on_token=on_token)
                
                # Consume the generator
                result = None
                async for token, metadata in stream_gen:
                    # Check if this is the final result
                    if metadata.get("done"):
                        if "error" in metadata:
                            result = {"errors": [metadata["error"]]}
                        else:
                            result = {
                                "pm_output": metadata.get("pm_output"),
                                "cost_sofar": metadata.get("cost_sofar", 0.0),
                                "cache_stats": metadata.get("cache_stats"),
                            }
                        break
                
                if result is None:
                    result = {"errors": ["PM Agent streaming returned no result"]}
            else:
                # Non-streaming mode
                result = await self.pm.run(state)

            if "errors" in result and result["errors"]:
                await self._emit(StreamEvent.agent_error("pm_agent", str(result["errors"])))
            else:
                cost = result.get("cost_sofar", 0.0)
                cache_stats = result.get("cache_stats")
                pm_output = result.get("pm_output")
                
                # Validate output
                if self.ENABLE_SCHEMA_VALIDATION and pm_output:
                    validation_result = await self._validate_output("pm_agent", pm_output)
                    if not validation_result.is_valid:
                        # Add validation errors to result
                        result.setdefault("validation_errors", {})["pm_agent"] = [
                            err.to_dict() for err in validation_result.errors
                        ]
                
                # Record cost in aggregator
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="pm_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-opus-20240229",
                    success=True,
                )
                
                await self._emit(StreamEvent.agent_complete(
                    "pm_agent",
                    pm_output,
                    cost,
                    cache_stats,
                ))

            return result
        except Exception as e:
            await self._emit(StreamEvent.agent_error("pm_agent", str(e)))
            self.cost_aggregator.record_cost(
                workflow_id=self.workflow_id,
                agent_name="pm_agent",
                input_tokens=0,
                output_tokens=0,
                model="claude-3-opus-20240229",
                success=False,
                error=str(e),
            )
            return {"errors": [f"PM Agent failed: {e}"]}

    async def _run_architect(self, state: AgentState) -> dict:
        """Run Architect Agent with streaming events and validation."""
        await self._emit(StreamEvent.agent_start("architect_agent", "Designing system architecture..."))
        await self._emit(StreamEvent.agent_progress("architect_agent", 10, "Analyzing requirements..."))

        try:
            result = await self.architect.run(state)

            if "errors" in result and result["errors"]:
                await self._emit(StreamEvent.agent_error("architect_agent", str(result["errors"])))
            else:
                cost = result.get("cost_sofar", 0.0)
                cache_stats = result.get("cache_stats")
                architect_output = result.get("architect_output")
                
                # Validate output
                if self.ENABLE_SCHEMA_VALIDATION and architect_output:
                    validation_result = await self._validate_output("architect_agent", architect_output)
                    if not validation_result.is_valid:
                        result.setdefault("validation_errors", {})["architect_agent"] = [
                            err.to_dict() for err in validation_result.errors
                        ]
                
                # Record cost in aggregator
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="architect_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-opus-20240229",
                    success=True,
                )
                
                await self._emit(StreamEvent.agent_complete(
                    "architect_agent",
                    architect_output,
                    cost,
                    cache_stats,
                ))

            return result
        except Exception as e:
            await self._emit(StreamEvent.agent_error("architect_agent", str(e)))
            self.cost_aggregator.record_cost(
                workflow_id=self.workflow_id,
                agent_name="architect_agent",
                input_tokens=0,
                output_tokens=0,
                model="claude-3-opus-20240229",
                success=False,
                error=str(e),
            )
            return {"errors": [f"Architect Agent failed: {e}"]}

    async def _run_backend(self, state: AgentState) -> dict:
        """Run Backend Agent with streaming events."""
        await self._emit(StreamEvent.agent_start("backend_agent", "Generating backend code..."))
        await self._emit(StreamEvent.agent_progress("backend_agent", 20, "Creating API routes..."))

        try:
            result = await self.backend.run(state)

            if "errors" in result and result["errors"]:
                await self._emit(StreamEvent.agent_error("backend_agent", str(result["errors"])))
            else:
                cache_stats = result.get("cache_stats")
                
                # Record cost in aggregator
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="backend_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-5-sonnet-20241022",
                    success=True,
                )
                
                await self._emit(StreamEvent.agent_complete(
                    "backend_agent",
                    result.get("backend_output"),
                    0.0,
                    cache_stats,
                ))

            return result
        except Exception as e:
            await self._emit(StreamEvent.agent_error("backend_agent", str(e)))
            self.cost_aggregator.record_cost(
                workflow_id=self.workflow_id,
                agent_name="backend_agent",
                input_tokens=0,
                output_tokens=0,
                model="claude-3-sonnet",
                success=False,
                error=str(e),
            )
            return {"errors": [f"Backend Agent failed: {e}"]}

    async def _run_frontend(self, state: AgentState) -> dict:
        """Run Frontend Agent with streaming events."""
        await self._emit(StreamEvent.agent_start("frontend_agent", "Generating frontend code..."))
        await self._emit(StreamEvent.agent_progress("frontend_agent", 20, "Creating React components..."))

        try:
            result = await self.frontend.run(state)

            if "errors" in result and result["errors"]:
                await self._emit(StreamEvent.agent_error("frontend_agent", str(result["errors"])))
            else:
                cache_stats = result.get("cache_stats")
                
                # Record cost in aggregator
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="frontend_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-5-sonnet-20241022",
                    success=True,
                )
                
                await self._emit(StreamEvent.agent_complete(
                    "frontend_agent",
                    result.get("frontend_output"),
                    0.0,
                    cache_stats,
                ))

            return result
        except Exception as e:
            await self._emit(StreamEvent.agent_error("frontend_agent", str(e)))
            self.cost_aggregator.record_cost(
                workflow_id=self.workflow_id,
                agent_name="frontend_agent",
                input_tokens=0,
                output_tokens=0,
                model="claude-3-sonnet",
                success=False,
                error=str(e),
            )
            return {"errors": [f"Frontend Agent failed: {e}"]}

    async def _run_devops(self, state: AgentState) -> dict:
        """Run DevOps Agent with streaming events."""
        await self._emit(StreamEvent.agent_start("devops_agent", "Generating DevOps configs..."))
        await self._emit(StreamEvent.agent_progress("devops_agent", 20, "Creating Dockerfile..."))

        try:
            result = await self.devops.run(state)

            if "errors" in result and result["errors"]:
                await self._emit(StreamEvent.agent_error("devops_agent", str(result["errors"])))
            else:
                cache_stats = result.get("cache_stats")
                
                # Record cost in aggregator
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="devops_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-5-sonnet-20241022",
                    success=True,
                )
                
                await self._emit(StreamEvent.agent_complete(
                    "devops_agent",
                    result.get("devops_output"),
                    0.0,
                    cache_stats,
                ))

            return result
        except Exception as e:
            await self._emit(StreamEvent.agent_error("devops_agent", str(e)))
            self.cost_aggregator.record_cost(
                workflow_id=self.workflow_id,
                agent_name="devops_agent",
                input_tokens=0,
                output_tokens=0,
                model="claude-3-sonnet",
                success=False,
                error=str(e),
            )
            return {"errors": [f"DevOps Agent failed: {e}"]}

    async def _run_qa(self, state: AgentState) -> dict:
        """Run QA Agent with streaming events and validation."""
        await self._emit(StreamEvent.agent_start("qa_agent", "Running tests..."))
        await self._emit(StreamEvent.agent_progress("qa_agent", 30, "Validating code..."))

        try:
            result = await self.qa.run(state)

            if "errors" in result and result["errors"]:
                await self._emit(StreamEvent.agent_error("qa_agent", str(result["errors"])))
            else:
                cache_stats = result.get("cache_stats")
                qa_output = result.get("qa_output")
                
                # Validate output
                if self.ENABLE_SCHEMA_VALIDATION and qa_output:
                    validation_result = await self._validate_output("qa_agent", qa_output)
                    if not validation_result.is_valid:
                        result.setdefault("validation_errors", {})["qa_agent"] = [
                            err.to_dict() for err in validation_result.errors
                        ]
                
                # Record cost in aggregator
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="qa_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-5-sonnet-20241022",
                    success=True,
                )
                
                await self._emit(StreamEvent.agent_complete(
                    "qa_agent",
                    qa_output,
                    0.0,
                    cache_stats,
                ))

            return result
        except Exception as e:
            await self._emit(StreamEvent.agent_error("qa_agent", str(e)))
            self.cost_aggregator.record_cost(
                workflow_id=self.workflow_id,
                agent_name="qa_agent",
                input_tokens=0,
                output_tokens=0,
                model="claude-3-sonnet",
                success=False,
                error=str(e),
            )
            return {"errors": [f"QA Agent failed: {e}"]}

    async def _run_security(self, state: AgentState) -> dict:
        """Run Security Agent with streaming events and validation."""
        await self._emit(StreamEvent.agent_start("security_agent", "Scanning for vulnerabilities..."))
        await self._emit(StreamEvent.agent_progress("security_agent", 50, "Checking OWASP Top 10..."))

        try:
            result = await self.security.run(state)

            if "errors" in result and result["errors"]:
                await self._emit(StreamEvent.agent_error("security_agent", str(result["errors"])))
            else:
                cache_stats = result.get("cache_stats")
                security_output = result.get("security_output")
                
                # Validate output
                if self.ENABLE_SCHEMA_VALIDATION and security_output:
                    validation_result = await self._validate_output("security_agent", security_output)
                    if not validation_result.is_valid:
                        result.setdefault("validation_errors", {})["security_agent"] = [
                            err.to_dict() for err in validation_result.errors
                        ]
                
                # Record cost in aggregator
                self.cost_aggregator.record_cost(
                    workflow_id=self.workflow_id,
                    agent_name="security_agent",
                    input_tokens=cache_stats.get("input_tokens", 0) if cache_stats else 0,
                    output_tokens=cache_stats.get("output_tokens", 0) if cache_stats else 0,
                    cached_tokens=cache_stats.get("cached_tokens", 0) if cache_stats else 0,
                    model="claude-3-5-sonnet-20241022",
                    success=True,
                )
                
                await self._emit(StreamEvent.agent_complete(
                    "security_agent",
                    security_output,
                    0.0,
                    cache_stats,
                ))

            return result
        except Exception as e:
            await self._emit(StreamEvent.agent_error("security_agent", str(e)))
            self.cost_aggregator.record_cost(
                workflow_id=self.workflow_id,
                agent_name="security_agent",
                input_tokens=0,
                output_tokens=0,
                model="claude-3-sonnet",
                success=False,
                error=str(e),
            )
            return {"errors": [f"Security Agent failed: {e}"]}

    async def _run_code_execution(self, state: AgentState) -> dict:
        """Apply generated code to workspace using ToolRegistry.
        
        This is the final step that actually writes files to the project.
        Supports both:
        - create_files: for new files (full content)
        - patch_files: for editing existing files (patch operations)
        """
        await self._emit(StreamEvent.agent_start("code_execution_agent", "Applying code to workspace..."))
        
        try:
            # Collect all generated files from agents (dict provides deduplication)
            files_to_create: Dict[str, str] = {}
            patches_to_apply: Dict[str, List[Any]] = {}
            
            # Backend files - support both create_files and patch_files
            if state.backend_output:
                # New files (create_files)
                if hasattr(state.backend_output, 'create_files') and state.backend_output.create_files:
                    for path, content in state.backend_output.create_files.items():
                        files_to_create[path] = content
                # Legacy support for .files attribute
                elif hasattr(state.backend_output, 'files') and state.backend_output.files:
                    for f in state.backend_output.files:
                        if hasattr(f, 'path') and hasattr(f, 'content'):
                            files_to_create[f.path] = f.content
                
                # Patch operations
                if hasattr(state.backend_output, 'patch_files') and state.backend_output.patch_files:
                    for path, ops in state.backend_output.patch_files.items():
                        patches_to_apply[path] = ops
                        
            # Frontend files (may override backend if same path)
            if state.frontend_output:
                if hasattr(state.frontend_output, 'create_files') and state.frontend_output.create_files:
                    for path, content in state.frontend_output.create_files.items():
                        files_to_create[path] = content
                elif hasattr(state.frontend_output, 'files') and state.frontend_output.files:
                    for f in state.frontend_output.files:
                        if hasattr(f, 'path') and hasattr(f, 'content'):
                            files_to_create[f.path] = f.content
                            
                if hasattr(state.frontend_output, 'patch_files') and state.frontend_output.patch_files:
                    for path, ops in state.frontend_output.patch_files.items():
                        patches_to_apply[path] = ops
                        
            # DevOps files (may override others if same path)
            if state.devops_output:
                if hasattr(state.devops_output, 'create_files') and state.devops_output.create_files:
                    for path, content in state.devops_output.create_files.items():
                        files_to_create[path] = content
                elif hasattr(state.devops_output, 'files') and state.devops_output.files:
                    for f in state.devops_output.files:
                        if hasattr(f, 'path') and hasattr(f, 'content'):
                            files_to_create[f.path] = f.content
                            
                if hasattr(state.devops_output, 'patch_files') and state.devops_output.patch_files:
                    for path, ops in state.devops_output.patch_files.items():
                        patches_to_apply[path] = ops
            
            # Emit patch proposed events for IDE preview
            if patches_to_apply:
                await self._emit(StreamEvent.ai_patch_proposed(
                    agent_name="code_execution_agent",
                    patches={
                        path: [op.model_dump() for op in ops]
                        for path, ops in patches_to_apply.items()
                    },
                    file_count=len(patches_to_apply),
                ))
            
            if not files_to_create and not patches_to_apply:
                await self._emit(StreamEvent.agent_progress("code_execution_agent", 100, "No files to create or modify"))
                return {"code_execution_output": {"success": True, "files_created": [], "patches_applied": [], "message": "No files generated"}}
            
            # Step 1: Create new files
            files_created = []
            if files_to_create:
                await self._emit(StreamEvent.agent_progress("code_execution_agent", 25, 
                    f"Executing file write for project: {state.project_id}, files: {len(files_to_create)}"))
                
                await self._emit(StreamEvent.agent_progress("code_execution_agent", 50, f"Creating {len(files_to_create)} new files..."))
                
                # Call ToolRegistry to create files via project-service API
                result = await self.tool_registry.execute_tool(
                    "create_files",
                    state.project_id,
                    files=files_to_create
                )
                
                files_created = list(files_to_create.keys())
                
                # Emit file.created events for each file
                for file_path in files_created:
                    await self._emit(StreamEvent(
                        event_type=EventType.WORKFLOW_COMPLETE,  # reuse closest; IDE listens to data
                        agent_name="code_execution_agent",
                        message="file.created",
                        data={
                            "event": "file.created",
                            "file_path": file_path,
                            "project_id": state.project_id,
                            "action": "created",
                        },
                    ))
            
            # Step 2: Apply patches to existing files
            patches_applied = []
            if patches_to_apply:
                await self._emit(StreamEvent.agent_progress("code_execution_agent", 75, f"Applying {len(patches_to_apply)} patches..."))
                
                # Import and use PatchFileTool
                from ..tools.patch_file_tool import patch_file_tool
                patch_results = await patch_file_tool.apply_patches(
                    state.project_id,
                    patches_to_apply
                )
                
                patches_applied = [path for path, success in patch_results.items() if success]
                
                # Emit file.modified events for patched files
                for file_path in patches_applied:
                    await self._emit(StreamEvent(
                        event_type=EventType.AGENT_COMPLETE,
                        agent_name="code_execution_agent",
                        message="file.modified",
                        data={
                            "event": "file.modified",
                            "file_path": file_path,
                            "project_id": state.project_id,
                            "action": "modified",
                        },
                    ))
            
            # Step 3: Install dependencies if specified
            dependencies_installed = []
            all_dependencies = set()
            
            # Collect dependencies from all outputs
            for output in [state.backend_output, state.frontend_output, state.devops_output]:
                if output and hasattr(output, 'dependencies') and output.dependencies:
                    all_dependencies.update(output.dependencies)
            
            if all_dependencies:
                await self._emit(StreamEvent.agent_progress("code_execution_agent", 85, 
                    f"Installing {len(all_dependencies)} dependencies..."))
                
                # Determine package manager based on project files
                package_manager = "npm"  # default
                if "package.json" in files_to_create:
                    package_manager = "npm"
                elif "requirements.txt" in files_to_create or any(f.endswith(".py") for f in files_to_create):
                    package_manager = "pip"
                
                # Install dependencies
                install_result = await self.tool_registry.execute_tool(
                    "install_dependencies",
                    state.project_id,
                    package_manager=package_manager,
                    timeout=300
                )
                
                if install_result.get("success"):
                    dependencies_installed = list(all_dependencies)
                    await self._emit(StreamEvent.agent_progress("code_execution_agent", 90, 
                        f"Dependencies installed: {', '.join(dependencies_installed)}"))
                else:
                    await self._emit(StreamEvent.agent_progress("code_execution_agent", 90, 
                        "Dependency installation had issues, continuing..."))
            
            await self._emit(StreamEvent.agent_complete(
                "code_execution_agent",
                {"files_created": files_created, "patches_applied": patches_applied},
                0.0,
                None
            ))
            
            return {
                "code_execution_output": {
                    "success": True,
                    "files_created": files_created,
                    "result": result
                }
            }
            
        except Exception as e:
            await self._emit(StreamEvent.agent_error("code_execution_agent", str(e)))
            return {"errors": [f"Code execution failed: {e}"]}

    def should_continue_qa(self, state: AgentState) -> str:
        """Determine if QA loop should continue or end.

        Returns:
            "security": Tests passed, proceed to security scan
            "retry_backend": Backend tests failed, retry backend
            "retry_frontend": Frontend tests failed, retry frontend
            "end": Max iterations reached, halt
        """
        # Check max iterations limit
        if state.iteration >= self.MAX_ITERATIONS:
            return "end"

        # If QA passed, proceed to security
        if state.qa_output and state.qa_output.tests_passed:
            return "security"

        # Determine which agent to retry based on failures
        if state.qa_output and state.qa_output.test_results:
            # Check which tests failed
            backend_failed = any(
                "backend" in test.lower() or "api" in test.lower()
                for test, passed in state.qa_output.test_results.items()
                if not passed
            )
            frontend_failed = any(
                "frontend" in test.lower() or "ui" in test.lower()
                for test, passed in state.qa_output.test_results.items()
                if not passed
            )

            if backend_failed and not frontend_failed:
                return "retry_backend"
            if frontend_failed and not backend_failed:
                return "retry_frontend"

        # Default: retry both
        return "retry_backend"

    def build(self) -> StateGraph:
        """Build the LangGraph workflow DAG."""
        workflow: StateGraph = StateGraph(AgentState)

        # Add all nodes (using wrapped methods for streaming)
        workflow.add_node("precheck", self._precheck)
        workflow.add_node("pm", self._run_pm)
        workflow.add_node("architect", self._run_architect)
        
        # Parallel execution node (replaces individual backend/frontend/devops nodes)
        if self.ENABLE_PARALLEL_EXECUTION:
            workflow.add_node("parallel_phase", self._run_parallel_phase)
        else:
            # Fallback: add individual nodes
            workflow.add_node("backend", self._run_backend)
            workflow.add_node("frontend", self._run_frontend)
            workflow.add_node("devops", self._run_devops)
        
        workflow.add_node("qa", self._run_qa)
        workflow.add_node("security", self._run_security)

        # Entry point
        workflow.add_edge("__start__", "precheck")
        workflow.add_edge("precheck", "pm")

        # Sequential phase: PM -> Architect
        workflow.add_edge("pm", "architect")

        # Parallel phase: Architect -> Backend + Frontend + DevOps
        if self.ENABLE_PARALLEL_EXECUTION:
            # Use optimized parallel executor
            workflow.add_edge("architect", "parallel_phase")
            workflow.add_edge("parallel_phase", "qa")
        else:
            # Fallback: LangGraph's built-in parallelism
            workflow.add_edge("architect", "backend")
            workflow.add_edge("architect", "frontend")
            workflow.add_edge("architect", "devops")

            # Gatekeeper phase: All -> QA
            workflow.add_edge("backend", "qa")
            workflow.add_edge("frontend", "qa")
            workflow.add_edge("devops", "qa")

        # QA -> Security (on pass) or Retry (on fail) or End (max iterations)
        if self.ENABLE_PARALLEL_EXECUTION:
            # When parallel execution is enabled, retry goes back to parallel_phase
            workflow.add_conditional_edges(
                "qa",
                self.should_continue_qa,
                {
                    "security": "security",
                    "retry_backend": "parallel_phase",  # Retry all parallel agents
                    "retry_frontend": "parallel_phase",
                    "end": END,
                },
            )
        else:
            workflow.add_conditional_edges(
                "qa",
                self.should_continue_qa,
                {
                    "security": "security",
                    "retry_backend": "backend",
                    "retry_frontend": "frontend",
                    "end": END,
                },
            )

        # Add code execution node
        workflow.add_node("code_execution", self._run_code_execution)
        
        # Security -> CodeExecution -> End
        workflow.add_edge("security", "code_execution")
        workflow.add_edge("code_execution", END)

        return workflow

    def compile(self):
        """Compile the workflow into an executable graph."""
        return self.build().compile()

    def get_cost_summary(self) -> dict:
        """Get cost summary for this workflow.

        Returns:
            Cost summary with per-agent breakdown
        """
        summary = self.cost_aggregator.get_workflow_summary(self.workflow_id)
        if summary:
            return summary.to_dict()
        return {
            "workflow_id": self.workflow_id,
            "status": "not_started",
            "total_cost": 0.0,
        }
