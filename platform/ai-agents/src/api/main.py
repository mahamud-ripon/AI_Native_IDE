"""FastAPI application entry point for AI Agents API."""

from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import router

# Create FastAPI app
app = FastAPI(
    title="AI Agents API",
    description="""
Multi-agent AI system for automated software development.

## Features

- **7 Specialized Agents**: PM, Architect, Backend, Frontend, DevOps, QA, Security
- **Tiered LLM Routing**: Cost-optimized model selection (Claude Opus/Sonnet, Groq)
- **Prompt Caching**: 90% cost reduction on repeated prompts
- **Real-time Streaming**: SSE for live progress updates
- **Human-in-the-loop**: Interactive guidance when needed
- **Parallel Execution**: Optimized concurrent agent execution with priority scheduling
- **Schema Validation**: Automatic validation of all agent outputs
- **Cost Aggregation**: Track costs per workflow and agent

## Workflow

1. Submit a user prompt describing what to build
2. PM Agent analyzes requirements
3. Architect Agent designs the system
4. Backend/Frontend/DevOps Agents generate code in parallel (ParallelExecutor)
5. QA Agent validates and tests
6. Security Agent scans for vulnerabilities
7. Receive complete project files

## API Endpoints

### Workflow
- `POST /api/v1/workflow` - Execute workflow (non-streaming)
- `POST /api/v1/workflow/stream` - Execute workflow with SSE streaming

### Costs
- `GET /api/v1/costs/workflows` - Get all workflow costs
- `GET /api/v1/costs/workflows/{id}` - Get specific workflow cost
- `POST /api/v1/costs/estimate` - Estimate cost for execution

### Parallel Execution
- `GET /api/v1/parallel/status` - Get parallel executor status
- `GET /api/v1/parallel/metrics` - Get execution metrics

### Validation
- `GET /api/v1/validation/status` - Get validation middleware status
- `GET /api/v1/validation/history` - Get validation history
- `GET /api/v1/validation/schemas` - Get registered schemas

### Human-in-the-loop
- `POST /api/v1/human-input` - Submit human input for paused workflow
- `POST /api/v1/human-input/{id}/cancel` - Cancel pending input
    """,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(router)


@app.on_event("startup")
async def startup_event():
    """Run on application startup."""
    # Verify API keys are set (warnings only, not errors)
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("WARNING: ANTHROPIC_API_KEY not set. Tier 1 & 2 agents will return stub output.")
    if not os.getenv("GROQ_API_KEY"):
        print("WARNING: GROQ_API_KEY not set. Security Agent will return stub output.")


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "AI Agents API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/v1/health",
    }


# For running with uvicorn directly
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.api.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=os.getenv("DEBUG", "false").lower() == "true",
    )
