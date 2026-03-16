from __future__ import annotations

import asyncio
import os

from langchain_core.output_parsers import PydanticOutputParser

from ...llm_router.cost_manager import cost_manager
from ...orchestrator.state_schema import AgentState, CodeOutput

MAX_RETRIES = 3
RETRY_DELAY = 2

DEVOPS_SYSTEM_PROMPT = """You are a DevOps Engineer Agent. Your role is to generate infrastructure-as-code configurations for deployment.

## Your Responsibilities:
1. Generate Dockerfile for containerization
2. Create docker-compose.yml for local development
3. Generate Kubernetes manifests for production
4. Create CI/CD pipeline configurations
5. Define environment variables

## Constraints:
- Follow the architect's tech stack exactly
- Use multi-stage builds for efficiency
- Include health checks
- Follow security best practices
- Keep configurations simple but production-ready

## Output Requirements:
- Valid JSON only
- Complete configuration files
- Include comments for clarity
"""

DEVOPS_USER_PROMPT_TEMPLATE = """## Input from Architect Agent:

**Tech Stack:** {tech_stack}
**Dependencies:** {dependencies}

## Your Task:
Generate DevOps configurations for this project:
1. Dockerfile for the application
2. docker-compose.yml for local development
3. Basic Kubernetes deployment.yaml (optional)

{format_instructions}
"""


def _get_stub_output() -> CodeOutput:
    """Return stub output for offline mode."""
    return CodeOutput(
        files={
            "Dockerfile": '''FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
''',
            "docker-compose.yml": '''version: '3.8'
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/app
    depends_on:
      - db
  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=app
    volumes:
      - postgres_data:/var/lib/postgresql/data
volumes:
  postgres_data:
''',
        },
        dependencies=["docker", "docker-compose"],
        instructions="Run with: docker-compose up --build",
    )


class DevOpsAgent:
    """DevOps Engineer Agent - generates Docker/K8s configs using Tier 2 LLM.

    Uses Prompt Caching for 90% cost reduction on system prompts.
    """

    def __init__(self):
        self.llm = cost_manager.get_llm("tier2")
        self.parser = PydanticOutputParser(pydantic_object=CodeOutput)

    async def run(self, state: AgentState) -> dict:
        """
        Execute the DevOps Agent with retry logic and prompt caching.

        Args:
            state: Current agent state containing architect output

        Returns:
            Partial state dict with devops_output or errors
        """
        if state.architect_output is None:
            return {"errors": ["DevOps Agent: Missing architect output"]}

        # Check for API key - return stub if missing
        if not os.getenv("ANTHROPIC_API_KEY"):
            return {
                "errors": ["DevOps Agent: Missing ANTHROPIC_API_KEY; returning stub output"],
                "devops_output": _get_stub_output(),
            }

        # Gather dependencies from backend/frontend
        dependencies = []
        if state.backend_output:
            dependencies.extend(state.backend_output.dependencies)
        if state.frontend_output:
            dependencies.extend(state.frontend_output.dependencies)

        # Build user prompt with format instructions
        user_prompt = DEVOPS_USER_PROMPT_TEMPLATE.format(
            tech_stack=", ".join(state.architect_output.tech_stack),
            dependencies=", ".join(dependencies) or "None specified",
            format_instructions=self.parser.get_format_instructions(),
        )

        # Create cached prompt (system cached, user not cached)
        messages = cost_manager.create_cached_prompt(
            system_prompt=DEVOPS_SYSTEM_PROMPT,
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
                    "devops_output": parsed,
                    "cache_stats": cost_manager.get_cache_stats("tier2"),
                }

            except Exception as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))

        return {"errors": [f"DevOps Agent failed after {MAX_RETRIES} attempts: {last_error}"]}
