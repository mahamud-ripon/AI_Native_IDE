from __future__ import annotations

import asyncio
import os

from langchain_core.output_parsers import PydanticOutputParser

from ...llm_router.cost_manager import cost_manager
from ...orchestrator.state_schema import AgentState, CodeOutput

MAX_RETRIES = 3
RETRY_DELAY = 2

FRONTEND_SYSTEM_PROMPT = """You are a Frontend Engineer Agent. Your role is to generate production-ready React/Next.js code based on the architect's design.

## Your Responsibilities:
1. Generate React components
2. Create pages and layouts
3. Implement state management
4. Handle API integration
5. Add styling with Tailwind CSS

## Constraints:
- Follow the architect's tech stack exactly
- Use TypeScript for type safety
- Implement responsive design
- Follow accessibility best practices
- Write clean, reusable components

## Output Requirements:
- Valid JSON only
- Complete file contents (no placeholders)
- Include all necessary imports
- Use Tailwind CSS classes for styling
"""

FRONTEND_USER_PROMPT_TEMPLATE = """## Input from Architect Agent:

**Tech Stack:** {tech_stack}
**API Design:**
{api_design}

**Files to Create:**
{files_to_create}

## Your Task:
Generate complete frontend code for this project. For each file:
1. Include all imports
2. Write complete component implementation
3. Add proper TypeScript types
4. Implement responsive design
5. Handle loading and error states

{format_instructions}
"""


def _get_stub_output() -> CodeOutput:
    """Return stub output for offline mode."""
    return CodeOutput(
        create_files={
            "src/app/page.tsx": '''export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Welcome</h1>
    </main>
  );
}
''',
            "src/app/layout.tsx": '''export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
''',
        },
        dependencies=["next", "react", "react-dom"],
        instructions="Run with: npm run dev",
    )


class FrontendAgent:
    """Frontend Engineer Agent - generates React/Next.js code using Tier 2 LLM.

    Uses Prompt Caching for 90% cost reduction on system prompts.
    """

    def __init__(self):
        self.llm = cost_manager.get_llm("tier2")
        self.parser = PydanticOutputParser(pydantic_object=CodeOutput)

    async def run(self, state: AgentState) -> dict:
        """
        Execute the Frontend Agent with retry logic and prompt caching.

        Args:
            state: Current agent state containing architect output

        Returns:
            Partial state dict with frontend_output or errors
        """
        if state.architect_output is None:
            return {"errors": ["Frontend Agent: Missing architect output"]}

        # Check for API key - return stub if missing
        if not os.getenv("ANTHROPIC_API_KEY"):
            return {
                "errors": ["Frontend Agent: Missing ANTHROPIC_API_KEY; returning stub output"],
                "frontend_output": _get_stub_output(),
            }

        # Build user prompt with format instructions
        user_prompt = FRONTEND_USER_PROMPT_TEMPLATE.format(
            tech_stack=", ".join(state.architect_output.tech_stack),
            api_design=state.architect_output.api_design,
            files_to_create="\n".join(
                f"- {f.path}: {f.description}"
                for f in state.architect_output.files_to_create
            ),
            format_instructions=self.parser.get_format_instructions(),
        )

        # Create cached prompt (system cached, user not cached)
        messages = cost_manager.create_cached_prompt(
            system_prompt=FRONTEND_SYSTEM_PROMPT,
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
                    "frontend_output": parsed,
                    "cache_stats": cost_manager.get_cache_stats("tier2"),
                }

            except Exception as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))

        return {"errors": [f"Frontend Agent failed after {MAX_RETRIES} attempts: {last_error}"]}
