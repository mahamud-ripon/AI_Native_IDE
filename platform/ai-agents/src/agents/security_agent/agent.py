from __future__ import annotations

import asyncio
import os

from langchain_core.output_parsers import PydanticOutputParser

from ...llm_router.cost_manager import cost_manager
from ...orchestrator.state_schema import AgentState, SecurityOutput

MAX_RETRIES = 3
RETRY_DELAY = 2

SECURITY_SYSTEM_PROMPT = """You are a Security Engineer Agent. Your role is to scan code for vulnerabilities and security issues.

## Your Responsibilities:
1. Scan for SQL injection vulnerabilities
2. Check for XSS vulnerabilities
3. Identify authentication issues
4. Find hardcoded secrets
5. Check for insecure dependencies

## Constraints:
- Focus on critical security issues
- Prioritize by severity (high, medium, low)
- Provide remediation suggestions
- Check OWASP Top 10

## Output Requirements:
- Valid JSON only
- Clear vulnerability descriptions
- Specific file and line references
- Remediation recommendations
"""

SECURITY_USER_PROMPT_TEMPLATE = """## Input from Previous Agents:

**Backend Files:**
{backend_files}

**Frontend Files:**
{frontend_files}

**Dependencies:**
{dependencies}

## Your Task:
Scan this code for security vulnerabilities. Report:
1. All vulnerabilities found
2. Severity level (high, medium, low)
3. File and location
4. Remediation suggestions

{format_instructions}
"""


def _get_stub_output() -> SecurityOutput:
    """Return stub output for offline mode."""
    return SecurityOutput(
        vulnerabilities=[],
        risk_level="low",
    )


class SecurityAgent:
    """Security Engineer Agent - scans for vulnerabilities using Tier 3 LLM.

    Note: Tier 3 uses Groq/Llama3 which doesn't support prompt caching.
    The caching methods are still used for consistent API but won't provide savings.
    """

    def __init__(self):
        self.llm = cost_manager.get_llm("tier3")
        self.parser = PydanticOutputParser(pydantic_object=SecurityOutput)

    async def run(self, state: AgentState) -> dict:
        """
        Execute the Security Agent with retry logic.

        Args:
            state: Current agent state containing code outputs

        Returns:
            Partial state dict with security_output or errors
        """
        # Check for API key - return stub if missing
        if not os.getenv("GROQ_API_KEY"):
            return {
                "errors": ["Security Agent: Missing GROQ_API_KEY; returning stub output"],
                "security_output": _get_stub_output(),
            }

        # Gather files from backend and frontend
        backend_files = ""
        if state.backend_output:
            backend_files = "\n".join(
                f"- {path}: {content[:300]}..."
                for path, content in list(state.backend_output.files.items())[:5]
            )

        frontend_files = ""
        if state.frontend_output:
            frontend_files = "\n".join(
                f"- {path}: {content[:300]}..."
                for path, content in list(state.frontend_output.files.items())[:5]
            )

        dependencies = []
        if state.backend_output:
            dependencies.extend(state.backend_output.dependencies)
        if state.frontend_output:
            dependencies.extend(state.frontend_output.dependencies)

        # Build user prompt with format instructions
        user_prompt = SECURITY_USER_PROMPT_TEMPLATE.format(
            backend_files=backend_files or "No backend files generated",
            frontend_files=frontend_files or "No frontend files generated",
            dependencies=", ".join(dependencies) or "None specified",
            format_instructions=self.parser.get_format_instructions(),
        )

        # Create cached prompt (system cached, user not cached)
        # Note: Tier 3 (Groq) doesn't support caching, but we use same API for consistency
        messages = cost_manager.create_cached_prompt(
            system_prompt=SECURITY_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            tier="tier3",
        )

        # Retry logic
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                # Use direct invoke with cached messages
                result = await self.llm.ainvoke(messages)

                # Parse structured output
                parsed = self.parser.parse(result.content)

                return {
                    "security_output": parsed,
                    "cache_stats": cost_manager.get_cache_stats("tier3"),
                }

            except Exception as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))

        return {"errors": [f"Security Agent failed after {MAX_RETRIES} attempts: {last_error}"]}
