from __future__ import annotations

import asyncio
import os
import re
from typing import Any, AsyncGenerator, Optional

from langchain_core.output_parsers import PydanticOutputParser

from ...llm_router.cost_manager import cost_manager
from ...orchestrator.state_schema import AgentState, FeatureSpec, Persona, PMOutput

MAX_RETRIES = 3
RETRY_DELAY = 2

# Tier 1 pricing (Claude 3.5 Sonnet)
INPUT_COST_PER_1M = 15.00
OUTPUT_COST_PER_1M = 75.00

PM_SYSTEM_PROMPT = """You are a Product Manager Agent. Your role is to understand what the user wants to build and translate it into a clear, actionable product specification.

## Your Responsibilities:
1. Understand the user's natural language request
2. Define the project scope and goals
3. Break down requirements into features
4. Identify target users and their needs
5. Define success metrics

## Guidelines:
- Ask clarifying questions if the request is ambiguous
- Focus on MVP features first
- Consider technical feasibility
- Think about user experience

## Output Format:
You must output a valid JSON object matching the provided schema.
"""

PM_USER_PROMPT_TEMPLATE = """## User Request:

**Prompt:** {user_prompt}

## Your Task:
Analyze this request and create a comprehensive product specification:

1. **Project Name:** Create a catchy, descriptive name for this project

2. **Description:** Write a 2-3 sentence description of what this project does

3. **Requirements:** List all the requirements the user mentioned or implied

4. **Features:** Break down the project into specific features with priorities

5. **Target Users:** Define who this product is for

6. **Success Metrics:** Define how we measure if this project is successful

7. **Constraints:** Note any budget, timeline, or technical preferences

{format_instructions}
"""

FEW_SHOT_EXAMPLES = """
## Example Input:
"Build a task management app where users can create tasks, assign them to team members, and track progress."

## Example Output:
{
  "project_name": "TaskFlow",
  "description": "A collaborative task management application for teams to organize, assign, and track tasks efficiently.",
  "requirements": [
    "User authentication",
    "Create and manage tasks",
    "Assign tasks to team members",
    "Track task progress",
    "Team collaboration"
  ],
  "features": [
    {"name": "Task CRUD", "description": "Create, read, update, delete tasks", "priority": "must-have", "dependencies": []},
    {"name": "User Assignment", "description": "Assign tasks to team members", "priority": "must-have", "dependencies": ["User authentication"]},
    {"name": "Progress Tracking", "description": "Track and display task status", "priority": "must-have", "dependencies": ["Task CRUD"]}
  ],
  "target_users": "Teams and project managers who need to coordinate work",
  "user_personas": [
    {"name": "Project Manager", "role": "Manages team workflow", "goals": ["Track team progress", "Assign tasks efficiently"], "pain_points": ["Losing track of tasks", "No visibility into team workload"]}
  ],
  "success_metrics": ["Daily active users", "Tasks completed per week", "User retention rate"],
  "budget_tier": "medium",
  "timeline": "weeks"
}
"""


# Patterns that indicate the prompt is too vague for a PRD
VAGUE_PATTERNS = [
    r'^\s*(hi|hello|hey|sup|yo|hiya)\s*[!.?]*\s*$',
    r'^\s*how are you\s*[?]*\s*$',
    r'^\s*what (can|do) you do\s*[?]*\s*$',
    r'^\s*(thanks|thank you|ty)\s*[!.]*\s*$',
    r'^\s*(help|help me)\s*[!.?]*\s*$',
    r'^\s*(ok|okay|sure|cool|nice|great)\s*[!.]*\s*$',
    r'^\s*\w{1,8}\s*$',  # Single very short word
]


def _is_prompt_specific(prompt: str) -> bool:
    """Check if the prompt has enough specificity to generate a PRD.

    Returns False for vague greetings, short prompts, or
    messages that don't describe what to build.
    """
    p = prompt.lower().strip()
    for pattern in VAGUE_PATTERNS:
        if re.match(pattern, p):
            return False
    return True


def _estimate_cost(
    input_text: str,
    output_text: str,
    cached_tokens: int = 0,
) -> float:
    """Estimate cost based on character count with cache savings."""
    input_tokens = int(len(input_text) * 0.75)
    output_tokens = int(len(output_text) * 0.75)
    return cost_manager.estimate_cost("tier1", input_tokens, output_tokens, cached_tokens)


def _get_stub_output() -> PMOutput:
    """Return stub output for offline mode."""
    return PMOutput(
        project_name="StubProject",
        description="A stub project generated for offline development mode.",
        requirements=[
            "User authentication",
            "Basic CRUD operations",
            "API endpoints",
        ],
        features=[
            FeatureSpec(
                name="Authentication",
                description="User login and registration",
                priority="must-have",
                dependencies=[],
            ),
            FeatureSpec(
                name="Core API",
                description="RESTful API endpoints",
                priority="must-have",
                dependencies=[],
            ),
        ],
        target_users="Developers testing the AI agent system",
        user_personas=[
            Persona(
                name="Developer",
                role="Software Engineer",
                goals=["Test the system", "Build features"],
                pain_points=["Need working examples"],
            )
        ],
        success_metrics=["Tests pass", "API responds correctly"],
        budget_tier="low",
        timeline="immediate",
        tech_preferences=["Python", "FastAPI"],
    )


