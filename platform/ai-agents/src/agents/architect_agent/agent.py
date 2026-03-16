from __future__ import annotations

import asyncio
import os

from langchain_core.output_parsers import PydanticOutputParser

from ...llm_router.cost_manager import cost_manager
from ...orchestrator.context_pruner import ContextPruner, prune_context_for_architect
from ...orchestrator.state_schema import (
    ADR,
    AgentState,
    ArchitectOutput,
    ColumnDefinition,
    EndpointDefinition,
    FileSpec,
    TableDefinition,
)

# Tier 1 pricing (Claude 3.5 Sonnet)
INPUT_COST_PER_1M = 15.00  # $15 per 1M input tokens
OUTPUT_COST_PER_1M = 75.00  # $75 per 1M output tokens

MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds

ARCHITECT_SYSTEM_PROMPT = """You are a Principal Architect at a top-tier tech company.

## Expertise:
- Microservices and monolith architectures
- Database design (SQL and NoSQL)
- API design (REST, GraphQL, gRPC)
- Cloud infrastructure (AWS, GCP, Azure)
- Security best practices
- Performance optimization

## Design Principles:
1. **Simplicity First**: Don't over-engineer
2. **YAGNI**: Only add what you need now
3. **Fail Fast**: Design for errors
4. **Security by Default**: Encrypt everything
5. **Observable**: Add logging and metrics

## Your Responsibilities:
1. Select appropriate technology stack
2. Design database schema
3. Define API endpoints
4. Plan file structure
5. Document architecture decisions (ADRs)

## Constraints:
- Prefer proven, battle-tested technologies
- Minimize infrastructure complexity
- Design for horizontal scaling
- Ensure security best practices
- Optimize for developer productivity

## Output Requirements:
- Valid JSON only
- Complete schema coverage
- No placeholders or TODO comments
"""

ARCHITECT_USER_PROMPT_TEMPLATE = """## Input from PM Agent:

**Project Name:** {project_name}
**Description:** {description}
**Requirements:**
{requirements}

**Target Users:** {target_users}
**Success Metrics:** {success_metrics}

## Your Task:
Design a complete system architecture for this project. Consider:

1. **Tech Stack Selection:**
   - Frontend framework (Next.js, React, Vue)
   - Backend runtime (Node.js, Python, Go)
   - Database (PostgreSQL, MongoDB, SQLite)
   - ORM (Prisma, Drizzle, SQLAlchemy)
   - Styling (Tailwind, CSS Modules)
   - Authentication (NextAuth, Clerk, custom)

2. **Database Schema:**
   - Design all tables with relationships
   - Define columns, types, constraints
   - Plan indexes for performance

3. **API Design:**
   - RESTful endpoints
   - Request/response schemas
   - Error handling strategy

4. **File Structure:**
   - List all files to create
   - Prioritize by importance

5. **Architecture Decisions:**
   - Document key decisions with rationale

{format_instructions}
"""

FEW_SHOT_EXAMPLES = """
## Example Input:
Project: Task Management App
Requirements: ["User auth", "Create tasks", "Assign tasks", "Due dates", "Notifications"]

## Example Output:
{
  "tech_stack": ["nextjs", "postgresql", "prisma", "nextauth", "tailwind"],
  "db_schema": "model User { id String @id @default(cuid()) email String @unique password String createdAt DateTime @default(now()) } model Task { id String @id @default(cuid()) title String status String userId String dueDate DateTime? user User @relation(fields: [userId], references: [id]) }",
  "tables": [
    {"name": "User", "columns": [{"name": "id", "type": "String", "nullable": false, "primary_key": true}], "relations": ["Task"]},
    {"name": "Task", "columns": [{"name": "id", "type": "String", "nullable": false, "primary_key": true}], "relations": ["User"]}
  ],
  "api_design": "RESTful API with /api/tasks endpoints",
  "endpoints": [
    {"method": "GET", "path": "/api/tasks", "description": "List all tasks"},
    {"method": "POST", "path": "/api/tasks", "description": "Create a new task"},
    {"method": "PATCH", "path": "/api/tasks/:id", "description": "Update a task"}
  ],
  "files_to_create": [
    {"path": "prisma/schema.prisma", "description": "Database schema", "priority": "critical"},
    {"path": "src/app/api/auth/[...nextauth]/route.ts", "description": "Auth handler", "priority": "critical"},
    {"path": "src/app/api/tasks/route.ts", "description": "Tasks API", "priority": "high"}
  ],
  "architecture_decisions": [
    {"id": "ADR-001", "title": "Use Prisma ORM", "decision": "Use Prisma for type-safe DB access", "rationale": "Better DX, type safety, easy migrations", "status": "accepted"}
  ]
}
"""


