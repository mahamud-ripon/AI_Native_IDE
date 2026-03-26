from __future__ import annotations

import asyncio
import os

from langchain_core.output_parsers import PydanticOutputParser

from ...llm_router.cost_manager import cost_manager
from ...orchestrator.state_schema import AgentState, CodeOutput

MAX_RETRIES = 3
RETRY_DELAY = 2

BACKEND_SYSTEM_PROMPT = """You are a Backend Engineer Agent. Your role is to generate production-ready backend code based on the architect's design.

## Your Responsibilities:
1. Generate API routes and handlers
2. Create database models and migrations
3. Implement business logic
4. Write API documentation
5. Handle error cases

## Constraints:
- Follow the architect's tech stack exactly
- Use proper error handling
- Include input validation
- Follow REST best practices
- Write clean, maintainable code

## Output Requirements:
- Valid JSON only
- Complete file contents (no placeholders)
- Include all necessary imports
"""

BACKEND_USER_PROMPT_TEMPLATE = """## Input from Architect Agent:

**Tech Stack:** {tech_stack}
**Database Schema:**
{db_schema}

**API Design:**
{api_design}

**Files to Create:**
{files_to_create}

## Your Task:
Generate complete backend code for this project. For each file:
1. Include all imports
2. Write complete implementation
3. Add error handling
4. Include comments for complex logic

{format_instructions}
"""


def _get_stub_output() -> CodeOutput:
    """Return stub output for offline mode."""
    return CodeOutput(
        create_files={
            "src/main.py": '''from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health_check():
    return {"status": "healthy"}
''',
            "src/models/__init__.py": "# Database models",
        },
        dependencies=["fastapi", "uvicorn"],
        instructions="Run with: uvicorn src.main:app --reload",
    )


class BackendAgent:
    """Backend Engineer Agent - generates API and database code using Tier 2 LLM.

    Uses Prompt Caching for 90% cost reduction on system prompts.
    """

    def __init__(self):
        self.llm = cost_manager.get_llm("tier2")
        self.parser = PydanticOutputParser(pydantic_object=CodeOutput)

    async def run(self, state: AgentState) -> dict:
        """
        Execute the Backend Agent with retry logic and prompt caching.

        Args:
            state: Current agent state containing architect output

        Returns:
            Partial state dict with backend_output or errors
        """
        if state.architect_output is None:
            return {"errors": ["Backend Agent: Missing architect output"]}

        # Check for API key - return stub if missing
        if not os.getenv("ANTHROPIC_API_KEY"):
            return {
                "errors": ["Backend Agent: Missing ANTHROPIC_API_KEY; returning stub output"],
                "backend_output": _get_stub_output(),
            }

        # Build user prompt with format instructions
        user_prompt = BACKEND_USER_PROMPT_TEMPLATE.format(
            tech_stack=", ".join(state.architect_output.tech_stack),
            db_schema=state.architect_output.db_schema,
            api_design=state.architect_output.api_design,
            files_to_create="\n".join(
                f"- {f.path}: {f.description}"
                for f in state.architect_output.files_to_create
            ),
            format_instructions=self.parser.get_format_instructions(),
        )

        # Create cached prompt (system cached, user not cached)
        messages = cost_manager.create_cached_prompt(
            system_prompt=BACKEND_SYSTEM_PROMPT,
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

                return {
                    "backend_output": parsed,
                    "cache_stats": cost_manager.get_cache_stats("tier2"),
                }

            except Exception as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))

        return {"errors": [f"Backend Agent failed after {MAX_RETRIES} attempts: {last_error}"]}