class PMAgent:
    """Product Manager Agent - generates structured PRDs using Tier 1 LLM.

    Uses Prompt Caching for 90% cost reduction on system prompts.
    Supports both sync and streaming modes.
    """

    def __init__(self):
        self.llm = cost_manager.get_llm("tier1")
        self.parser = PydanticOutputParser(pydantic_object=PMOutput)

    async def run(self, state: AgentState) -> dict:
        """
        Execute the PM Agent with retry logic and prompt caching (non-streaming).

        Args:
            state: Current agent state containing user prompt

        Returns:
            Partial state dict with pm_output or errors
        """
        if not state.user_prompt:
            return {"errors": ["PM Agent: Missing user prompt"]}

        # Validate prompt specificity — stop hallucinating on vague prompts
        if not _is_prompt_specific(state.user_prompt):
            return {
                "errors": ["PM Agent: Your request is too vague. Please describe what you want to build in more detail (e.g., 'Build a todo app with React')."],
                "pm_output": None,
                "clarification_needed": True,
            }

        # Check for API key - return stub if missing
        if not os.getenv("ANTHROPIC_API_KEY"):
            return {
                "errors": ["PM Agent: Missing ANTHROPIC_API_KEY; returning stub output"],
                "pm_output": _get_stub_output(),
            }

        # Build user prompt with format instructions
        user_prompt = PM_USER_PROMPT_TEMPLATE.format(
            user_prompt=state.user_prompt,
            format_instructions=self.parser.get_format_instructions(),
        )

        # Create cached prompt (system + few-shot cached, user not cached)
        messages = cost_manager.create_cached_prompt(
            system_prompt=PM_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            tier="tier1",
            few_shot_examples=FEW_SHOT_EXAMPLES,
        )

        # Retry logic
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                # Use direct invoke with cached messages
                result = await self.llm.ainvoke(messages)

                # Parse structured output
                content = result.content
                if isinstance(content, list) and len(content) > 0:
                    content = content[0].text if hasattr(content[0], 'text') else str(content[0])
                parsed = self.parser.parse(content)

                # Estimate cost with cache savings
                cached_tokens = cost_manager._cache_stats["tier1"]["tokens_cached"]
                cost = _estimate_cost(
                    PM_SYSTEM_PROMPT + FEW_SHOT_EXAMPLES + user_prompt,
                    parsed.model_dump_json(),
                    cached_tokens,
                )

                return {
                    "pm_output": parsed,
                    "cost_sofar": cost,
                    "cache_stats": cost_manager.get_cache_stats("tier1"),
                }

            except Exception as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))

        return {"errors": [f"PM Agent failed after {MAX_RETRIES} attempts: {last_error}"]}

    async def run_stream(
        self,
        state: AgentState,
        on_token: Optional[callable] = None,
    ) -> AsyncGenerator[tuple[str, dict], None]:
        """
        Execute the PM Agent with token-by-token streaming.

        Args:
            state: Current agent state containing user prompt
            on_token: Optional callback for each token

        Yields:
            Tuples of (token, metadata) where token is text chunk and metadata contains result info
        """
        if not state.user_prompt:
            yield ("", {"error": "PM Agent: Missing user prompt"})
            return

        # Validate prompt specificity — stop hallucinating on vague prompts
        if not _is_prompt_specific(state.user_prompt):
            yield ("", {"error": "Your request is too vague. Please describe what you want to build in more detail.", "clarification_needed": True, "done": True})
            return

        # Check for API key - return stub if missing
        if not os.getenv("ANTHROPIC_API_KEY"):
            stub_output = _get_stub_output()
            stub_json = stub_output.model_dump_json()
            for char in stub_json:
                yield (char, {"is_streaming": True})
            yield ("", {"pm_output": stub_output, "done": True})
            return

        # Build user prompt with format instructions
        user_prompt = PM_USER_PROMPT_TEMPLATE.format(
            user_prompt=state.user_prompt,
            format_instructions=self.parser.get_format_instructions(),
        )

        # Create cached prompt
        messages = cost_manager.create_cached_prompt(
            system_prompt=PM_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            tier="tier1",
            few_shot_examples=FEW_SHOT_EXAMPLES,
        )

        # Stream tokens
        try:
            full_response = ""
            
            # Use streaming LLM call
            result_text, _ = await cost_manager.stream(
                tier="tier1",
                messages=messages,
                on_token=on_token,
            )
            
            full_response = result_text
            
            # Yield each character for fine-grained streaming
            for char in full_response:
                yield (char, {"is_streaming": True})
            
            # Parse and return final result
            try:
                parsed = self.parser.parse(full_response)
                cached_tokens = cost_manager._cache_stats["tier1"]["tokens_cached"]
                cost = _estimate_cost(
                    PM_SYSTEM_PROMPT + FEW_SHOT_EXAMPLES + user_prompt,
                    parsed.model_dump_json(),
                    cached_tokens,
                )
                
                yield ("", {
                    "pm_output": parsed,
                    "cost_sofar": cost,
                    "cache_stats": cost_manager.get_cache_stats("tier1"),
                    "done": True,
                })
            except Exception as parse_err:
                yield ("", {"error": f"PM Agent parse error: {parse_err}", "done": True})
                
        except Exception as e:
            yield ("", {"error": f"PM Agent failed: {e}", "done": True})