def _estimate_cost(
    input_text: str,
    output_text: str,
    cached_tokens: int = 0,
) -> float:
    """Estimate cost based on character count with cache savings."""
    input_tokens = int(len(input_text) * 0.75)
    output_tokens = int(len(output_text) * 0.75)
    return cost_manager.estimate_cost("tier1", input_tokens, output_tokens, cached_tokens)


def _get_stub_output() -> ArchitectOutput:
    """Return a stub output for offline mode."""
    return ArchitectOutput(
        tech_stack=["python", "fastapi", "postgresql", "sqlalchemy"],
        db_schema="model User { id Int @id @default(autoincrement()) email String @unique }",
        tables=[
            TableDefinition(
                name="User",
                columns=[
                    ColumnDefinition(name="id", type="Int", nullable=False, primary_key=True),
                    ColumnDefinition(name="email", type="String", nullable=False),
                ],
                relations=[],
            )
        ],
        api_design="RESTful API with /api/users endpoints",
        endpoints=[
            EndpointDefinition(method="GET", path="/api/users", description="List users"),
            EndpointDefinition(method="POST", path="/api/users", description="Create user"),
        ],
        files_to_create=[
            FileSpec(path="src/models/user.py", description="User model", priority="critical"),
            FileSpec(path="src/api/users.py", description="Users API", priority="high"),
        ],
        architecture_decisions=[
            ADR(
                id="ADR-001",
                title="Use FastAPI",
                decision="Use FastAPI for backend",
                rationale="Async support, type safety, auto docs",
                status="accepted",
            )
        ],
        architecture_diagram=None,
    )


class ArchitectAgent:
    """System Architect Agent - designs complete system architecture using Tier 1 LLM.

    Uses Prompt Caching for 90% cost reduction on system prompts.
    """

    def __init__(self, use_context_pruning: bool = True):
        self.llm = cost_manager.get_llm("tier1")
        self.parser = PydanticOutputParser(pydantic_object=ArchitectOutput)
        self.use_context_pruning = use_context_pruning
        self.context_pruner = ContextPruner() if use_context_pruning else None

    async def run(self, state: AgentState) -> dict:
        """
        Execute the Architect Agent with retry logic, context pruning, and prompt caching.

        Args:
            state: Current agent state containing PM output

        Returns:
            Partial state dict with architect_output or errors
        """
        if state.pm_output is None:
            return {"errors": ["Architect Agent: Missing PM output"]}

        # Check for API key - return stub if missing
        if not os.getenv("ANTHROPIC_API_KEY"):
            return {
                "errors": ["Architect Agent: Missing ANTHROPIC_API_KEY; returning stub output"],
                "architect_output": _get_stub_output(),
            }

        # Apply context pruning to PM output if enabled
        pm_data = state.pm_output.model_dump()
        if self.use_context_pruning and self.context_pruner:
            pruned_context = prune_context_for_architect(pm_data)
            pm_data = pruned_context["pm_output"]

        # Build user prompt with format instructions
        user_prompt = ARCHITECT_USER_PROMPT_TEMPLATE.format(
            project_name=pm_data.get("project_name", ""),
            description=pm_data.get("description", ""),
            requirements="\n".join(f"- {r}" for r in pm_data.get("requirements", [])),
            target_users=pm_data.get("target_users", ""),
            success_metrics="\n".join(f"- {m}" for m in pm_data.get("success_metrics", [])),
            format_instructions=self.parser.get_format_instructions(),
        )

        # Create cached prompt (system + few-shot cached, user not cached)
        messages = cost_manager.create_cached_prompt(
            system_prompt=ARCHITECT_SYSTEM_PROMPT,
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
                parsed = self.parser.parse(result.content)

                # Estimate cost with cache savings
                cached_tokens = cost_manager._cache_stats["tier1"]["tokens_cached"]
                cost = _estimate_cost(
                    ARCHITECT_SYSTEM_PROMPT + FEW_SHOT_EXAMPLES + user_prompt,
                    parsed.model_dump_json(),
                    cached_tokens,
                )

                return {
                    "architect_output": parsed,
                    "cost_sofar": cost,
                    "cache_stats": cost_manager.get_cache_stats("tier1"),
                }

            except Exception as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))

        return {"errors": [f"Architect Agent failed after {MAX_RETRIES} attempts: {last_error}"]}
