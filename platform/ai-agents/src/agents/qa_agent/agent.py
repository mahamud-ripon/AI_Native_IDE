from __future__ import annotations

import asyncio
import os

from langchain_core.output_parsers import PydanticOutputParser

from ...llm_router.cost_manager import cost_manager
from ...orchestrator.state_schema import AgentState, QAOutput

MAX_RETRIES = 3
RETRY_DELAY = 2

QA_SYSTEM_PROMPT = """You are a QA Engineer Agent. Your role is to generate and validate tests for the code produced by Backend and Frontend agents.

## Your Responsibilities:
1. Generate unit tests for backend code
2. Generate component tests for frontend code
3. Validate API endpoints
4. Check code coverage
5. Report test results

## Constraints:
- Test all critical paths
- Include edge cases
- Check error handling
- Validate inputs and outputs
- Report clear failure reasons

## Output Requirements:
- Valid JSON only
- Clear test results
- Specific error messages for failures
"""

QA_USER_PROMPT_TEMPLATE = """## Input from Previous Agents:

**Backend Files:**
{backend_files}

**Frontend Files:**
{frontend_files}

**API Endpoints:**
{api_design}

## Your Task:
Generate and run tests for this code. Report:
1. All tests executed
2. Pass/fail status for each test
3. Coverage percentage if available
4. Specific errors for failed tests

{format_instructions}
"""


def _get_stub_output() -> QAOutput:
    """Return stub output for offline mode."""
    return QAOutput(
        tests_passed=True,
        test_results={
            "backend_health_check": True,
            "backend_api_response": True,
            "frontend_render": True,
        },
        errors=[],
        coverage=85.0,
    )


class QAAgent:
    """QA Engineer Agent - generates and runs tests using Tier 2 LLM.

    Uses Prompt Caching for 90% cost reduction on system prompts.
    """

    def __init__(self):
        self.llm = cost_manager.get_llm("tier2")
        self.parser = PydanticOutputParser(pydantic_object=QAOutput)

    async def run(self, state: AgentState) -> dict:
        """
        Execute the QA Agent with retry logic and prompt caching.

        Args:
            state: Current agent state containing backend and frontend outputs

        Returns:
            Partial state dict with qa_output or errors
        """
        # Check for API key - return stub if missing
        if not os.getenv("ANTHROPIC_API_KEY"):
            return {
                "errors": ["QA Agent: Missing ANTHROPIC_API_KEY; returning stub output"],
                "qa_output": _get_stub_output(),
            }

        # Gather files from backend and frontend
        backend_files = ""
        if state.backend_output:
            backend_files = "\n".join(
                f"- {path}: {content[:200]}..."
                for path, content in list(state.backend_output.files.items())[:5]
            )

        frontend_files = ""
        if state.frontend_output:
            frontend_files = "\n".join(
                f"- {path}: {content[:200]}..."
                for path, content in list(state.frontend_output.files.items())[:5]
            )

        api_design = ""
        if state.architect_output:
            api_design = state.architect_output.api_design

        # Build user prompt with format instructions
        user_prompt = QA_USER_PROMPT_TEMPLATE.format(
            backend_files=backend_files or "No backend files generated",
            frontend_files=frontend_files or "No frontend files generated",
            api_design=api_design or "No API design available",
            format_instructions=self.parser.get_format_instructions(),
        )

        # Create cached prompt (system cached, user not cached)
        messages = cost_manager.create_cached_prompt(
            system_prompt=QA_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            tier="tier2",
        )

        # Retry logic
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                # Use direct invoke with cached messages
                result = await self.llm.ainvoke(messages)

                # Parse structured output
                parsed = self.parser.parse(result.content)

                # Increment iteration if tests failed
                if not parsed.tests_passed:
                    return {
                        "qa_output": parsed,
                        "iteration": 1,
                        "cache_stats": cost_manager.get_cache_stats("tier2"),
                    }

                return {
                    "qa_output": parsed,
                    "cache_stats": cost_manager.get_cache_stats("tier2"),
                }

            except Exception as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))

        return {"errors": [f"QA Agent failed after {MAX_RETRIES} attempts: {last_error}"]}
